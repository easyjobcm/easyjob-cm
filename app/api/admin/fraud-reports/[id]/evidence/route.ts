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

/**
 * Lot 17c — élément joint à un signalement de fraude par le support.
 *
 * Grade relu en session (admin actif) AVANT le dépôt, puis revérifié par
 * `record_fraud_evidence` (`is_admin_user` de l'utilisateur de la session).
 * Clé service justifiée pour le seul dépôt dans le bucket privé ; refus →
 * fichier retiré.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await sessionContext(params, "id", "fraud_report_not_found");
    if (ctx.error) return ctx.error;
    // Contrôle du grade avant tout accès au stockage.
    const { data: me } = await ctx.supabase
      .from("users")
      .select("role")
      .eq("id", ctx.userId)
      .not("is_active", "is", false)
      .single();
    if (
      !me ||
      !["admin_support", "admin_ops", "admin_founder"].includes(me.role)
    ) {
      return NextResponse.json(
        { error: "forbidden", code: "forbidden" },
        { status: 403 },
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
    const path = `fraud/${ctx.id}/${randomUUID()}.${EXT_BY_MIME[mime]}`;
    const { error: uploadError } = await admin.storage
      .from("incident-evidence")
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (uploadError) {
      return internalErrorResponse("admin.fraud.evidence_upload", uploadError, {
        code: "evidence_failed",
        request,
      });
    }
    const { data, error } = await admin.rpc("record_fraud_evidence", {
      p_user_id: ctx.userId,
      p_report_id: ctx.id!,
      p_path: path,
      p_mime: mime,
      p_size: bytes.length,
    });
    if (error) {
      await admin.storage.from("incident-evidence").remove([path]);
      return cancellationRpcError(
        error,
        "admin.fraud.evidence",
        "evidence_failed",
        request,
      );
    }
    return NextResponse.json({ evidence: { id: data } });
  } catch (error) {
    return internalErrorResponse("admin.fraud.evidence", error, {
      code: "evidence_failed",
      request,
    });
  }
}
