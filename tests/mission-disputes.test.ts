import { describe, expect, it } from "vitest";
import {
  INCIDENT_RPC_REFUSALS,
  appealDecisionSchema,
  deadlineExtensionSchema,
  incidentContactSchema,
  infoRequestSchema,
  proposalReviewSchema,
  proposalSchema,
} from "@/lib/validations/incident";
import { fr } from "@/lib/i18n/fr";
import { en } from "@/lib/i18n/en";

/**
 * Lot 16 : schémas partagés de l'instruction (la base revérifie tout) et
 * traduction de chaque refus.
 */
const texts = {
  facts_retained: "Présence confirmée par deux témoins.",
  elements_verified: "Journal d'appels et attestation du vigile.",
  contradictions: "L'entreprise conteste l'heure de départ.",
  justification: "Éléments concordants sur la présence.",
};

describe("proposition et seconde validation", () => {
  it("déclaration de conflit d'intérêts exigée", () => {
    expect(
      proposalSchema.safeParse({ outcome: "established", ...texts }).error
        ?.issues[0]?.message,
    ).toBe("conflict_declaration_required");
    expect(
      proposalSchema.safeParse({
        outcome: "established",
        ...texts,
        conflict: "none",
      }).success,
    ).toBe(true);
    expect(
      proposalReviewSchema.safeParse({ approve: true, note: "Relu en entier." })
        .error?.issues[0]?.message,
    ).toBe("conflict_declaration_required");
  });

  it("désaccord persistant : tentative amiable et orientation exigées", () => {
    const base = { outcome: "disagreement", ...texts, conflict: "none" };
    expect(proposalSchema.safeParse(base).error?.issues[0]?.message).toBe(
      "disagreement_followup_required",
    );
    expect(
      proposalSchema.safeParse({
        ...base,
        amicable_attempt: "Médiation proposée le 18/11.",
        orientation: "Inspection du travail de Douala.",
      }).success,
    ).toBe(true);
  });

  it("textes de décision courts refusés", () => {
    expect(
      proposalSchema.safeParse({
        outcome: "partial",
        ...texts,
        justification: "court",
        conflict: "none",
      }).error?.issues[0]?.message,
    ).toBe("decision_text_invalid");
  });
});

describe("révision, délais et contacts", () => {
  it("révision « révisée » : nouveau résultat exigé", () => {
    expect(
      appealDecisionSchema.safeParse({ result: "revised", ...texts }).error
        ?.issues[0]?.message,
    ).toBe("outcome_invalid");
    expect(
      appealDecisionSchema.safeParse({ result: "upheld", ...texts }).success,
    ).toBe(true);
  });

  it("prolongation de 1 à 168 h, motivée", () => {
    expect(
      deadlineExtensionSchema.safeParse({
        hours: 0,
        reason: "Gérant absent cette semaine.",
      }).success,
    ).toBe(false);
    expect(
      deadlineExtensionSchema.safeParse({ hours: 12, reason: "court" }).error
        ?.issues[0]?.message,
    ).toBe("note_invalid");
    expect(
      deadlineExtensionSchema.safeParse({
        hours: 24,
        reason: "Gérant absent cette semaine.",
      }).success,
    ).toBe(true);
  });

  it("complément : destinataire et question", () => {
    expect(
      infoRequestSchema.safeParse({
        party: "admin",
        question: "Question assez longue ?",
      }).error?.issues[0]?.message,
    ).toBe("party_invalid");
  });

  it("canal vérifié facultatif, faux par défaut", () => {
    const parsed = incidentContactSchema.safeParse({
      entry_type: "request",
      channel: "sms",
      occurred_at: "2026-11-18T10:00:00+01:00",
      result: "sent",
    });
    expect(parsed.success && parsed.data.channel_verified).toBe(false);
  });
});

describe("refus traduits", () => {
  it("chaque code de refus a un texte FR et EN", () => {
    for (const code of Object.keys(INCIDENT_RPC_REFUSALS)) {
      expect(fr.incidents.errors).toHaveProperty(code);
      expect(en.incidents.errors).toHaveProperty(code);
    }
  });
});
