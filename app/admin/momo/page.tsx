import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MomoAdminClient } from "./momo-admin-client";

/**
 * T8.2 — Revue admin Mobile Money.
 *
 * Garde de rôle : assurée par `app/admin/layout.tsx` (lecture = tous les
 * grades admin ; mutation = admin_ops/admin_founder). Cette page ne fait
 * que charger les déclarations MoMo et dériver `canModerate` (ops +
 * founder uniquement) — admin_support a une vue en lecture seule.
 *
 * Chaque profil retourné porte (T6) le numéro MoMo en clair, le nom du
 * compte déclaré ET les photos CNI (chemins du bucket privé) : c'est ce
 * qui permet à l'admin de confronter le nom déclaré au nom du CNI avant
 * de valider/refuser — les photos sont échangées contre des URLs signées
 * à courte durée par `/api/admin/momo/[profileId]/cni-url`.
 */
export default async function AdminMomoPage() {
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

  const { data: profiles } = await supabase
    .from("candidate_profiles")
    .select(
      `id, user_id, first_name, last_name, momo_provider, momo_number,
       momo_account_name, momo_verified, momo_reject_reason,
       momo_verified_at, momo_verified_by,
       cni_front_url, cni_back_url, cni_selfie_url,
       cni_verified, cni_number,
       verifier:users!momo_verified_by ( phone )`,
    )
    .not("momo_number", "is", null)
    .order("momo_verified_at", { ascending: true, nullsFirst: true })
    .limit(500);

  // Le chemin CNI stocké pointe vers un objet privé ; on ne l'envoie tel
  // quel au client que comme "présence" (booléen) — le client ira voir
  // l'API d'URL signée au besoin. On garde les chemins car l'API admin
  // les lit côté serveur ; le client ne les utilise que pour décider
  // s'il affiche le bouton "voir le CNI".
  const normalized = (profiles ?? []).map((p) => {
    const verifier = Array.isArray(p.verifier) ? p.verifier[0] : p.verifier;
    return {
      id: p.id,
      user_id: p.user_id,
      first_name: p.first_name,
      last_name: p.last_name,
      momo_provider: p.momo_provider,
      momo_number: p.momo_number,
      momo_account_name: p.momo_account_name,
      momo_verified: p.momo_verified,
      momo_reject_reason: p.momo_reject_reason,
      momo_verified_at: p.momo_verified_at,
      momo_verified_by: p.momo_verified_by,
      verifier_phone: verifier?.phone ?? null,
      has_cni: Boolean(p.cni_front_url || p.cni_back_url || p.cni_selfie_url),
      cni_verified: p.cni_verified ?? null,
      cni_number: p.cni_number ?? null,
    };
  });

  return (
    <MomoAdminClient
      profiles={normalized}
      canModerate={
        !!userData && ["admin_ops", "admin_founder"].includes(userData.role)
      }
    />
  );
}
