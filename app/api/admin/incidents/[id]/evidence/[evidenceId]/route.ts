import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { incidentRpcError } from "@/lib/api/incident-route";
import { internalErrorResponse } from "@/lib/api/errors";

/**
 * URL signée (60 s) d'un justificatif de signalement, pour le support
 * habilité (lot 14).
 *
 * Contrôle AVANT tout accès au stockage : `admin_incident_evidence_path`,
 * appelée en session, exige un admin actif (`is_admin_user`) et renvoie le
 * chemin. Clé service ensuite seulement pour signer l'URL : le bucket
 * `incident-evidence` n'a aucune politique de session. L'URL n'est jamais
 * journalisée.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; evidenceId: string }> },
) {
  try {
    const { evidenceId } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized", code: "not_authenticated" },
        { status: 401 },
      );
    }
    const id = z.string().uuid().safeParse(evidenceId);
    if (!id.success) {
      return NextResponse.json(
        { error: "evidence_not_found", code: "evidence_not_found" },
        { status: 404 },
      );
    }
    const { data: path, error } = await supabase.rpc(
      "admin_incident_evidence_path",
      { p_evidence_id: id.data },
    );
    if (error)
      return incidentRpcError(
        error,
        "admin.incidents.evidence",
        "evidence_failed",
        request,
      );
    const { data: signed, error: signError } = await createAdminClient()
      .storage.from("incident-evidence")
      .createSignedUrl(path, 60);
    if (signError || !signed) {
      return internalErrorResponse("admin.incidents.evidence", signError, {
        code: "signed_url_failed",
        request,
      });
    }
    return NextResponse.json(
      { url: signed.signedUrl },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return internalErrorResponse("admin.incidents.evidence", error, {
      code: "evidence_failed",
      request,
    });
  }
}
