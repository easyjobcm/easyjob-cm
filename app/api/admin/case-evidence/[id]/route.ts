import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { internalErrorResponse } from "@/lib/api/errors";
import {
  cancellationRpcError,
  sessionContext,
} from "@/lib/api/cancellation-route";

/**
 * Lot 17c — URL signée (60 s) d'une pièce d'annulation ou de fraude, pour
 * le support habilité. Contrôle AVANT tout accès au stockage :
 * `admin_case_evidence_path`, en session, exige un admin actif. Clé
 * service ensuite seulement pour signer (bucket sans politique). L'URL
 * n'est jamais journalisée.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await sessionContext(params, "id", "evidence_not_found");
    if (ctx.error) return ctx.error;
    const { data: path, error } = await ctx.supabase.rpc(
      "admin_case_evidence_path",
      { p_evidence_id: ctx.id! },
    );
    if (error)
      return cancellationRpcError(
        error,
        "admin.case_evidence",
        "evidence_failed",
        request,
      );
    const { data: signed, error: signError } = await createAdminClient()
      .storage.from("incident-evidence")
      .createSignedUrl(path, 60);
    if (signError || !signed) {
      return internalErrorResponse("admin.case_evidence", signError, {
        code: "signed_url_failed",
        request,
      });
    }
    return NextResponse.json(
      { url: signed.signedUrl },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return internalErrorResponse("admin.case_evidence", error, {
      code: "evidence_failed",
      request,
    });
  }
}
