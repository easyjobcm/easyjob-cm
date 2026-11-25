import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  REPLACEMENT_REFUSALS,
  REPLACEMENT_STATES,
  replacementInterestSchema,
  replacementRefusal,
  replacementState,
} from "@/lib/validations/replacement";
import { JOB_RPC_REFUSALS } from "@/lib/validations/job";
import { fr } from "@/lib/i18n/fr";
import { en } from "@/lib/i18n/en";

/**
 * Lot 17d-4a — ANN-14 (recrutement de remplacement après désistement :
 * déclencheur, fenêtre 4 h / H−2, destinataires, confirmation liée au cycle)
 * et ANN-20 (candidat à l'origine du désistement exclu). Les règles sont
 * appliquées et revérifiées en base (preuve `replacement-cycles`).
 */
const migration = readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/20261128120000_replacement_recruitment.sql",
  ),
  "utf8",
);

describe("ANN-14 — confirmation d'intérêt explicite", () => {
  it("exige le consentement (true), jamais déduit", () => {
    expect(replacementInterestSchema.safeParse({ consent: true }).success).toBe(
      true,
    );
    for (const body of [{}, { consent: false }, { consent: "true" }, null]) {
      const r = replacementInterestSchema.safeParse(body);
      expect(r.success).toBe(false);
    }
  });

  it("traduit chaque code de la base, côté candidat (FR et EN)", () => {
    const candidate = (dict: typeof fr) => ({
      ...dict.replacement.candidate.errors,
      ...dict.replacement.candidate.blockers,
    });
    for (const code of Object.keys(REPLACEMENT_REFUSALS)) {
      expect(replacementRefusal(code)?.code).toBe(code);
      expect(candidate(fr), code).toHaveProperty(code);
      expect(candidate(en), code).toHaveProperty(code);
    }
    expect(replacementRefusal("inconnu")).toBeNull();
  });

  it("la sélection hors fenêtre a son code, traduit pour l'entreprise", () => {
    expect(JOB_RPC_REFUSALS.replacement_closed).toBe(409);
    expect(fr.companyApplicants.errors.replacement_closed).toMatch(/2 h/);
    expect(en.companyApplicants.errors.replacement_closed).toMatch(/2-hour/);
  });

  // ANN-08 (dates entières) × ANN-14 : date annulée par l'entreprise.
  it("cycle d'une date annulée : code et état propres, traduits (FR et EN)", () => {
    expect(JOB_RPC_REFUSALS.replacement_cancelled).toBe(409);
    expect(REPLACEMENT_REFUSALS.replacement_cancelled).toBe(409);
    expect(replacementState("cancelled")).toBe("cancelled");
    for (const dict of [fr, en]) {
      expect(dict.companyApplicants.errors.replacement_cancelled).toBeTruthy();
      expect(
        dict.replacement.candidate.errors.replacement_cancelled,
      ).toBeTruthy();
      expect(dict.replacement.candidate.cancelled).toBeTruthy();
      expect(dict.replacement.company.states.cancelled).toBeTruthy();
    }
  });

  it("annulation par l'entreprise : neutralisation dans la même transaction", () => {
    const fnText = (name: string) => {
      const start = migration.lastIndexOf(
        `create or replace function public.${name}(`,
      );
      return migration.slice(start, migration.indexOf("\n$$;\n", start));
    };
    expect(fnText("request_company_cancellation")).toMatch(
      /perform public\.replacement_cycles_on_company_cancellation\(v_id\)/,
    );
    expect(fnText("selection_prepare")).toMatch(/replacement_cancelled/);
    expect(fnText("confirm_replacement_interest")).toMatch(
      /replacement_cancelled/,
    );
    expect(fnText("replacement_cycle_on_withdrawal")).toMatch(
      /company_date_cancelled/,
    );
  });

  it("ANN-22 : seul un dossier non valide retient les avis (pas la suspension)", () => {
    const start = migration.lastIndexOf(
      "create or replace function public.replacement_cycle_alert(",
    );
    const body = migration.slice(start, migration.indexOf("\n$$;\n", start));
    expect(body).toMatch(
      /if not public\.company_dossier_valid\(v_job\.company_id\) then/,
    );
    expect(body).not.toMatch(/is_active/);
  });

  it("état inconnu lu comme fermé (jamais présenté comme ouvert)", () => {
    for (const s of REPLACEMENT_STATES) expect(replacementState(s)).toBe(s);
    expect(replacementState(null)).toBe("closed");
    expect(replacementState("autre")).toBe("closed");
    for (const s of REPLACEMENT_STATES) {
      expect(fr.replacement.company.states).toHaveProperty(s);
    }
  });
});

