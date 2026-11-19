import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  INTERRUPTION_REFUSALS,
  founderInterruptionActionSchema,
  interruptionRefusal,
  interruptionReportSchema,
  parseDayInterruption,
  parseInterruptionTasks,
  partyInterruptionActionSchema,
} from "@/lib/validations/partial-day";
import {
  INCIDENT_KINDS_BY_PARTY,
  incidentRefusal,
  incidentReportSchema,
} from "@/lib/validations/incident";
import { missionRefusal } from "@/lib/validations/mission";
import { acquiredAmountSchema } from "@/lib/validations/cancellation";
import {
  dayEndReached,
  missionDays,
  partialCodeOpen,
} from "@/lib/tasks/candidate-tasks";
import { formatXaf, formatXafExact } from "@/lib/utils";
import { fr } from "@/lib/i18n/fr";
import { en } from "@/lib/i18n/en";

/**
 * Interruption d'une journée commencée (décisions du 2026-11-19 et du
 * 2026-11-20) : règles côté écran et routes. La base revérifie tout ; la
 * preuve `mission-interruptions` établit les pouvoirs et les délais réels.
 */
const UUID = "2d1e2f3a-4b5c-4d6e-8f70-819a2b3c4d5e";
const interruption = (over: Record<string, unknown>) => ({
  incident_id: UUID,
  status: "open",
  outcome: null,
  stage: "instruction",
  blocks_completion: true,
  agreement: null,
  settled_amount: null,
  ...over,
});
const day = (intr: unknown) =>
  missionDays([
    {
      id: "d1",
      date: "2099-06-02",
      starts_at: "2099-06-02T07:00:00Z",
      ends_at: "2099-06-02T15:00:00Z",
      start_available_at: "2099-06-02T06:45:00Z",
      completion_available_at: "2099-06-02T15:00:00Z",
      started_at: "2099-06-02T07:05:00Z",
      completed_at: null,
      completed_via: null,
      cancelled_at: null,
      interruption: intr,
    },
  ])[0];
const beforeEnd = Date.parse("2099-06-02T11:00:00Z");
const afterEnd = Date.parse("2099-06-02T16:00:00Z");

describe("interruption : saisie du code", () => {
  it("dossier non clos ou désaccord non résolu : saisie normale fermée, même après la fin", () => {
    expect(dayEndReached(day(interruption({})), afterEnd)).toBe(false);
    expect(
      dayEndReached(
        day(
          interruption({
            stage: "closed",
            outcome: "disagreement",
            status: "decided",
          }),
        ),
        afterEnd,
      ),
    ).toBe(false);
    // « Non établie » : le parcours normal rouvre à la fin prévue seulement.
    const notEstablished = day(
      interruption({
        stage: "closed",
        outcome: "not_established",
        blocks_completion: false,
      }),
    );
    expect(dayEndReached(notEstablished, beforeEnd)).toBe(false);
    expect(dayEndReached(notEstablished, afterEnd)).toBe(true);
  });

  it("accord des deux parties : code ouvert avant la fin prévue, au montant accepté", () => {
    const d = day(
      interruption({
        stage: "agreement",
        agreement: { proposal_id: UUID, version: 2, amount: 4500 },
      }),
    );
    expect(partialCodeOpen(d)).toBe(true);
    expect(d.interruption?.agreement?.amount).toBe(4500);
    expect(partialCodeOpen(day(interruption({})))).toBe(false);
  });

  it("une forme ancienne (règlement du support) n'est jamais lue comme un accord", () => {
    expect(
      parseDayInterruption({
        incident_id: UUID,
        status: "open",
        outcome: null,
        blocks_completion: true,
        partial_settlement: { code_open: true },
      }),
    ).toBeNull();
  });
});

describe("interruption : actions des parties", () => {
  it("réponse sur une version précise ; aucun montant n'est transmis par une partie", () => {
    const ok = partyInterruptionActionSchema.safeParse({
      action: "respond",
      proposal_id: UUID,
      version: 1,
      decision: "accept",
      amount: 1,
    });
    expect(ok.success).toBe(true);
    expect(ok.success && "amount" in ok.data).toBe(false);
    expect(
      partyInterruptionActionSchema.safeParse({
        action: "respond",
        proposal_id: UUID,
        version: 0,
        decision: "accept",
      }).error?.issues[0]?.message,
    ).toBe("settlement_changed");
    expect(
      partyInterruptionActionSchema.safeParse({ action: "propose" }).success,
    ).toBe(false);
  });

  it("signalement : cause, heure, travail et raison exigés ; pas de nature générique", () => {
    expect(
      interruptionReportSchema.safeParse({
        mission_day_id: UUID,
        cause: "candidate_left",
        declared_at: "2099-06-02T10:00:00+01:00",
        work_done: "Inventaire du rayon A terminé",
        statement: "Malaise, départ à 10 h",
      }).success,
    ).toBe(true);
    expect(
      incidentReportSchema.safeParse({
        mission_day_id: UUID,
        kind: "interruption",
        statement: "x".repeat(20),
      }).success,
    ).toBe(false);
    expect(INCIDENT_KINDS_BY_PARTY.company).toContain("interruption");
  });
});

