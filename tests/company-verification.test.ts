import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  companyDossierMissing,
  companyReviewState,
  DOSSIER_PIECES,
  dossierDocumentPath,
  parseMyCompanyVerification,
} from "@/lib/utils/company-verification";
import {
  COMPANY_CHECK_SOURCES,
  COMPANY_VERIFICATION_REFUSALS,
  companyCheckSchema,
  companyReviewSchema,
  companyVerificationRefusal,
} from "@/lib/validations/company";
import { fr } from "@/lib/i18n/fr";
import { en } from "@/lib/i18n/en";

/**
 * Lot 11 — vérification du dossier entreprise. Les droits réels sont
 * prouvés par `scripts/proof-company-verification.ts` ; ces tests figent les
 * règles partagées entre écrans, routes et RPC.
 */
const ROOT = path.resolve(__dirname, "..");
const MIGRATION = fs.readFileSync(
  path.join(
    ROOT,
    "supabase/migrations/20261111120000_company_verification_review.sql",
  ),
  "utf8",
);
const fnBody = (name: string) => {
  const start = MIGRATION.indexOf(`create or replace function public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  return MIGRATION.slice(start, MIGRATION.indexOf("\n$$;", start));
};

const COMPLETE = {
  rccm: "RC/DLA/2026/B/1",
  documents_url: ["u/rccm-1.pdf"],
  niu: "M012345678901A",
  niu_document_path: "u/niu-1.pdf",
  representative_name: "Awa Preuve",
  representative_title: "Gérante",
  representative_authority: "listed_officer",
  representative_id_document_path: "u/rep-id-1.pdf",
  representative_mandate_path: null,
};

describe("état du dossier entreprise", () => {
  it("distingue incomplet, en examen, correction et vérifié", () => {
    const s = (
      status: "pending" | "verified" | "rejected",
      at: string | null,
    ) =>
      companyReviewState({
        verification_status: status,
        verification_submitted_at: at,
      });
    expect(s("pending", null)).toBe("incomplete");
    expect(s("pending", "2026-11-11T08:00:00Z")).toBe("in_review");
    expect(s("rejected", "2026-11-11T08:00:00Z")).toBe("correction");
    expect(s("verified", null)).toBe("verified");
  });

  it("pièces manquantes : mêmes codes et même ordre que la fonction SQL", () => {
    const sql = fnBody("company_dossier_missing");
    const codes = [...sql.matchAll(/then '([a-z_]+)'/g)].map((m) => m[1]);
    expect(codes).toEqual([...DOSSIER_PIECES]);
    expect(companyDossierMissing(COMPLETE)).toEqual([]);
    expect(
      companyDossierMissing({
        ...COMPLETE,
        representative_authority: "mandate",
      }),
    ).toEqual(["mandate_document"]);
    expect(
      companyDossierMissing({
        ...COMPLETE,
        niu_document_path: " ",
        representative_id_document_path: null,
      }),
    ).toEqual(["niu_document", "representative_id_document"]);
    for (const piece of DOSSIER_PIECES) {
      expect(fr.companyVerification.pieces).toHaveProperty(piece);
      expect(en.companyVerification.pieces).toHaveProperty(piece);
    }
  });

  it("chemin d'une pièce : seulement dans le dossier de l'entreprise", () => {
    const row = {
      user_id: "u",
      documents_url: ["v/rccm.pdf", "u/rccm-2.pdf"],
      niu_document_path: "v/niu.pdf",
      representative_id_document_path: "u/rep-id.png",
      representative_mandate_path: null,
    };
    expect(dossierDocumentPath(row, "rccm")).toBe("u/rccm-2.pdf");
    expect(dossierDocumentPath(row, "niu")).toBeNull();
    expect(dossierDocumentPath(row, "representative_id")).toBe("u/rep-id.png");
    expect(dossierDocumentPath(row, "mandate")).toBeNull();
  });

  it("lecture entreprise : jamais de note interne attendue", () => {
    const parsed = parseMyCompanyVerification({
      status: "pending",
      submitted_at: null,
      reviewed_at: null,
      rejection_reason: null,
      missing: ["niu_document"],
      checks: {
        rccm: { status: "approved", reason: null },
        niu: { status: "rejected", reason: "Attestation illisible." },
        representative: { status: "pending", reason: null },
      },
    });
    expect(parsed?.checks.niu.reason).toBe("Attestation illisible.");
    expect(parseMyCompanyVerification({ status: "pending" })).toBeNull();
    const body = fnBody("my_company_verification");
    expect(body).not.toContain("reference_note");
    expect(body).not.toContain("decided_by");
  });
});

describe("contrôles et décision admin", () => {
  const base = { seen_revision: 3, seen_check: null };

  it("contrôle : source officielle et référence pour valider, motif pour refuser", () => {
    const ok = (v: object) => companyCheckSchema.safeParse({ ...base, ...v });
    expect(
      ok({
        check: "niu",
        decision: "approved",
        source: "dgi_online",
        reference: "DGI 11/11",
      }).success,
    ).toBe(true);
    // Un fichier ou un format valide ne suffit pas : source DGI exigée.
    expect(
      ok({ check: "niu", decision: "approved", reference: "fichier reçu" })
        .error?.issues[0]?.message,
    ).toBe("source_required");
    expect(
      ok({
        check: "niu",
        decision: "approved",
        source: "official_registry",
        reference: "x1y",
      }).success,
    ).toBe(false);
    expect(
      ok({ check: "rccm", decision: "rejected", reason: "court" }).error
        ?.issues[0]?.message,
    ).toBe("reason_required");
    expect(
      ok({ check: "representative", decision: "unverifiable" }).error?.issues[0]
        ?.message,
    ).toBe("reference_required");
    expect(COMPANY_CHECK_SOURCES.niu).toEqual(["dgi_online", "dgi_office"]);
  });

  it("décision finale : révision lue et motif exploitable", () => {
    expect(
      companyReviewSchema.safeParse({ action: "approve", seen_revision: 3 })
        .success,
    ).toBe(true);
    expect(companyReviewSchema.safeParse({ action: "approve" }).success).toBe(
      false,
    );
    expect(
      companyReviewSchema.safeParse({
        action: "request_correction",
        reason: "x".repeat(501),
        seen_revision: 3,
      }).error?.issues[0]?.message,
    ).toBe("reason_too_long");
  });

  it("chaque code levé par les RPC est connu de la route et traduit", () => {
    // Fonctions du dossier seulement : les RPC d'offres reprises en §10
    // gardent les codes du lot 6 (JOB_RPC_REFUSALS).
    const dossierSql = MIGRATION.slice(0, MIGRATION.indexOf("-- ── 10."));
    const raised = [...dossierSql.matchAll(/raise exception '([a-z_]+)'/g)].map(
      (m) => m[1],
    );
    expect(raised.length).toBeGreaterThan(20);
    for (const code of raised) {
      expect(COMPANY_VERIFICATION_REFUSALS).toHaveProperty(code);
      expect(fr.companyVerification.errors).toHaveProperty(code);
      expect(en.companyVerification.errors).toHaveProperty(code);
    }
    expect(companyVerificationRefusal("check_changed")).toEqual({
      code: "check_changed",
      status: 409,
    });
    expect(companyVerificationRefusal("permission denied")).toBeNull();
  });

  it("grade actif, verrou, et NIU écrit par son seul contrôle", () => {
    for (const name of ["admin_review_company", "admin_record_company_check"]) {
      const body = fnBody(name);
      expect(body).toContain("public.is_ops_admin_user(v_uid)");
      expect(body).toContain("for update");
      expect(body).toContain("company_changed");
    }
    expect(fnBody("admin_review_company")).not.toMatch(/niu_verified\s*=/);
    expect(fnBody("admin_review_company")).toContain("checks_incomplete");
    expect(fnBody("admin_record_company_check")).toContain(
      "niu_verified = (p_decision = 'approved')",
    );
    // Les colonnes de revue ne sont jamais ouvertes en écriture de session.
    const grants = [...MIGRATION.matchAll(/grant update \(([^)]*)\)/g)]
      .map((m) => m[1])
      .join(",");
    expect(grants).not.toMatch(/verification|revision|niu_verified|\bniu\b,/);
  });

  it("publication : les trois RPC d'offres relisent le dossier complet", () => {
    for (const name of ["create_job", "update_job", "moderate_job"]) {
      expect(fnBody(name)).toContain("public.company_verification_complete(");
      expect(fnBody(name)).not.toContain(
        "verification_status is distinct from 'verified'",
      );
    }
  });

  it("libellé public : « Dossier vérifié par EasyJob », pas de certification générale", () => {
    expect(fr.companyVerification.states.verified.title).toBe(
      "Dossier vérifié par EasyJob",
    );
    expect(en.companyVerification.states.verified.title).toBe(
      "File verified by EasyJob",
    );
    const all =
      JSON.stringify(fr.companyVerification) +
      JSON.stringify(en.companyVerification);
    expect(all).not.toMatch(
      /certifiée? conforme|fully compliant|certified compliant/i,
    );
  });
});

describe("offres d'une entreprise au dossier non valide (migration 20261111130000)", () => {
  const VIS = fs.readFileSync(
    path.join(
      ROOT,
      "supabase/migrations/20261111130000_company_dossier_visibility.sql",
    ),
    "utf8",
  );
  const body = (name: string) => {
    const start = VIS.indexOf(`create or replace function public.${name}(`);
    expect(start).toBeGreaterThan(-1);
    return VIS.slice(start, VIS.indexOf("\n$$;", start));
  };

  it("la visibilité dépend du dossier, jamais des règles de suspension", () => {
    const valid = body("company_dossier_valid");
    expect(valid).not.toMatch(/is_active/);
    expect(body("company_verification_complete")).toContain(
      "public.company_dossier_valid(p_company_id)",
    );
    const policy = VIS.slice(
      VIS.indexOf('create policy "Published jobs are viewable by all"'),
    );
    expect(policy).toContain("public.company_dossier_valid(company_id)");
    expect(policy).toContain("public.candidate_applied_to_job(id)");
  });

  it("candidature et sélection : dossier lu sous verrou de la ligne entreprise, après la relance idempotente", () => {
    const apply = body("apply_to_job");
    const lockA = apply.indexOf(
      "for share;",
      apply.indexOf("from public.company_profiles"),
    );
    expect(lockA).toBeGreaterThan(apply.indexOf("from public.jobs j"));
    expect(apply.indexOf("company_dossier_valid")).toBeGreaterThan(lockA);
    expect(apply).toContain("raise exception 'job_not_available'");

    const select = body("select_candidate");
    const idempotent = select.indexOf(
      "if v_application.status = 'selected' then",
    );
    const lockS = select.indexOf(
      "from public.company_profiles cp where cp.id = v_company.id for share",
    );
    expect(idempotent).toBeGreaterThan(-1);
    expect(lockS).toBeGreaterThan(idempotent);
    expect(select.indexOf("company_dossier_valid")).toBeGreaterThan(lockS);
  });

  it("aucun changement de statut d'offre ni suppression ; signal Realtime sur le statut réel", () => {
    expect(VIS).not.toMatch(/update public\.jobs|delete from public\.jobs/i);
    expect(VIS).toContain(
      "when (old.verification_status is distinct from new.verification_status)",
    );
    expect(VIS).not.toMatch(/after update of verification_status/);
  });

  it("dépendances : l'identité de l'entreprise invalide les trois contrôles", () => {
    const trigger = fnBody("protect_company_profile_columns");
    expect(trigger).toContain(
      "v_identity := (new.company_name, new.legal_name)",
    );
    for (const v of [
      "v_rccm := v_identity",
      "v_niu := v_identity",
      "v_rep := v_identity",
    ]) {
      expect(trigger).toContain(v);
    }
  });
});
