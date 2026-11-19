import { describe, expect, it } from "vitest";
import { JOB_RPC_REFUSALS, jobClosureSchema } from "@/lib/validations/job";
import { fr } from "@/lib/i18n/fr";
import { en } from "@/lib/i18n/en";

/**
 * Lot 17d-1 : clôture d'une offre publiée. Mêmes bornes de motif que
 * `close_job` (10 à 500 caractères après suppression des espaces) ; chaque
 * code de refus de la clôture et de la suppression est traduit en français
 * et en anglais, et l'écran n'annonce aucun outil d'annulation absent.
 */
const CODES = [
  "job_published",
  "job_not_published",
  "job_not_closable",
  "job_closed",
  "closure_reason_required",
  "closure_reason_too_long",
  "job_has_commitments",
] as const;

describe("jobClosureSchema", () => {
  it("exige un motif de 10 caractères au moins, espaces retirés", () => {
    const short = jobClosureSchema.safeParse({ reason: "   court   " });
    expect(short.success).toBe(false);
    expect(short.error?.issues[0]?.message).toBe("closure_reason_required");
    expect(jobClosureSchema.safeParse({}).success).toBe(false);
    const ok = jobClosureSchema.safeParse({
      reason: "  Besoin annulé par le client  ",
    });
    expect(ok.success && ok.data.reason).toBe("Besoin annulé par le client");
  });

  it("refuse un motif de plus de 500 caractères", () => {
    expect(
      jobClosureSchema.safeParse({ reason: "x".repeat(500) }).success,
    ).toBe(true);
    const long = jobClosureSchema.safeParse({ reason: "x".repeat(501) });
    expect(long.error?.issues[0]?.message).toBe("closure_reason_too_long");
  });
});

describe("codes de la clôture", () => {
  it("sont connus des routes avec un statut HTTP de refus", () => {
    for (const code of CODES) {
      expect(JOB_RPC_REFUSALS[code]).toBeGreaterThanOrEqual(400);
    }
  });

  it("sont traduits en français et en anglais", () => {
    for (const code of CODES) {
      expect(fr.companyJobs.errors[code]).toBeTruthy();
      expect(en.companyJobs.errors[code]).toBeTruthy();
    }
  });

  it("orientent vers le support sans promettre d'outil d'annulation", () => {
    for (const text of [
      fr.companyJobs.errors.job_has_commitments,
      fr.companyJobs.supportDialog.description,
      en.companyJobs.errors.job_has_commitments,
      en.companyJobs.supportDialog.description,
    ]) {
      expect(text).toMatch(/support/i);
      expect(text).not.toMatch(
        /annuler l'offre|cancel the job|rembours|refund/i,
      );
    }
  });
});