describe("interruption : décisions du fondateur", () => {
  it("proposition motivée : montant entier, version attendue, aucune règle de prorata", () => {
    const base = {
      action: "propose",
      amount: 4500,
      motivation: "Deux heures sur huit réalisées, constat partagé",
      expected_version: 0,
    };
    expect(founderInterruptionActionSchema.safeParse(base).success).toBe(true);
    for (const [k, v, code] of [
      ["amount", 4500.5, "amount_invalid"],
      ["amount", -1, "amount_invalid"],
      ["motivation", "court", "motivation_invalid"],
      ["expected_version", -1, "settlement_changed"],
    ] as const) {
      expect(
        founderInterruptionActionSchema.safeParse({ ...base, [k]: v }).error
          ?.issues[0]?.message,
      ).toBe(code);
    }
  });

  it("clôtures motivées : « non établie » ou « désaccord non résolu » ; « réglé » vient de l'accord", () => {
    for (const outcome of ["not_established", "disagreement"]) {
      expect(
        founderInterruptionActionSchema.safeParse({
          action: "close",
          outcome,
          motivation: "Éléments contradictoires examinés",
        }).success,
      ).toBe(true);
    }
    expect(
      founderInterruptionActionSchema.safeParse({
        action: "close",
        outcome: "settled",
        motivation: "Éléments contradictoires examinés",
      }).error?.issues[0]?.message,
    ).toBe("closure_outcome_invalid");
  });

  it("prolongation : date de fin explicite et motif ; finalisation : version et motif", () => {
    expect(
      founderInterruptionActionSchema.safeParse({
        action: "extend",
        ends_at: "2099-06-08T12:00:00+01:00",
        reason: "Pièce attendue de l'entreprise",
      }).success,
    ).toBe(true);
    expect(
      founderInterruptionActionSchema.safeParse({
        action: "extend",
        ends_at: "demain",
        reason: "Pièce attendue de l'entreprise",
      }).error?.issues[0]?.message,
    ).toBe("extension_date_invalid");
    expect(
      founderInterruptionActionSchema.safeParse({
        action: "finalize",
        version: 2,
        motivation: "Appel aux deux parties, code non remis",
      }).success,
    ).toBe(true);
  });
});

describe("interruption : bornes validées et réexamen", () => {
  it("montant nul accepté par le schéma comme tout autre montant, jamais négatif ni fractionnaire", () => {
    const base = {
      action: "propose",
      motivation: "Aucun travail exploitable selon les deux versions",
      expected_version: 0,
    };
    expect(
      founderInterruptionActionSchema.safeParse({ ...base, amount: 0 }).success,
    ).toBe(true);
    for (const amount of [-1, 0.5, 3809.4]) {
      expect(
        founderInterruptionActionSchema.safeParse({ ...base, amount }).error
          ?.issues[0]?.message,
      ).toBe("amount_invalid");
    }
  });

  it("réexamen : demande motivée d'une partie, décision du fondateur parmi trois issues", () => {
    expect(
      partyInterruptionActionSchema.safeParse({
        action: "reexamination",
        reason: "La photo prouve l'arrêt demandé par l'entreprise",
      }).success,
    ).toBe(true);
    expect(
      partyInterruptionActionSchema.safeParse({
        action: "reexamination",
        reason: "court",
      }).error?.issues[0]?.message,
    ).toBe("motivation_invalid");
    for (const decision of ["maintained", "reopened", "separate_handling"]) {
      expect(
        founderInterruptionActionSchema.safeParse({
          action: "reexamination",
          reexamination_id: UUID,
          decision,
          motivation: "Élément nouveau examiné avec les deux versions",
        }).success,
      ).toBe(true);
    }
    expect(
      founderInterruptionActionSchema.safeParse({
        action: "reexamination",
        reexamination_id: UUID,
        decision: "cancel_settlement",
        motivation: "Élément nouveau examiné avec les deux versions",
      }).success,
    ).toBe(false);
  });

  it("codes des bornes, de la prolongation et du réexamen traduits", () => {
    for (const code of [
      "amount_above_cap",
      "extension_already_used",
      "requires_separate_handling",
      "reexamination_obsolete",
    ]) {
      expect(interruptionRefusal(code)?.status).toBeGreaterThanOrEqual(400);
    }
    expect(fr.partialDay.dayState.unresolved).toBe(
      "Interrompue — règlement non résolu",
    );
    expect(en.partialDay.finance.notPaid).toMatch(/not a payment/);
  });
});

