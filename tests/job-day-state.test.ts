import { describe, expect, it } from "vitest";
import {
  conflictingDays,
  dayChoosable,
  dayHasConflict,
  dayState,
  droppedSelection,
  type CandidateJobDay,
} from "@/lib/jobs/day-state";

/**
 * Lot 12 : l'écran lit le verdict de la base (`schedule_compatible`) et
 * n'en déduit rien lui-même. Ces tests fixent l'ordre des états et le
 * traitement d'une journée cochée devenue inaccessible.
 */
const NOW = Date.parse("2099-01-01T00:00:00Z");

function day(over: Partial<CandidateJobDay> = {}): CandidateJobDay {
  return {
    day_id: "d1",
    day_date: "2099-01-10",
    start_time: "08:00:00",
    end_time: "12:00:00",
    starts_at: "2099-01-10T07:00:00+00:00",
    ends_at: "2099-01-10T11:00:00+00:00",
    mission_pay_per_candidate: 5000,
    applications_close_at: "2099-01-09T07:00:00+00:00",
    recruitment_open: true,
    is_full: false,
    my_application_id: null,
    my_application_status: null,
    schedule_compatible: true,
    schedule_reason: null,
    server_now: "2099-01-01T00:00:00+00:00",
    ...over,
  };
}

const conflict = {
  schedule_compatible: false,
  schedule_reason: "schedule_conflict",
};

describe("état d'une journée", () => {
  it("conflit seulement sur un verdict explicite de la base", () => {
    expect(dayState(day(), NOW)).toBe("open");
    expect(dayState(day(conflict), NOW)).toBe("conflict");
    // Null : la question ne se pose pas (visiteur, non-candidat) : jamais
    // présenté comme un conflit.
    expect(dayState(day({ schedule_compatible: null }), NOW)).toBe("open");
    expect(dayHasConflict(day({ schedule_compatible: null }))).toBe(false);
  });

  it("même ordre que les refus de la base : candidature, clôture, capacité, conflit", () => {
    expect(
      dayState(
        day({ ...conflict, my_application_status: "pending", is_full: true }),
        NOW,
      ),
    ).toBe("pending");
    expect(
      dayState(
        day({
          ...conflict,
          is_full: true,
          applications_close_at: "2098-12-31T00:00:00+00:00",
        }),
        NOW,
      ),
    ).toBe("closed");
    expect(dayState(day({ ...conflict, recruitment_open: false }), NOW)).toBe(
      "closed",
    );
    expect(dayState(day({ ...conflict, is_full: true }), NOW)).toBe("full");
  });

  it("à l'instant exact de l'échéance, la journée est close", () => {
    const close = Date.parse("2099-01-09T07:00:00+00:00");
    expect(dayState(day(), close - 1)).toBe("open");
    expect(dayState(day(), close)).toBe("closed");
  });

  it("une journée incompatible reste visible mais n'est pas cochable", () => {
    expect(dayChoosable(day(), NOW)).toBe(true);
    expect(dayChoosable(day(conflict), NOW)).toBe(false);
    // Journée implicite d'une offre antérieure (sans identifiant).
    expect(dayChoosable(day({ day_id: null }), NOW)).toBe(false);
  });

  it("période complète : une seule journée incompatible est identifiée", () => {
    const days = [
      day({ day_id: "a", day_date: "2099-01-10" }),
      day({ day_id: "b", day_date: "2099-01-12", ...conflict }),
      day({ day_id: "c", day_date: "2099-01-14" }),
    ];
    expect(conflictingDays(days).map((d) => d.day_date)).toEqual([
      "2099-01-12",
    ]);
    // Candidature déjà déposée : l'état vient de la candidature.
    expect(
      conflictingDays(
        days.map((d) => ({ ...d, my_application_status: "pending" as const })),
      ),
    ).toEqual([]);
  });
});

describe("journées cochées devenues inaccessibles", () => {
  const days = [
    day({ day_id: "ok", day_date: "2099-01-10" }),
    day({ day_id: "conflict", day_date: "2099-01-11", ...conflict }),
    day({ day_id: "full", day_date: "2099-01-12", is_full: true }),
    day({
      day_id: "closed",
      day_date: "2099-01-13",
      applications_close_at: "2098-12-31T00:00:00+00:00",
    }),
    day({
      day_id: "applied",
      day_date: "2099-01-14",
      my_application_status: "pending",
    }),
  ];

  it("garde les journées compatibles et nomme le motif des autres", () => {
    expect(
      droppedSelection(
        ["ok", "conflict", "full", "closed", "applied", "gone"],
        days,
        NOW,
      ),
    ).toEqual([
      { id: "conflict", date: "2099-01-11", reason: "schedule_conflict" },
      { id: "full", date: "2099-01-12", reason: "no_positions" },
      { id: "closed", date: "2099-01-13", reason: "recruitment_closed" },
      { id: "applied", date: "2099-01-14", reason: "already_applied" },
      { id: "gone", date: "", reason: null },
    ]);
  });

  it("ne retire rien d'un choix entièrement compatible", () => {
    expect(droppedSelection(["ok"], days, NOW)).toEqual([]);
    expect(droppedSelection([], days, NOW)).toEqual([]);
  });
});

/**
 * Lot 17d-4a (ANN-08) : date entière annulée par l'entreprise, lue en base
 * (`job_days_for_candidate.date_cancelled`), même échéance encore ouverte.
 */
describe("journée dont la date est annulée par l'entreprise", () => {
  it("jamais cochable, même échéance ouverte", () => {
    const d = day({ date_cancelled: true, recruitment_open: false });
    expect(dayState(d, NOW)).toBe("cancelled");
    expect(dayChoosable(d, NOW)).toBe(false);
  });

  it("une candidature en attente n'est plus retenable ; une sélection garde son état", () => {
    expect(
      dayState(
        day({ date_cancelled: true, my_application_status: "pending" }),
        NOW,
      ),
    ).toBe("cancelled");
    expect(
      dayState(
        day({ date_cancelled: true, my_application_status: "selected" }),
        NOW,
      ),
    ).toBe("selected");
  });

  it("journée cochée puis annulée : décochée avec le motif date_cancelled", () => {
    const d = day({ date_cancelled: true, recruitment_open: false });
    expect(droppedSelection(["d1"], [d], NOW)).toEqual([
      { id: "d1", date: "2099-01-10", reason: "date_cancelled" },
    ]);
  });
});
