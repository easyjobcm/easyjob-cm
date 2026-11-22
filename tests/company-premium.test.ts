import { describe, expect, it } from "vitest";
import {
  companyPremiumActionSchema,
  companyPremiumBodyRefusal,
  companyPremiumRefusal,
  companyPremiumStateSchema,
} from "@/lib/validations/company-premium";
import {
  companyCanDirectEdit,
  normalizeCompanyPlan,
} from "@/lib/utils/company-plan";
import {
  accountStateSchema,
  expireLocally,
  nextEntitlementDeadline,
} from "@/lib/realtime/signals";

/**
 * ABO-07 et ABO-08 (2026-11-20) — plan entreprise Free/Premium, attribution
 * par l'équipe, modification directe réservée à Premium. La base revérifie
 * tout (preuve `company-premium`).
 */
const base = {
  request_id: "6f1d3c2e-8a4b-4c5d-9e6f-7a8b9c0d1e2f",
  operation: "activate" as const,
  ends_at: "2027-01-31T23:00:00+01:00",
  expected_until: null,
  reason: "Attribution validée par le support.",
};

const firstCode = (v: unknown) => {
  const r = companyPremiumActionSchema.safeParse(v);
  return r.success ? "ok" : r.error.issues[0]?.message;
};

describe("ABO-07 : corps de la requête d'attribution", () => {
  it("exige une fin explicite pour activer ou prolonger, pas pour arrêter", () => {
    expect(firstCode(base)).toBe("ok");
    expect(firstCode({ ...base, ends_at: null })).toBe("period_invalid");
    expect(firstCode({ ...base, operation: "extend", ends_at: null })).toBe(
      "period_invalid",
    );
    expect(firstCode({ ...base, operation: "stop", ends_at: null })).toBe("ok");
  });

  it("reprend la borne technique du lot 17a, sans durée commerciale", () => {
    expect(firstCode({ ...base, ends_at: "9999-12-31T23:59:59Z" })).toBe("ok");
    expect(firstCode({ ...base, ends_at: "+010000-01-01T00:00:00Z" })).not.toBe(
      "ok",
    );
  });

  it("exige un motif de 10 à 500 caractères", () => {
    expect(firstCode({ ...base, reason: "court" })).toBe("reason_invalid");
    expect(firstCode({ ...base, reason: "x".repeat(501) })).toBe(
      "reason_invalid",
    );
  });

  it("traduit les refus de la base en statuts, sans inventer de code", () => {
    expect(companyPremiumRefusal("forbidden")).toEqual({
      code: "forbidden",
      status: 403,
    });
    expect(companyPremiumRefusal("company_not_found")?.status).toBe(404);
    expect(companyPremiumRefusal("premium_state_changed")?.status).toBe(409);
    expect(companyPremiumRefusal("candidate_not_found")).toBeNull();
    expect(companyPremiumRefusal("unknown_error")).toBeNull();
    expect(companyPremiumBodyRefusal("period_invalid")).toBe("period_invalid");
    expect(companyPremiumBodyRefusal("Invalid input")).toBe("invalid_request");
  });

  it("lit l'historique, reprise des anciens plans comprise", () => {
    const parsed = companyPremiumStateSchema.safeParse({
      server_now: "2026-11-20T10:00:00Z",
      plan: "free",
      premium_until: null,
      premium_started_at: null,
      history: [
        {
          id: "7a1d3c2e-8a4b-4c5d-9e6f-7a8b9c0d1e2f",
          operation: "requalify",
          resulting_plan: "free",
          period_started_at: null,
          previous_ends_at: null,
          ends_at: null,
          legacy_plan: "pro",
          legacy_expires_at: "2026-12-31T00:00:00Z",
          reason: "Compte de test requalifié en Free.",
          source: "requalification",
          actor_role: "admin_ops",
          actor_email: null,
          created_at: "2026-11-20T09:00:00Z",
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});

describe("ABO-07 et ABO-08 : plan effectif à l'écran", () => {
  it("seul « premium » donne Premium ; toute autre valeur vaut Free", () => {
    expect(normalizeCompanyPlan("premium")).toBe("premium");
    for (const v of ["free", null, undefined, "", "Premium", "pro"]) {
      expect(normalizeCompanyPlan(v)).toBe("free");
    }
  });

  it("modification directe réservée à Premium", () => {
    expect(companyCanDirectEdit("premium")).toBe(true);
    expect(companyCanDirectEdit("free")).toBe(false);
  });

  it("Free à l'échéance exacte sur un écran ouvert, sans accorder de droit", () => {
    const state = accountStateSchema.parse({
      user_id: "6f1d3c2e-8a4b-4c5d-9e6f-7a8b9c0d1e2f",
      role: "company",
      is_active: true,
      is_admin: false,
      server_now: "2026-11-20T10:00:00Z",
      company: {
        plan: "premium",
        effective_plan: "premium",
        expires_at: "2026-11-20T10:00:05Z",
        premium_started_at: "2026-11-01T10:00:00Z",
        trial_ends_at: null,
        verification_status: "verified",
        is_active: true,
        renews: null,
      },
    });
    const now = Date.parse("2026-11-20T10:00:00Z");
    expect(nextEntitlementDeadline(state, now)).toBe(5000);
    const after = expireLocally(state, now + 5000);
    expect(after.company?.effective_plan).toBe("free");
    // Une réponse Free ne programme aucune bascule vers Premium.
    expect(nextEntitlementDeadline(after, now + 5000)).toBeNull();
  });
});