describe("interruption : terminologie et précision", () => {
  const strings = (v: unknown): string[] =>
    typeof v === "string"
      ? [v]
      : v && typeof v === "object"
        ? Object.values(v).flatMap(strings)
        : [];

  it("« accord finalisé », jamais « réglé » ni un versement présenté comme effectué", () => {
    const frTexts = strings(fr.partialDay);
    const enTexts = strings(en.partialDay);
    expect(frTexts.some((t) => /réglé/i.test(t))).toBe(false);
    expect(enTexts.some((t) => /\bsettled\b/i.test(t))).toBe(false);
    expect(fr.partialDay.finance.settled).toMatch(/^Accord finalisé/);
    expect(en.partialDay.finance.settled).toMatch(/^Agreement finalised/);
    expect(
      [...frTexts, ...enTexts].some((t) =>
        /\b(versé|a été payé|was paid|has been paid)\b/i.test(t),
      ),
    ).toBe(false);
  });

  it("total calculé affiché sans arrondi au franc ; montants entiers inchangés", () => {
    expect(formatXafExact(7618.5238, "en")).toBe("7,618.5238 CFA francs");
    expect(formatXafExact(3809, "en")).toBe("3,809 CFA francs");
    expect(formatXaf(7618.5238, "en")).toBe(formatXaf(7619, "en"));
  });
});

describe("interruption : codes, tâches et textes", () => {
  it("codes des routes traduits en FR et EN", () => {
    for (const code of Object.keys(INTERRUPTION_REFUSALS)) {
      if (code === "invalid_request" || code === "not_authenticated") continue;
      expect(fr.partialDay.errors).toHaveProperty(code);
      expect(en.partialDay.errors).toHaveProperty(code);
    }
    expect(interruptionRefusal("settlement_rule_pending")?.status).toBe(409);
    expect(interruptionRefusal("proposal_expired")?.status).toBe(409);
    expect(incidentRefusal("response_deadline_passed")?.status).toBe(409);
    expect(incidentRefusal("use_founder_decision")?.status).toBe(409);
    expect(missionRefusal("interruption_unresolved")?.status).toBe(409);
    expect(interruptionRefusal("unknown")).toBeNull();
  });

  it("tâches : entrées invalides ignorées, échéance conservée", () => {
    const tasks = parseInterruptionTasks([
      {
        incident_id: UUID,
        mission_id: UUID,
        job_id: UUID,
        job_title: "Inventaire",
        day_date: "2099-06-02",
        viewer: "company",
        stage: "awaiting_parties",
        action: "respond_proposal",
        due_at: "2099-06-04T10:00:00Z",
        proposal_id: UUID,
        version: 1,
        amount: 4500,
      },
      { action: "respond_proposal" },
    ]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].due_at).toBe("2099-06-04T10:00:00Z");
  });

  it("montant acquis : journée en examen ou en désaccord jamais présentée comme nulle", () => {
    expect(
      acquiredAmountSchema.safeParse({
        mission_id: UUID,
        currency: "XAF",
        contract_pay: 30000,
        planned_minutes_total: 1440,
        realized_minutes: 480,
        acquired_exact: 10000,
        acquired_rounded: 10000,
        is_integer: true,
        settled_total: 0,
        status: "settlement_pending",
        days: [
          {
            date: "2099-06-03",
            start_time: "08:00:00",
            end_time: "16:00:00",
            planned_minutes: 480,
            realized: false,
            cancelled: false,
            realized_via: null,
            awaiting_settlement: true,
            unresolved: false,
            settled_amount: null,
          },
        ],
      }).success,
    ).toBe(true);
    expect(fr.partialDay.amount.under_review).toMatch(/pas dire zéro/);
    expect(en.partialDay.amount.under_review).toMatch(/not mean zero/);
    expect(fr.partialDay.amount.unresolved).toMatch(/ni une sanction/);
  });

  it("l'ancienne route de règlement (support ou entreprise) n'existe plus", () => {
    const root = path.resolve(__dirname, "..");
    expect(fs.existsSync(path.join(root, "app/api/partial-settlements"))).toBe(
      false,
    );
  });
});
