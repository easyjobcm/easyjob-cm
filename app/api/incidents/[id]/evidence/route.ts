import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { incidentRpcError } from "@/lib/api/incident-route";
import { internalErrorResponse } from "@/lib/api/errors";
import { detectDocumentMime, EXT_BY_MIME } from "@/lib/utils/file-type";
import { INCIDENT_EVIDENCE_MAX_BYTES } from "@/lib/validations/incident";

const BUCKET = "incident-evidence";

/**
 * Justificatif privé d'une partie sur un signalement (lot 14).
 *
 * Le bucket `incident-evidence` n'a aucune politique : ni les parties ni
 * le navigateur n'y accèdent. Clé service justifiée : seule la route
 * dépose le fichier (type réel lu dans les octets, 5 Mio au plus), sous un
 * chemin qu'elle produit, puis `record_incident_evidence` (rôle service)
 * vérifie que l'utilisateur de la session est partie et que le
 * signalement est encore ouvert. Refus → le fichier est retiré. Seul le
 * support habilité lira la pièce (URL signée de 60 s).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
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
    const incidentId = z.string().uuid().safeParse(id);
    if (!incidentId.success) {
      return NextResponse.json(
        { error: "incident_not_found", code: "incident_not_found" },
        { status: 404 },
      );
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { error: "evidence_invalid", code: "evidence_invalid" },
        { status: 400 },
      );
    }
    if (file.size > INCIDENT_EVIDENCE_MAX_BYTES) {
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
    const path = `${incidentId.data}/${randomUUID()}.${EXT_BY_MIME[mime]}`;
    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (uploadError) {
      return internalErrorResponse("incidents.evidence_upload", uploadError, {
        code: "evidence_failed",
        request,
      });
    }

    const { data, error } = await admin.rpc("record_incident_evidence", {
      p_user_id: user.id,
      p_incident_id: incidentId.data,
      p_path: path,
      p_mime: mime,
      p_size: bytes.length,
    });
    if (error) {
      await admin.storage.from(BUCKET).remove([path]);
      return incidentRpcError(
        error,
        "incidents.evidence",
        "evidence_failed",
        request,
      );
    }
    return NextResponse.json({ evidence: { id: data } });
  } catch (error) {
    return internalErrorResponse("incidents.evidence", error, {
      code: "evidence_failed",
      request,
    });
  }
}
