import { describe, expect, it } from "vitest";
import {
  COMPANY_CANCELLATION_REFUSALS,
  companyCancellationBodyRefusal,
  companyCancellationRefusal,
  companyCancellationRequestSchema,
  dayIdsForDates,
  groupPreviewByDate,
  type CompanyCancellationPreviewDay,
} from "@/lib/validations/company-cancellation";
import { fr } from "@/lib/i18n/fr";
import { en } from "@/lib/i18n/en";

/**
 * Lot 17d-2 — annulation par l'entreprise après sélection.
 * ANN-06 : qualification (dans le délai, tardive, antérieure) sans
 * conséquence ; ANN-04 étendu : une demande = un événement ; ANN-08 (à
 * confirmer) : dates entières, pas de retrait ciblé d'un candidat.
 * Les règles sont revérifiées en base (preuve `company-cancellations`).
 */

const day = (
  over: Partial<CompanyCancellationPreviewDay>,
): CompanyCancellationPreviewDay => ({
  mission_day_id: "00000000-0000-4000-8000-000000000001",
  mission_id: "00000000-0000-4000-8000-0000000000a1",
  application_id: "00000000-0000-4000-8000-0000000000b1",
  job_id: "00000000-0000-4000-8000-0000000000c1",
  day_date: "2099-03-02",
  start_time: "08:00:00",
  end_time: "14:00:00",
  starts_at: "2099-03-02T07:00:00Z",
  first_name: "Awa",
  last_initial: "N",
  state: "cancellable",
  classification: "in_time",
  company_plan: "free",
  cancellation_notice_hours: 48,
  deadline_at: "2099-02-28T07:00:00Z",
  ...over,
});

describe("ANN-08 (dates entières) — regroupement de l'aperçu", () => {
  const preview = [
    day({}),
    day({
      mission_day_id: "00000000-0000-4000-8000-000000000002",
      application_id: "00000000-0000-4000-8000-0000000000b2",
      classification: "late",
    }),
    day({
      mission_day_id: "00000000-0000-4000-8000-000000000003",
      day_date: "2099-03-01",
      starts_at: "2099-03-01T07:00:00Z",
    }),
    day({
      mission_day_id: "00000000-0000-4000-8000-000000000004",
      day_date: "2099-03-03",
      starts_at: "2099-03-03T07:00:00Z",
      state: "begun",
    }),
  ];

  it("regroupe par date de l'offre, triée par début", () => {
    const dates = groupPreviewByDate(preview);
    expect(dates.map((d) => d.day_date)).toEqual([
      "2099-03-01",
      "2099-03-02",
      "2099-03-03",
    ]);
    expect(dates[1].days).toHaveLength(2);
  });

  it("une date choisie emporte tous ses candidats (aucun retrait ciblé)", () => {
    const dates = groupPreviewByDate(preview);
    const ids = dayIdsForDates(dates, new Set([dates[1].key]));
    expect(ids.sort()).toEqual([
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    ]);
  });

  it("une date dont le début est atteint n'est jamais envoyée", () => {
    const dates = groupPreviewByDate(preview);
    expect(dates[2].state).toBe("begun");
    expect(dayIdsForDates(dates, new Set([dates[2].key]))).toEqual([]);
  });

  it("une sous-offre à la même date reste une date distincte", () => {
    const dates = groupPreviewByDate([
      day({}),
      day({
        mission_day_id: "00000000-0000-4000-8000-000000000009",
        job_id: "00000000-0000-4000-8000-0000000000c2",
      }),
    ]);
    expect(dates).toHaveLength(2);
  });
});

describe("Demande d'annulation — validation partagée", () => {
  const base = {
    request_id: "00000000-0000-4000-8000-00000000f001",
    day_ids: ["00000000-0000-4000-8000-000000000001"],
    reason: "Événement annulé par notre client.",
    acknowledge_late: false,
  };

  it("accepte une demande complète", () => {
    expect(companyCancellationRequestSchema.safeParse(base).success).toBe(true);
  });

  it("ANN-08 : motif obligatoire de 10 à 500 caractères (espaces retirés)", () => {
    const short = companyCancellationRequestSchema.safeParse({
      ...base,
      reason: "   court   ",
    });
    expect(short.success).toBe(false);
    expect(
      companyCancellationBodyRefusal(short.error?.issues[0]?.message),
    ).toBe("cancellation_reason_required");
    const long = companyCancellationRequestSchema.safeParse({
      ...base,
      reason: "x".repeat(501),
    });
    expect(companyCancellationBodyRefusal(long.error?.issues[0]?.message)).toBe(
      "cancellation_reason_too_long",
    );
  });

  it("exige une clé de demande et au moins une journée", () => {
    for (const over of [{ request_id: "x" }, { day_ids: [] }]) {
      expect(
        companyCancellationRequestSchema.safeParse({ ...base, ...over })
          .success,
      ).toBe(false);
    }
  });

  it("traduit les refus de la base en statuts et ignore un message inconnu", () => {
    expect(companyCancellationRefusal("late_not_acknowledged")).toEqual({
      code: "late_not_acknowledged",
      status: 409,
    });
    expect(companyCancellationRefusal("job_not_found")?.status).toBe(404);
    expect(companyCancellationRefusal("permission denied")).toBeNull();
  });

  it("chaque code de refus a un texte FR et EN", () => {
    for (const code of Object.keys(COMPANY_CANCELLATION_REFUSALS)) {
      expect(
        (fr.companyCancellation.errors as Record<string, string>)[code],
      ).toBeTruthy();
      expect(
        (en.companyCancellation.errors as Record<string, string>)[code],
      ).toBeTruthy();
    }
  });
});

describe("ANN-06 — textes sans conséquence inventée", () => {
  it("la qualification tardive n'annonce ni sanction, ni frais dus, ni indemnité", () => {
    for (const dict of [fr.companyCancellation, en.companyCancellation]) {
      const all = JSON.stringify(dict);
      expect(all).not.toMatch(
        /pénalit|penalt|indemnit|compensation|rembours|refund|−5|-5 unit/i,
      );
    }
  });
});
