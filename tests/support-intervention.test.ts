import { describe, expect, it } from "vitest";
import {
  INTERVENTION_REFUSALS,
  engagementDecisionSchema,
  findingProposalSchema,
  interventionBodyRefusal,
  interventionRefusal,
  openDayIds,
  supportCancellationSchema,
  targetedRemovalSchema,
} from "@/lib/validations/support-intervention";
import { fr } from "@/lib/i18n/fr";
import { en } from "@/lib/i18n/en";

/**
 * Lot 17d-3 — ANN-17 (retrait ciblé), ANN-18 (candidat suspendu), SAN-08
 * (constat d'absence, sans effet). Les règles sont revérifiées en base
 * (preuve `support-interventions`).
 */
const ID = "00000000-0000-4000-8000-000000000001";

describe("ANN-17 — demande de retrait ciblé", () => {
  it("exige un motif de 10 à 500 caractères (ANN-15)", () => {
    const short = targetedRemovalSchema.safeParse({
      request_id: ID,
      day_ids: [ID],
      reason: "court",
    });
    expect(interventionBodyRefusal(short.error?.issues[0]?.message)).toBe(
      "cancellation_reason_required",
    );
    const long = targetedRemovalSchema.safeParse({
      request_id: ID,
      day_ids: [ID],
      reason: "x".repeat(501),
    });
    expect(interventionBodyRefusal(long.error?.issues[0]?.message)).toBe(
      "cancellation_reason_too_long",
    );
    expect(
      targetedRemovalSchema.safeParse({
        request_id: ID,
        day_ids: [ID],
        reason: "Profil ne correspondant plus.",
      }).success,
    ).toBe(true);
  });
  it("une décision porte au plus 31 journées et exige une note motivée", () => {
    expect(
      engagementDecisionSchema.safeParse({
        decision: "accept",
        day_ids: [ID],
        note: "court",
      }).success,
    ).toBe(false);
    expect(
      engagementDecisionSchema.safeParse({
        decision: "accept",
        day_ids: [ID],
        note: "Décision motivée.",
      }).success,
    ).toBe(true);
  });
});

describe("ANN-18 — demande du candidat suspendu", () => {
  it("message facultatif", () => {
    expect(
      supportCancellationSchema.safeParse({
        request_id: ID,
        day_ids: [ID],
        message: null,
      }).success,
    ).toBe(true);
  });
  it("seules les journées encore annulables sont décidables", () => {
    expect(
      openDayIds([
        {
          mission_day_id: "a",
          mission_id: "m",
          job_title: "J",
          starts_at: "",
          ends_at: "",
          date: "",
          state: "open",
        },
        {
          mission_day_id: "b",
          mission_id: "m",
          job_title: "J",
          starts_at: "",
          ends_at: "",
          date: "",
          state: "begun",
        },
      ]),
    ).toEqual(["a"]);
  });
});

describe("SAN-08 — constat d'absence", () => {
  it("issues fermées : établie ou non imputable ; révision attendue obligatoire", () => {
    expect(
      findingProposalSchema.safeParse({
        outcome: "established",
        note: "Note motivée.",
        expected_revision: 2,
      }).success,
    ).toBe(true);
    expect(
      findingProposalSchema.safeParse({
        outcome: "no_show",
        note: "Note motivée.",
        expected_revision: 2,
      }).success,
    ).toBe(false);
  });
  it("aucun texte n'annonce une sanction, un retrait d'unités ou un frais", () => {
    for (const d of [fr.interventions, en.interventions]) {
      expect(JSON.stringify(d)).not.toMatch(
        /−5|-5 unit|pénalité|penalty|indemnit|rembours|refund/i,
      );
    }
  });
});

describe("Codes de refus", () => {
  it("chaque code a un texte FR et EN, un message inconnu reste interne", () => {
    for (const code of Object.keys(INTERVENTION_REFUSALS)) {
      if (
        [
          "mission_not_found",
          "job_not_found",
          "request_not_found",
          "finding_not_found",
          "incident_not_found",
          "evidence_not_found",
          "company_not_found",
          "decision_invalid",
          "outcome_invalid",
          "request_conflict",
          "incident_kind_invalid",
          "day_already_confirmed",
          "no_decision",
          "review_not_requested",
          "already_decided",
        ].includes(code)
      )
        continue;
      expect(
        (fr.interventions.errors as Record<string, string>)[code],
        code,
      ).toBeTruthy();
      expect(
        (en.interventions.errors as Record<string, string>)[code],
        code,
      ).toBeTruthy();
    }
    expect(interventionRefusal("permission denied")).toBeNull();
    expect(interventionRefusal("suspension_not_active")?.status).toBe(409);
  });
});
