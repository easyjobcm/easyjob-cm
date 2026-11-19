import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { internalErrorResponse } from "@/lib/api/errors";
import { detectDocumentMime, EXT_BY_MIME } from "@/lib/utils/file-type";
import {
  cancellationRpcError,
  sessionContext,
} from "@/lib/api/cancellation-route";
import { CANCELLATION_EVIDENCE_MAX_BYTES } from "@/lib/validations/cancellation";

const BUCKET = "incident-evidence";

/**
 * Lot 17b — justificatif d'une annulation, privé.
 *
 * Même modèle que les pièces des signalements (lot 14) : le bucket
 * `incident-evidence` n'a aucune politique de session. Clé service
 * justifiée : seule la route dépose le fichier (type réel lu dans les
 * octets, 5 Mio au plus) sous un chemin qu'elle produit, puis
 * `record_cancellation_evidence` (rôle service) vérifie que l'utilisateur
 * de la session est le candidat et que le dossier accepte une pièce. Refus
 * → fichier retiré. Un échec d'envoi laisse le dossier en attente de pièce
 * (aucune déclaration « sans justificatif »). Lecture : support habilité,
 * URL signée de 60 s.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await sessionContext(params, "id", "cancellation_not_found");
    if (ctx.error) return ctx.error;
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { error: "evidence_invalid", code: "evidence_invalid" },
        { status: 400 },
      );
    }
    if (file.size > CANCELLATION_EVIDENCE_MAX_BYTES) {
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
    const path = `cancellations/${ctx.id}/${randomUUID()}.${EXT_BY_MIME[mime]}`;
    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (uploadError) {
      return internalErrorResponse(
        "cancellations.evidence_upload",
        uploadError,
        {
          code: "evidence_failed",
          request,
        },
      );
    }
    const { data, error } = await admin.rpc("record_cancellation_evidence", {
      p_user_id: ctx.userId,
      p_cancellation_id: ctx.id!,
      p_path: path,
      p_mime: mime,
      p_size: bytes.length,
    });
    if (error) {
      await admin.storage.from(BUCKET).remove([path]);
      return cancellationRpcError(
        error,
        "cancellations.evidence",
        "evidence_failed",
        request,
      );
    }
    return NextResponse.json({ evidence: { id: data } });
  } catch (error) {
    return internalErrorResponse("cancellations.evidence", error, {
      code: "evidence_failed",
      request,
    });
  }
}