describe("ANN-14 — textes : aucune promesse ni e-mail annoncé", () => {
  const texts = (dict: typeof fr) => JSON.stringify(dict.replacement);
  it("aucune garantie de remplacement, aucun e-mail, aucun paiement", () => {
    for (const dict of [fr, en]) {
      const t = texts(dict);
      expect(t).not.toMatch(/garanti|guarantee/i);
      expect(t).not.toMatch(/e-?mail/i);
      expect(t).not.toMatch(/paiement|payment|rembours|refund|frais|fee/i);
    }
  });
  it("la confirmation ne vaut pas sélection et ne réactive rien", () => {
    expect(fr.replacement.candidate.noSelectionPromise).toMatch(
      /ne vaut pas sélection/,
    );
    expect(fr.replacement.candidate.dialogBody).toMatch(/reste inchangée/);
    expect(en.replacement.candidate.dialogBody).toMatch(/stays unchanged/);
  });
});

describe("ANN-14 — garde-fous de la migration", () => {
  it("seuils : ouverture au moins 4 h avant, fermeture à H−2", () => {
    expect(migration).toMatch(/v_start - now\(\) < interval '4 hours'/);
    expect(migration).toMatch(/closes_at = starts_at - interval '2 hours'/);
    expect(migration).toMatch(/now\(\) >= v_cycle\.closes_at/);
  });
  it("seul le désistement enregistré ouvre un cycle", () => {
    const callers = migration.match(/replacement_cycle_on_withdrawal\(v_id/g);
    expect(callers).toHaveLength(1);
    expect(migration).not.toMatch(
      /request_company_cancellation[\s\S]{0,200}replacement_cycle_on_withdrawal/,
    );
  });
  it("une confirmation par cycle, ancienne candidature jamais réactivée", () => {
    expect(migration).toMatch(/job_applications_cycle_candidate_key/);
    expect(migration).toMatch(
      /where job_day_id is null and replacement_cycle_id is null/,
    );
  });
  it("ANN-20 : le candidat à l'origine du désistement est exclu", () => {
    expect(migration).toMatch(/'replacement_own_withdrawal'/);
  });
  it("aucun frais, paiement ni e-mail dans la migration", () => {
    const code = migration
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(code).not.toMatch(/payment|wallet|withdrawal_requests|net\.http/i);
    expect(code).not.toMatch(/sent_email/);
  });
});

describe("ANN-08 — date annulée : recrutement ordinaire fermé", () => {
  it("code et textes FR/EN (candidature, sélection, journée, période)", () => {
    expect(JOB_RPC_REFUSALS.date_cancelled).toBe(409);
    for (const dict of [fr, en]) {
      expect(dict.application.refusals.date_cancelled).toBeTruthy();
      expect(dict.companyApplicants.errors.date_cancelled).toBeTruthy();
      expect(dict.schedule.dayState.cancelled).toBeTruthy();
      expect(dict.schedule.blocked.date_cancelled).toMatch(/\{date\}/);
      expect(dict.jobDetail.dateCancelledBody).toBeTruthy();
    }
  });

  it("contrôle en base : candidature, sélection, retrait ciblé exclu", () => {
    const fnText = (name: string) => {
      const start = migration.lastIndexOf(
        `create or replace function public.${name}(`,
      );
      return migration.slice(start, migration.indexOf("\n$$;\n", start));
    };
    expect(fnText("company_date_cancelled")).toMatch(
      /support_request_id is null/,
    );
    expect(fnText("apply_to_job_core")).toMatch(/'date_cancelled'/);
    expect(fnText("selection_prepare")).toMatch(/'date_cancelled'/);
    expect(fnText("request_company_cancellation")).toMatch(
      /order by j\.id for update;/,
    );
  });
});
