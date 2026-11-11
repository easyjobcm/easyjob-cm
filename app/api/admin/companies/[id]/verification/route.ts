import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdminRole } from "@/lib/auth/admin-role";
import { internalErrorResponse } from "@/lib/api/errors";
import {
  companyReviewSchema,
  companyVerificationRefusal,
} from "@/lib/validations/company";
import { COMPANY_CHECKS, type CompanyCheck } from "@/lib/validations/company";
import {
  companyDossierMissing,
  companyReviewState,
  documentKind,
  dossierDocumentPath,
  DOSSIER_DOCUMENTS,
} from "@/lib/utils/company-verification";

/**
 * Dossier entreprise à examiner (lot 11), `id` = company_profiles.id.
 *
 * GET  : informations à contrôler par section (RCCM, NIU, représentant),
 *        révisions, pièces manquantes, présence et type de chaque pièce
 *        (jamais son chemin), historique des contrôles (auteur, date, source,
 *        référence interne, motif). Trois grades (admin_support en lecture
 *        seule). Lecture en clé service APRÈS le contrôle du grade et du
 *        compte actif : company_profiles, users et l'historique n'ont pas de
 *        politique SELECT admin.
 * POST : décision finale `approve` | `request_correction` sur la révision
 *        lue. RPC `admin_review_company` en session admin : grade actif,
 *        trois contrôles approuvés sur la version courante, état sous verrou,
 *        notification et audit_logs dans la même transaction. Les contrôles
 *        eux-mêmes passent par `/checks`.
 */

const idSchema = z.string().uuid();

