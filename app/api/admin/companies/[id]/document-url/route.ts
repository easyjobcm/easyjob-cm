import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdminRole } from "@/lib/auth/admin-role";
import { internalErrorResponse } from "@/lib/api/errors";
import {
  documentKind,
  dossierDocumentPath,
  DOSSIER_DOCUMENTS,
} from "@/lib/utils/company-verification";

/**
 * URL signée (60 s) d'une pièce du dossier entreprise (lot 11) :
 * `?doc=rccm|niu|representative_id|mandate`. Même mécanisme que les
 * justificatifs candidats (`/api/admin/skill-documents/[id]/url`).
 *
 * - Grade admin et compte actif vérifiés avant toute lecture (3 grades :
 *   la consultation est permise à admin_support, la décision non).
 * - Chemin lu en clé service (pas de politique SELECT admin sur
 *   company_profiles), refusé s'il n'est pas dans le dossier de
 *   l'entreprise, jamais renvoyé hors de l'URL signée ni journalisé.
 * - Signature en SESSION : la politique Storage
 *   `company_documents_admin_select` (is_admin_user, compte actif) reste la
 *   dernière barrière.
 * - La révision lue est renvoyée : l'écran détecte une pièce remplacée
 *   depuis l'ouverture de la fiche.
 */

const BUCKET = "company-documents";
const docSchema = z.enum(DOSSIER_DOCUMENTS);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const doc = docSchema.safeParse(
    request.nextUrl.searchParams.get("doc") ?? "rccm",
  );
  if (!z.string().uuid().safeParse(id).success || !doc.success) {
    return NextResponse.json({ code: "not_found" }, { status: 404 });
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

  // Clé service après le contrôle de grade : lecture du chemin seulement.
  const admin = createAdminClient();
  const { data: company } = await admin
    .from("company_profiles")
    .select(
      "user_id, documents_url, niu_document_path, representative_id_document_path, representative_mandate_path, verification_revision",
    )
    .eq("id", id)
    .maybeSingle();
  const path = company ? dossierDocumentPath(company, doc.data) : null;
  if (!company || !path) {
    return NextResponse.json({ code: "not_found" }, { status: 404 });
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 60);
  if (error || !data) {
    return internalErrorResponse("admin.company_document.signed_url", error, {
      code: "signed_url_failed",
      request,
    });
  }

  return NextResponse.json(
    {
      url: data.signedUrl,
      revision: company.verification_revision,
      kind: documentKind(path),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
