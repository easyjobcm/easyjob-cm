import { describe, expect, it } from "vitest";
import {
  doualaToday,
  jobInputSchema,
  jobModerationSchema,
  jobRefusal,
  MISSION_PAY_MAX,
} from "@/lib/validations/job";
import { canEditJob } from "@/lib/utils/job-status";
import { formatXaf } from "@/lib/utils";
import { frozenMissionPay } from "@/lib/utils/mission-pay";

const valid = {
  title: "Serveur",
  description: "Service en salle.",
  address: "Rue Joss",
  city: "Douala",
  start_date: "2099-01-15",
  start_time: "09:00",
  end_time: "17:00",
  mission_pay_per_candidate: 10000,
};

const firstIssue = (input: Record<string, unknown>) =>
  jobInputSchema.safeParse(input).error?.issues[0]?.message;

describe("jobInputSchema", () => {
  it("accepte une offre valide et retire les champs réservés", () => {
    const parsed = jobInputSchema.parse({
      ...valid,
      company_id: "00000000-0000-0000-0000-000000000000",
      status: "active",
      positions_filled: 4,
    });
    expect(parsed).not.toHaveProperty("company_id");
    expect(parsed).not.toHaveProperty("status");
    expect(parsed).not.toHaveProperty("positions_filled");
    expect(parsed.urgency).toBe("normal");
  });

  it("refuse les données invalides avec une clé traduite", () => {
    expect(firstIssue({ ...valid, title: " " })).toBe("titleRequired");
    expect(firstIssue({ ...valid, start_date: "2000-01-01" })).toBe(
      "startDatePast",
    );
    expect(firstIssue({ ...valid, end_date: "2099-01-10" })).toBe(
      "endDateBeforeStart",
    );
    expect(firstIssue({ ...valid, mission_pay_per_candidate: 0 })).toBe(
      "missionPayInvalid",
    );
    expect(
      jobInputSchema.safeParse({ ...valid, urgency: "critical" }).success,
    ).toBe(false);
  });

  it("accepte un montant entier par candidat et refuse nul, négatif, fraction, absent et ancien taux", () => {
    expect(
      jobInputSchema.parse({ ...valid, positions_available: 3 })
        .mission_pay_per_candidate,
    ).toBe(10000);
    expect(firstIssue({ ...valid, mission_pay_per_candidate: -1 })).toBe(
      "missionPayInvalid",
    );
    expect(firstIssue({ ...valid, mission_pay_per_candidate: 10000.5 })).toBe(
      "missionPayInteger",
    );
    expect(
      firstIssue({ ...valid, mission_pay_per_candidate: Number.NaN }),
    ).toBe("missionPayRequired");
    expect(
      firstIssue({ ...valid, mission_pay_per_candidate: MISSION_PAY_MAX + 1 }),
    ).toBe("missionPayTooHigh");
    const { mission_pay_per_candidate: _omit, ...withoutPay } = valid;
    void _omit;
    expect(firstIssue({ ...withoutPay, hourly_rate: 1500 })).toBe(
      "missionPayRequired",
    );
    // Un ancien champ n'est jamais transmis à la base.
    expect(
      jobInputSchema.parse({ ...valid, hourly_rate: 1500 }),
    ).not.toHaveProperty("hourly_rate");
  });

  it("formate le montant en F CFA (fr) et en CFA francs (en)", () => {
    expect(formatXaf(10000, "fr").replace(/\s/g, " ")).toBe("10 000 F CFA");
    expect(formatXaf(10000, "en").replace(/\s/g, " ")).toBe(
      "10,000 CFA francs",
    );
  });

  it("calcule la date du jour à Douala (UTC+1)", () => {
    expect(doualaToday(new Date("2026-11-01T23:30:00Z"))).toBe("2026-11-02");
  });
});

describe("jobModerationSchema", () => {
  it("exige un motif d'au moins 3 caractères pour un refus", () => {
    expect(jobModerationSchema.safeParse({ action: "reject" }).success).toBe(
      false,
    );
    expect(
      jobModerationSchema.safeParse({ action: "reject", reason: "Tenue ?" })
        .success,
    ).toBe(true);
    expect(jobModerationSchema.safeParse({ action: "approve" }).success).toBe(
      true,
    );
  });
});

describe("jobRefusal", () => {
  it("traduit les codes des RPC et ignore les autres erreurs", () => {
    expect(jobRefusal("job_not_pending")).toEqual({
      code: "job_not_pending",
      status: 409,
    });
    expect(jobRefusal("company_not_verified")?.status).toBe(403);
    expect(jobRefusal("job_has_commitments")?.status).toBe(409);
    expect(jobRefusal("duplicate key value")).toBeNull();
  });
});

describe("canEditJob", () => {
  it("applique la règle retenue au lot 6", () => {
    const job = (status: string, positions_filled = 0) => ({
      status,
      positions_filled,
    });
    expect(canEditJob(job("pending_review"), false)).toBe(true);
    expect(canEditJob(job("rejected"), false)).toBe(true);
    expect(canEditJob(job("active"), false)).toBe(false);
    expect(canEditJob(job("active"), true)).toBe(true);
    expect(canEditJob(job("active", 1), true)).toBe(false);
    expect(canEditJob(job("filled"), true)).toBe(false);
  });
});

describe("frozenMissionPay", () => {
  it("lit le montant figé du contrat, sans jamais l'inventer", () => {
    expect(
      frozenMissionPay({
        mission_pay_per_candidate: 10000,
        currency: "XAF",
        pay_basis: "per_mission",
      }),
    ).toBe(10000);
    expect(frozenMissionPay({ hourly_rate: 1500 })).toBeNull();
    expect(frozenMissionPay({ mission_pay_per_candidate: 10000.5 })).toBeNull();
    expect(frozenMissionPay(null)).toBeNull();
    expect(frozenMissionPay([10000])).toBeNull();
  });
});
