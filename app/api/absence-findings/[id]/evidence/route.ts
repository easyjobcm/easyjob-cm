import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { internalErrorResponse } from "@/lib/api/errors";
import { detectDocumentMime, EXT_BY_MIME } from "@/lib/utils/file-type";
import { sessionContext } from "@/lib/api/cancellation-route";
import { interventionRpcError } from "@/lib/api/intervention-route";
import { FINDING_EVIDENCE_MAX_BYTES } from "@/lib/validations/support-intervention";

const BUCKET = "incident-evidence";

/**
 * Lot 17d-3 (SAN-08) — pièce du candidat sur un constat d'absence, privée
 * (modèle des justificatifs du lot 17b). Clé service justifiée : seule la
 * route dépose le fichier (type réel lu dans les octets, 5 Mio au plus),
 * puis `record_absence_finding_evidence` (rôle service) vérifie que la
 * session est le candidat et que l'échéance de 72 h n'est pas passée.
 * Refus → fichier retiré. Jamais transmise à l'entreprise.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await sessionContext(params, "id", "finding_not_found");
    if (ctx.error) return ctx.error;
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { error: "evidence_invalid", code: "evidence_invalid" },
        { status: 400 },
      );
    }
    if (file.size > FINDING_EVIDENCE_MAX_BYTES) {
      return NextResponse.json(
        { error: "evidence_too_large", code: "evidence_too_large" },
        { status: 413 },
      );
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = detectDocumentMime(bytes);
    if (!mime) {
      return NextResponse.json(
        { error: "evidence_invalid", code: "evidence_invalid" },
        { status: 400 },
      );
    }
    const admin = createAdminClient();
    const path = `absence-findings/${ctx.id}/${randomUUID()}.${EXT_BY_MIME[mime]}`;
    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (uploadError) {
      return internalErrorResponse(
        "absence_findings.evidence_upload",
        uploadError,
        {
          code: "evidence_failed",
          request,
        },
      );
    }
    const { data, error } = await admin.rpc("record_absence_finding_evidence", {
      p_user_id: ctx.userId,
      p_finding_id: ctx.id!,
      p_path: path,
      p_mime: mime,
      p_size: bytes.length,
    });
    if (error) {
      await admin.storage.from(BUCKET).remove([path]);
      return interventionRpcError(error, "absence_findings.evidence", request);
    }
    return NextResponse.json({ evidence: { id: data } });
  } catch (error) {
    return internalErrorResponse("absence_findings.evidence", error, {
      code: "evidence_failed",
      request,
    });
  }
}
