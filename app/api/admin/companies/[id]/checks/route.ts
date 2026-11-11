import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { internalErrorResponse } from "@/lib/api/errors";
import {
  companyCheckSchema,
  companyVerificationRefusal,
} from "@/lib/validations/company";

/**
 * Contrôle d'un élément du dossier entreprise (lot 11) : RCCM, NIU ou
 * représentant. L'admin enregistre ce qu'il a constaté auprès de la source
 * officielle (DGI, registre, greffe) : décision, source, référence ou note
 * interne, motif communiqué en cas de refus. Aucune vérification externe
 * automatique.
 *
 * RPC `admin_record_company_check` en session admin (jamais la clé
 * service) : grade admin_ops/admin_founder actif, dossier en revue, version
 * du dossier lue (`company_changed`), dernière décision de ce contrôle vue
 * (`check_changed` : double clic, second admin), pièces présentes ; ajout à
 * l'historique et trace audit_logs (sans référence ni motif) dans la même
 * transaction.
 */
/** Codes de validation renvoyés tels quels (traduits par l'écran). */
const INPUT_CODES = new Set([
  "invalid_check",
  "invalid_action",
  "source_required",
  "reference_required",
  "reference_too_long",
  "reason_required",
  "reason_too_long",
]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ code: "company_not_found" }, { status: 404 });
  }

  const parsed = companyCheckSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    const code = parsed.error.issues[0]?.message ?? "";
    return NextResponse.json(
      { code: INPUT_CODES.has(code) ? code : "invalid_action" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ code: "not_authenticated" }, { status: 401 });
  }

  const d = parsed.data;
  const { data, error } = await supabase.rpc("admin_record_company_check", {
    p_company_id: id,
    p_check: d.check,
    p_decision: d.decision,
    p_source: d.source ?? "",
    p_reference: d.reference ?? "",
    p_reason: d.reason ?? "",
    p_seen_revision: d.seen_revision,
    // null = « aucune décision vue » ; le type généré n'admet pas null.
    p_seen_check: d.seen_check as string,
  });
  if (error) {
    const refusal = companyVerificationRefusal(error.message);
    if (refusal) {
      return NextResponse.json(
        { code: refusal.code },
        { status: refusal.status },
      );
    }
    return internalErrorResponse("admin.company_verification.check", error, {
      code: "company_review_failed",
      request,
    });
  }

  const result = z
    .object({
      check_id: z.string().uuid(),
      decision: z.enum(["approved", "rejected", "unverifiable"]),
    })
    .safeParse(data);
  if (!result.success || result.data.decision !== d.decision) {
    return internalErrorResponse("admin.company_verification.check", null, {
      code: "company_review_failed",
      request,
      reason: "result_mismatch",
    });
  }
  return NextResponse.json(result.data);
}
