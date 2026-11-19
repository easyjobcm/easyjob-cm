import { describe, expect, it } from "vitest";
import {
  cancellationRefusal,
  cancellationRequestSchema,
  plannedMinutes,
  prorataAmount,
  requiresJustification,
} from "@/lib/validations/cancellation";
import {
  canStartDay,
  dayEndReached,
  missionDays,
  missionTaskInstants,
} from "@/lib/tasks/candidate-tasks";

/**
 * Lots 17b–17c — règles côté écran ; la base les revérifie (preuve
 * `candidate-cancellations`).
 */
describe("montant acquis d'un forfait interrompu", () => {
  it("60 000 XAF sur 8 h, 6 h (nuit) et 6 h : deux journées réalisées → 42 000", () => {
    const total =
      plannedMinutes("08:00", "16:00") +
      plannedMinutes("22:00", "04:00") +
      plannedMinutes("09:00", "15:00");
    const done =
      plannedMinutes("08:00", "16:00") + plannedMinutes("22:00", "04:00");
    expect(total).toBe(1200);
    expect(prorataAmount(60000, done, total)).toBe(42000);
  });

  it("résultat non entier conservé exact (arrondi au franc à valider)", () => {
    const v = prorataAmount(10000, 180, 420);
    expect(v).toBeCloseTo(4285.7142857, 6);
    expect(Math.round(v)).toBe(4286);
  });

  it("journée de nuit : fin le lendemain ; fin égale au début = 24 h", () => {
    expect(plannedMinutes("22:00", "06:00")).toBe(480);
    expect(plannedMinutes("08:00", "08:00")).toBe(1440);
    expect(prorataAmount(5000, 0, 0)).toBe(0);
  });
});

describe("demande d'annulation", () => {
  const base = {
    request_id: "1f2e3d4c-5b6a-4789-9abc-def012345678",
    day_ids: ["2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d"],
    reason_code: null,
    reason_text: null,
    evidence_choice: null,
  };
  const code = (v: unknown) => {
    const r = cancellationRequestSchema.safeParse(v);
    return r.success ? "ok" : r.error.issues[0]?.message;
  };

  it("motif et choix seulement si une journée est hors délai", () => {
    expect(
      requiresJustification(["in_time", "reaction_window", "legacy"]),
    ).toBe(false);
    expect(requiresJustification(["in_time", "late"])).toBe(true);
    expect(code(base)).toBe("ok");
    expect(
      code({
        ...base,
        reason_code: "late_notification",
        evidence_choice: "none",
      }),
    ).toBe("ok");
  });

  it("refuse une liste vide, plus de 31 journées, un motif inconnu", () => {
    expect(code({ ...base, day_ids: [] })).toBe("days_invalid");
    expect(code({ ...base, day_ids: Array(32).fill(base.day_ids[0]) })).toBe(
      "days_invalid",
    );
    expect(code({ ...base, reason_code: "bored" })).toBe("reason_required");
    expect(code({ ...base, evidence_choice: "maybe" })).toBe(
      "evidence_choice_required",
    );
  });

  it("traduit les refus de la base", () => {
    expect(cancellationRefusal("day_already_begun")).toEqual({
      code: "day_already_begun",
      status: 409,
    });
    expect(cancellationRefusal("forbidden")?.status).toBe(403);
    expect(cancellationRefusal("unknown_error")).toBeNull();
  });
});

describe("journée annulée dans Tâches et sur la mission", () => {
  const raw = [
    {
      id: "d1",
      date: "2099-01-02",
      starts_at: "2099-01-02T07:00:00Z",
      ends_at: "2099-01-02T13:00:00Z",
      start_available_at: "2099-01-02T06:45:00Z",
      completion_available_at: "2099-01-02T13:00:00Z",
      started_at: null,
      completed_at: null,
      completed_via: null,
      cancelled_at: "2098-12-30T10:00:00Z",
    },
  ];
  const now = Date.parse("2099-01-02T07:00:00Z");

  it("ni début ni fin de journée, aucune échéance programmée", () => {
    const [d] = missionDays(raw);
    expect(d.cancelled_at).toBe("2098-12-30T10:00:00Z");
    expect(canStartDay({ status: "in_progress" }, d, now)).toBe(false);
    expect(
      dayEndReached(
        { ...d, started_at: "2099-01-02T07:00:00Z" },
        Date.parse("2099-01-02T14:00:00Z"),
      ),
    ).toBe(false);
    expect(
      missionTaskInstants({
        status: "in_progress",
        contract_id: null,
        candidate_signed: null,
        started_at: null,
        completed_at: null,
        candidate_reviewed: null,
        start_available_at: d.start_available_at,
        scheduled_end_at: d.ends_at,
        days: raw,
      }),
    ).toEqual([]);
  });
});
