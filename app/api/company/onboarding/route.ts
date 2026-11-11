import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  companyOnboardingSchema,
  companyVerificationRefusal,
} from "@/lib/validations/company";
import { detectDocumentMime, EXT_BY_MIME } from "@/lib/utils/file-type";
import { logServerError, requestIdFrom } from "@/lib/observability/server-log";

const BUCKET = "company-documents";
const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const FIELDS = Object.keys(companyOnboardingSchema.shape);

/** Pièces du dossier : champ du formulaire et préfixe du fichier stocké. */
const DOCUMENT_FIELDS = [
  { form: "rccm_document", prefix: "rccm" },
  { form: "niu_document", prefix: "niu" },
  { form: "representative_id_document", prefix: "rep-id" },
  { form: "mandate_document", prefix: "mandate" },
] as const;
type DocumentField = (typeof DOCUMENT_FIELDS)[number]["form"];

/**
 * Enregistre l'onboarding de l'entreprise connectée dans son propre
 * `company_profiles` (session utilisateur, RLS). Écrit uniquement les champs
 * du formulaire et `onboarding_status` : ni NIU, ni vérification, ni
 * abonnement. Chaque pièce envoyée (RCCM, attestation NIU, pièce d'identité
 * et mandat du représentant) remplace la précédente.
 * Les colonnes modifiables et la nouvelle revue d'une entreprise vérifiée
 * (nom, RCCM ou document modifiés) sont imposées en base :
 * migration 20261101130000_lock_company_profile_permissions.
 *
 * Lot 11 : l'envoi du formulaire est la soumission explicite du dossier
 * (RPC `submit_company_verification`, session). Un dossier sans document
 * (`dossier_incomplete`) ou un dossier refusé sans changement d'un champ
 * revu (`nothing_changed`) est enregistré sans entrer dans la file admin ;
 * l'écran l'indique. Aucune vérification n'est accordée ici.
 */
const submitResultSchema = z.object({
  outcome: z.enum([
    "submitted",
    "resubmitted",
    "already_pending",
    "already_verified",
  ]),
});
export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: userRow, error: userError } = await supabase
    .from("users")
    .select("role, is_active")
    .eq("id", user.id)
    .single();
  if (userError || !userRow) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (userRow.role !== "company" && userRow.role !== "company_premium") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (userRow.is_active === false) {
    return NextResponse.json({ error: "account_suspended" }, { status: 403 });
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const parsed = companyOnboardingSchema.safeParse(
    Object.fromEntries(FIELDS.map((key) => [key, formData.get(key)])),
  );
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid",
        issues: parsed.error.issues.map((issue) => ({
          field: String(issue.path[0] ?? ""),
          code: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  // Lot 11 : quatre pièces possibles, chacune remplace la précédente.
  const uploads: Partial<Record<DocumentField, string>> = {};
  const removeUploaded = async () => {
    const paths = Object.values(uploads);
    if (paths.length > 0) await supabase.storage.from(BUCKET).remove(paths);
  };
  for (const field of DOCUMENT_FIELDS) {
    const file = formData.get(field.form);
    if (file === null) continue;
    if (!(file instanceof File) || file.size === 0) {
      await removeUploaded();
      return NextResponse.json({ error: "file_missing" }, { status: 400 });
    }
    if (file.size > MAX_SIZE_BYTES) {
      await removeUploaded();
      return NextResponse.json({ error: "file_too_large" }, { status: 400 });
    }
    const buffer = new Uint8Array(await file.arrayBuffer());
    const mime = detectDocumentMime(buffer);
    if (!mime) {
      await removeUploaded();
      return NextResponse.json({ error: "file_type" }, { status: 400 });
    }
    const path = `${user.id}/${field.prefix}-${randomUUID()}.${EXT_BY_MIME[mime]}`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: mime, upsert: false });
    if (uploadError) {
      await removeUploaded();
      logServerError("company.onboarding.upload", uploadError, {
        requestId: requestIdFrom(request.headers),
      });
      return NextResponse.json({ error: "upload_failed" }, { status: 500 });
    }
    uploads[field.form] = path;
  }

  const { data: previous } = await supabase
    .from("company_profiles")
    .select(
      "documents_url, niu_document_path, representative_id_document_path, representative_mandate_path",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  // Sans ligne modifiée (profil absent ou refusé par la RLS), Supabase ne
  // renvoie pas d'erreur : la ligne relue fait foi.
  const { data: saved, error: saveError } = await supabase
    .from("company_profiles")
    .update({
      ...parsed.data,
      ...(uploads.rccm_document
        ? { documents_url: [uploads.rccm_document] }
        : {}),
      ...(uploads.niu_document
        ? { niu_document_path: uploads.niu_document }
        : {}),
      ...(uploads.representative_id_document
        ? {
            representative_id_document_path: uploads.representative_id_document,
          }
        : {}),
      ...(uploads.mandate_document
        ? { representative_mandate_path: uploads.mandate_document }
        : {}),
      onboarding_status: "completed",
      onboarding_step: 3,
    })
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (saveError || !saved) {
    await removeUploaded();
    if (saveError) {
      logServerError("company.onboarding.save", saveError, {
        requestId: requestIdFrom(request.headers),
      });
    }
    return NextResponse.json(
      { error: saveError ? "save_failed" : "profile_not_found" },
      { status: saveError ? 500 : 404 },
    );
  }

  // Anciennes pièces remplacées : supprimées après l'enregistrement.
  const stale = [
    ...(uploads.rccm_document ? (previous?.documents_url ?? []) : []),
    ...(uploads.niu_document ? [previous?.niu_document_path] : []),
    ...(uploads.representative_id_document
      ? [previous?.representative_id_document_path]
      : []),
    ...(uploads.mandate_document
      ? [previous?.representative_mandate_path]
      : []),
  ].filter(
    (path): path is string =>
      typeof path === "string" && path.startsWith(`${user.id}/`),
  );
  if (stale.length > 0) {
    const { error: removeError } = await supabase.storage
      .from(BUCKET)
      .remove(stale);
    if (removeError) {
      logServerError("company.onboarding.cleanup", removeError, {
        requestId: requestIdFrom(request.headers),
      });
    }
  }

  const { data: submitted, error: submitError } = await supabase.rpc(
    "submit_company_verification",
  );
  if (submitError) {
    const refusal = companyVerificationRefusal(submitError.message);
    if (
      refusal?.code === "dossier_incomplete" ||
      refusal?.code === "nothing_changed"
    ) {
      return NextResponse.json({
        ok: true,
        verification: { code: refusal.code },
      });
    }
    if (refusal) {
      return NextResponse.json(
        { error: refusal.code },
        { status: refusal.status },
      );
    }
    logServerError("company.onboarding.submit", submitError, {
      requestId: requestIdFrom(request.headers),
    });
    return NextResponse.json({ error: "submit_failed" }, { status: 500 });
  }
  const result = submitResultSchema.safeParse(submitted);
  if (!result.success) {
    logServerError("company.onboarding.submit", null, {
      requestId: requestIdFrom(request.headers),
      reason: "result_mismatch",
    });
    return NextResponse.json({ error: "submit_failed" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    verification: { outcome: result.data.outcome },
  });
}
