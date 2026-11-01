import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { companyOnboardingSchema } from "@/lib/validations/company";
import { detectDocumentMime, EXT_BY_MIME } from "@/lib/utils/file-type";

const BUCKET = "company-documents";
const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const FIELDS = Object.keys(companyOnboardingSchema.shape);

/**
 * Enregistre l'onboarding de l'entreprise connectée dans son propre
 * `company_profiles` (session utilisateur, RLS). Écrit uniquement les champs
 * du formulaire et `onboarding_status` : ni NIU, ni vérification, ni
 * abonnement. Le document RCCM facultatif remplace le précédent.
 * Les colonnes modifiables et la nouvelle revue d'une entreprise vérifiée
 * (nom, RCCM ou document modifiés) sont imposées en base :
 * migration 20261101130000_lock_company_profile_permissions.
 */
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

  const file = formData.get("rccm_document");
  let uploadedPath: string | null = null;
  if (file !== null) {
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "file_missing" }, { status: 400 });
    }
    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json({ error: "file_too_large" }, { status: 400 });
    }
    const buffer = new Uint8Array(await file.arrayBuffer());
    const mime = detectDocumentMime(buffer);
    if (!mime) {
      return NextResponse.json({ error: "file_type" }, { status: 400 });
    }
    uploadedPath = `${user.id}/rccm-${randomUUID()}.${EXT_BY_MIME[mime]}`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(uploadedPath, buffer, { contentType: mime, upsert: false });
    if (uploadError) {
      console.error("[company-onboarding] upload failed:", uploadError.message);
      return NextResponse.json({ error: "upload_failed" }, { status: 500 });
    }
  }

  const { data: previous } = await supabase
    .from("company_profiles")
    .select("documents_url")
    .eq("user_id", user.id)
    .maybeSingle();

  // Sans ligne modifiée (profil absent ou refusé par la RLS), Supabase ne
  // renvoie pas d'erreur : la ligne relue fait foi.
  const { data: saved, error: saveError } = await supabase
    .from("company_profiles")
    .update({
      ...parsed.data,
      ...(uploadedPath ? { documents_url: [uploadedPath] } : {}),
      onboarding_status: "completed",
      onboarding_step: 3,
    })
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (saveError || !saved) {
    if (uploadedPath) {
      await supabase.storage.from(BUCKET).remove([uploadedPath]);
    }
    if (saveError) {
      console.error("[company-onboarding] save failed:", saveError.message);
    }
    return NextResponse.json(
      { error: saveError ? "save_failed" : "profile_not_found" },
      { status: saveError ? 500 : 404 },
    );
  }

  const stale = uploadedPath
    ? (previous?.documents_url ?? []).filter((path) =>
        path.startsWith(`${user.id}/`),
      )
    : [];
  if (stale.length > 0) {
    const { error: removeError } = await supabase.storage
      .from(BUCKET)
      .remove(stale);
    if (removeError) {
      console.error(
        "[company-onboarding] stale document cleanup failed:",
        removeError.message,
      );
    }
  }

  return NextResponse.json({ ok: true });
}
