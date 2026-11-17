import { describe, expect, it } from "vitest";
import {
  dayEndReached,
  missionActionCount,
  missionDays,
  missionTaskInstants,
  type MissionTaskState,
} from "@/lib/tasks/candidate-tasks";
import { nextDeadline } from "@/lib/realtime/use-deadline-now";
import {
  dayConfirmationSchema,
  incidentContactSchema,
  incidentRefusal,
} from "@/lib/validations/incident";
import { missionRefusal } from "@/lib/validations/mission";
import { fr } from "@/lib/i18n/fr";
import { en } from "@/lib/i18n/en";

/**
 * Lot 15 : la saisie du code (« Valider ma journée ») et le « code non
 * remis » s'ouvrent à la fin prévue de chaque journée, lue en base
 * (`completion_available_at`). La base refuse avant ; l'écran reflète.
 */

// Journée de 9 h à 17 h à Douala (UTC+1) et journée de nuit 22 h → 6 h.
const DAY = {
  id: "d1",
  date: "2026-11-18",
  starts_at: "2026-11-18T08:00:00Z",
  ends_at: "2026-11-18T16:00:00Z",
  start_available_at: "2026-11-18T07:45:00Z",
  completion_available_at: "2026-11-18T16:00:00Z",
  started_at: "2026-11-18T08:02:00Z",
  completed_at: null,
  completed_via: null,
};
const NIGHT = {
  ...DAY,
  id: "d2",
  date: "2026-11-19",
  starts_at: "2026-11-19T21:00:00Z",
  ends_at: "2026-11-20T05:00:00Z",
  start_available_at: "2026-11-19T20:45:00Z",
  completion_available_at: "2026-11-20T05:00:00Z",
  started_at: "2026-11-19T21:01:00Z",
};

const mission = (days: unknown[]): MissionTaskState => ({
  status: "in_progress",
  contract_id: null,
  candidate_signed: true,
  started_at: "2026-11-18T08:02:00Z",
  completed_at: null,
  candidate_reviewed: false,
  start_available_at: "2026-11-18T07:45:00Z",
  scheduled_end_at: "2026-11-20T05:00:00Z",
  days,
});

describe("échéance de validation d'une journée", () => {
  it("17 h exactement à Douala : ouverte ; une milliseconde avant : non", () => {
    const [d] = missionDays([DAY]);
    const at = Date.parse("2026-11-18T16:00:00Z");
    expect(dayEndReached(d, at - 1)).toBe(false);
    expect(dayEndReached(d, at)).toBe(true);
  });

  it("journée de 22 h à 6 h : ouverte à 6 h le lendemain, pas à minuit", () => {
    const [d] = missionDays([NIGHT]);
    expect(dayEndReached(d, Date.parse("2026-11-19T23:00:00Z"))).toBe(false);
    expect(dayEndReached(d, Date.parse("2026-11-20T04:59:59Z"))).toBe(false);
    expect(dayEndReached(d, Date.parse("2026-11-20T05:00:00Z"))).toBe(true);
  });

  it("début non confirmé ou journée confirmée : aucune action", () => {
    const after = Date.parse("2026-11-18T18:00:00Z");
    const [notStarted] = missionDays([{ ...DAY, started_at: null }]);
    const [done] = missionDays([
      {
        ...DAY,
        completed_at: "2026-11-18T16:05:00Z",
        completed_via: "support",
      },
    ]);
    expect(dayEndReached(notStarted, after)).toBe(false);
    expect(dayEndReached(done, after)).toBe(false);
    expect(done.completed_via).toBe("support");
  });

  it("l'application ouverte après la fin prévue montre l'action", () => {
    const m = mission([DAY]);
    expect(missionActionCount(m, Date.parse("2026-11-18T15:59:00Z"))).toBe(0);
    expect(missionActionCount(m, Date.parse("2026-11-21T09:00:00Z"))).toBe(1);
  });

  it("sans échéance lue en base : fin prévue de la journée", () => {
    const [d] = missionDays([{ ...DAY, completion_available_at: undefined }]);
    expect(d.completion_available_at).toBe(DAY.ends_at);
  });
});

describe("minuterie calée sur les échéances", () => {
  it("instants des journées non confirmées, prochaine échéance", () => {
    const m = mission([
      DAY,
      NIGHT,
      { ...DAY, id: "d0", completed_at: "2026-11-17T16:00:00Z" },
    ]);
    const instants = missionTaskInstants(m);
    expect(instants).toContain(Date.parse(DAY.completion_available_at));
    expect(instants).toContain(Date.parse(NIGHT.completion_available_at));
    expect(instants).toHaveLength(4);
    expect(nextDeadline(instants, Date.parse("2026-11-18T12:00:00Z"))).toBe(
      Date.parse("2026-11-18T16:00:00Z"),
    );
    expect(nextDeadline(instants, Date.parse("2026-11-21T00:00:00Z"))).toBe(
      null,
    );
  });
});

describe("codes et validations du lot 15", () => {
  it("refus traduits : code avant l'échéance, code non remis", () => {
    expect(missionRefusal("completion_not_open")).toEqual({
      code: "completion_not_open",
      status: 409,
    });
    for (const code of [
      "day_not_ended",
      "start_not_confirmed",
      "use_day_confirmation",
      "company_confirmation_required",
    ]) {
      expect(incidentRefusal(code)?.status).toBe(409);
      expect(fr.incidents.errors).toHaveProperty(code);
      expect(en.incidents.errors).toHaveProperty(code);
    }
    expect(fr.mission.errors.completion_not_open).toContain("{time}");
    expect(en.mission.errors.completion_not_open).toContain("{time}");
  });

  it("contact : demande distincte de la réponse, référence exigée", () => {
    const base = {
      channel: "phone",
      occurred_at: "2026-11-18T17:10:00+01:00",
    };
    expect(
      incidentContactSchema.safeParse({
        ...base,
        entry_type: "request",
        result: "no_answer",
      }).success,
    ).toBe(true);
    // Une réponse n'est pas un résultat de demande, et inversement.
    expect(
      incidentContactSchema.safeParse({
        ...base,
        entry_type: "request",
        result: "work_confirmed",
        reference: "Appel 17 h 10",
      }).error?.issues[0]?.message,
    ).toBe("contact_invalid");
    expect(
      incidentContactSchema.safeParse({
        ...base,
        entry_type: "response",
        result: "work_confirmed",
      }).error?.issues[0]?.message,
    ).toBe("reference_required");
    expect(
      incidentContactSchema.safeParse({
        ...base,
        entry_type: "response",
        result: "work_confirmed",
        reference: "Appel sortant, M. Ndjock",
      }).success,
    ).toBe(true);
    expect(
      incidentContactSchema.safeParse({
        ...base,
        occurred_at: "hier",
        entry_type: "request",
        result: "sent",
      }).error?.issues[0]?.message,
    ).toBe("contact_date_invalid");
  });

  it("confirmation : contact et motif obligatoires", () => {
    expect(
      dayConfirmationSchema.safeParse({ contact_id: "x", reason: "court" })
        .success,
    ).toBe(false);
    expect(
      dayConfirmationSchema.safeParse({
        contact_id: "8f6a2c56-6b1c-4f7e-9d2a-0c8e5b1a2f33",
        reason: "Entreprise jointe, travail confirmé.",
      }).success,
    ).toBe(true);
  });
});