type CheckRow = {
  id: string;
  check_type: string;
  decision: string;
  check_revision: number;
  dossier_revision: number;
  source: string | null;
  reference_note: string | null;
  reason: string | null;
  decided_by: string | null;
  decided_by_role: string | null;
  decided_at: string;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ code: "company_not_found" }, { status: 404 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ code: "not_authenticated" }, { status: 401 });
  }

  const { data: userData } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    // Compte suspendu : aucun grade (AUDIT.md §28, comme is_admin_user).
    .not("is_active", "is", false)
    .single();
  if (!isAdminRole(userData?.role)) {
    return NextResponse.json({ code: "forbidden" }, { status: 403 });
  }

  // Clé service : grade et compte actif contrôlés ci-dessus ; aucune
  // politique SELECT admin sur company_profiles, users ni l'historique.
  const admin = createAdminClient();
  const { data: company, error } = await admin
    .from("company_profiles")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return internalErrorResponse("admin.company_verification.read", error, {
      code: "admin_company_verification_failed",
      request,
    });
  }
  if (!company) {
    return NextResponse.json({ code: "company_not_found" }, { status: 404 });
  }

  const [{ data: account }, { data: historyRows, error: historyError }] =
    await Promise.all([
      admin
        .from("users")
        .select("is_active")
        .eq("id", company.user_id)
        .maybeSingle(),
      admin
        .from("company_verification_checks")
        .select(
          "id, check_type, decision, check_revision, dossier_revision, source, reference_note, reason, decided_by, decided_by_role, decided_at",
        )
        .eq("company_id", company.id)
        .order("decided_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(200),
    ]);
  if (historyError) {
    return internalErrorResponse(
      "admin.company_verification.history",
      historyError,
      { code: "admin_company_verification_failed", request },
    );
  }
  const history = (historyRows ?? []) as CheckRow[];

  // Auteurs : e-mail des admins (visible des seuls admins).
  const authorIds = [
    ...new Set(
      history.map((h) => h.decided_by).filter((v): v is string => !!v),
    ),
  ];
  const { data: authors } = authorIds.length
    ? await admin.from("users").select("id, email").in("id", authorIds)
    : { data: [] as { id: string; email: string | null }[] };
  const authorEmail = new Map(
    (authors ?? []).map((a) => [a.id, a.email ?? null]),
  );

  const revisionOf: Record<CompanyCheck, number> = {
    rccm: company.rccm_revision,
    niu: company.niu_revision,
    representative: company.representative_revision,
  };
  const checks = Object.fromEntries(
    COMPANY_CHECKS.map((check) => {
      const rows = history.filter((h) => h.check_type === check);
      const current = rows.find((h) => h.check_revision === revisionOf[check]);
      return [
        check,
        {
          revision: revisionOf[check],
          status: current?.decision ?? "pending",
          // Dernière décision (toute version) : jeton de concurrence.
          last_check_id: rows[0]?.id ?? null,
          history: rows.map((h) => ({
            id: h.id,
            decision: h.decision,
            current: h.check_revision === revisionOf[check],
            check_revision: h.check_revision,
            source: h.source,
            reference_note: h.reference_note,
            reason: h.reason,
            decided_at: h.decided_at,
            decided_by_role: h.decided_by_role,
            decided_by_email: h.decided_by
              ? (authorEmail.get(h.decided_by) ?? null)
              : null,
          })),
        },
      ];
    }),
  );

  const documents = Object.fromEntries(
    DOSSIER_DOCUMENTS.map((doc) => {
      const path = dossierDocumentPath(company, doc);
      return [doc, { present: !!path, kind: documentKind(path) }];
    }),
  );

  return NextResponse.json(
    {
      dossier: {
        company_id: company.id,
        company_name: company.company_name,
        legal_name: company.legal_name,
        sector: company.sector,
        company_size: company.company_size,
        website: company.website,
        description: company.description,
        rccm: company.rccm,
        niu: company.niu,
        niu_verified: company.niu_verified === true,
        city: company.city,
        quartier: company.quartier,
        address: company.address,
        contact_name: company.contact_name,
        contact_email: company.contact_email,
        contact_phone: company.contact_phone,
        representative_name: company.representative_name,
        representative_title: company.representative_title,
        representative_authority: company.representative_authority,
        onboarding_status: company.onboarding_status,
        verification_status: company.verification_status,
        review_state: companyReviewState(company),
        rejection_reason: company.verification_rejection_reason,
        submitted_at: company.verification_submitted_at,
        reviewed_at: company.verification_reviewed_at,
        revision: company.verification_revision,
        missing: companyDossierMissing(company),
        documents,
        checks,
        account_active:
          account?.is_active !== false && company.is_active !== false,
      },
      can_decide:
        userData?.role === "admin_ops" || userData?.role === "admin_founder",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ code: "company_not_found" }, { status: 404 });
  }

  const parsed = companyReviewSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    const code =
      parsed.error.issues.find((i) => i.path[0] === "reason")?.message ??
      "invalid_action";
    return NextResponse.json({ code }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ code: "not_authenticated" }, { status: 401 });
  }

  // Grade, compte actif, état et révision : revérifiés par la RPC.
  const { data, error } = await supabase.rpc("admin_review_company", {
    p_company_id: id,
    p_action: parsed.data.action,
    p_reason: parsed.data.reason ?? "",
    p_seen_revision: parsed.data.seen_revision,
  });
  if (error) {
    const refusal = companyVerificationRefusal(error.message);
    if (refusal) {
      return NextResponse.json(
        { code: refusal.code },
        { status: refusal.status },
      );
    }
    return internalErrorResponse("admin.company_verification.review", error, {
      code: "company_review_failed",
      request,
    });
  }

  const result = z
    .object({
      status: z.enum(["verified", "rejected"]),
      revision: z.number().int(),
    })
    .safeParse(data);
  const expected =
    parsed.data.action === "approve" ? "verified" : ("rejected" as const);
  if (!result.success || result.data.status !== expected) {
    return internalErrorResponse("admin.company_verification.review", null, {
      code: "company_review_failed",
      request,
      reason: "result_mismatch",
    });
  }

  return NextResponse.json(result.data);
}
