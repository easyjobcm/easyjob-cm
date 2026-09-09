import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CniAdminClient } from "./cni-admin-client";

/**
 * T8.3 — Revue admin CNI (recto/verso/selfie).
 *
 * Garde de rôle : assurée par `app/admin/layout.tsx` (lecture = tous les
 * grades admin ; mutation = admin_ops/admin_founder). Cette page ne fait
 * que charger les profils dont le CNI a été soumis et dériver
 * `canModerate` (ops + founder uniquement) — admin_support a une vue
 * en lecture seule (SRS §8.4).
 *
 * Les photos sont stockées dans le bucket privé `candidate-documents` ;
 * le client les échange contre des URLs signées à courte durée via
 * l'API T8.2 `/api/admin/momo/[profileId]/cni-url?field=<cni_front_url|
 * cni_back_url|cni_selfie_url>`. À l'approbation, la route
 * `/api/admin/cni` POST supprime les 3 objets (SRS §8.4).
 */
export default async function AdminCniPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/");
  }

  const { data: userData } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  // Les candidats CNI non soumis ont `cni_front_url IS NULL` : on les
  // filtre pour que la liste ne contienne que ceux qui ont réellement
  // soumis des photos. Le chemin du bucket privé n'est JAMAIS envoyé au
  // client : on ne transmet que la présence (booléen) — le client ira
  // voir l'API d'URL signée (T8.2) au besoin.
  const { data: profiles } = await supabase
    .from("candidate_profiles")
    .select(
      `id, user_id, first_name, last_name, date_of_birth,
       cni_number, cni_verified, cni_expires_at, cni_rejection_reason,
       cni_front_url, cni_back_url, cni_selfie_url`,
    )
    .not("cni_front_url", "is", null)
    .order("cni_expires_at", { ascending: true, nullsFirst: true })
    .limit(500);

  const normalized = (profiles ?? []).map((p) => ({
    id: p.id,
    user_id: p.user_id,
    first_name: p.first_name,
    last_name: p.last_name,
    date_of_birth: p.date_of_birth,
    cni_number: p.cni_number,
    cni_verified: p.cni_verified ?? null,
    cni_expires_at: p.cni_expires_at,
    cni_rejection_reason: p.cni_rejection_reason,
    has_cni_front: Boolean(p.cni_front_url),
    has_cni_back: Boolean(p.cni_back_url),
    has_cni_selfie: Boolean(p.cni_selfie_url),
  }));

  return (
    <CniAdminClient
      profiles={normalized}
      canModerate={
        !!userData && ["admin_ops", "admin_founder"].includes(userData.role)
      }
    />
  );
}
