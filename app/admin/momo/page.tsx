import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MomoAdminClient } from "./momo-admin-client";

/**
 * T8.2 — Revue admin Mobile Money.
 *
 * Garde de rôle : assurée par `app/admin/layout.tsx` (lecture = tous les
 * grades admin ; mutation = admin_ops/admin_founder). Cette page ne fait
 * que charger les déclarations MoMo en attente et dériver `canModerate`
 * (ops + founder uniquement) — admin_support a une vue en lecture
 * seule.
 *
 * T8.4c — vue centralisée : la page ne liste QUE les comptes MoMo
 * « En attente » (`momo_verified=false` ET aucun motif de refus — un
 * compte déjà rejeté porte son motif et retombe sur la section de
 * l'utilisateur `/admin/candidates/[id]`, T8.4b, et la carte de la vue
 * centralisée T8.4a). MoMo n'a pas de FICHIER à purger : le « statut »
 * est porté par les colonnes `momo_verified` / `momo_reject_reason` du
 * profil.
 *
 * `?userId=<uuid>` (depuis la carte T8.4a) : filtre sur ce candidat
 * uniquement — l'admin arrive depuis `/admin/candidates` et veut voir
 * uniquement le MoMo de CET utilisateur, sans repérer les autres.
 *
 * Chaque profil retourné porte (T6) le numéro MoMo en clair, le nom du
 * compte déclaré ET les photos CNI (chemins du bucket privé) : c'est ce
 * qui permet à l'admin de confronté le nom déclaré au nom du CNI avant
 * de valider/refuser — les photos sont échangées contre des URLs
 * signées à courte durée par `/api/admin/momo/[profileId]/cni-url`.
 */

type MomoSearch = { userId?: string | string[] };

export default async function AdminMomoPage({
  searchParams,
}: {
  searchParams: Promise<MomoSearch>;
}) {
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

  const sp = await searchParams;
  const targetUserId =
    typeof sp.userId === "string" && sp.userId.length > 0 ? sp.userId : null;

  // T8.4c : liste « En attente » uniquement — `momo_verified=false`
  // ET `momo_reject_reason IS NULL` (un compte rejeté porte son motif
  // et ne doit plus occuper la file). Quand `?userId=` est donné : on
  // ne liste que ce candidat.
  let query = supabase
    .from("candidate_profiles")
    .select(
      `id, user_id, first_name, last_name, momo_provider, momo_number,
       momo_account_name, momo_verified, momo_reject_reason,
       momo_verified_at, momo_verified_by,
       cni_front_url, cni_back_url, cni_selfie_url,
       cni_verified, cni_number,
       verifier:users!momo_verified_by ( phone )`,
    )
    .eq("momo_verified", false)
    .is("momo_reject_reason", null)
    .not("momo_number", "is", null)
    .order("momo_verified_at", { ascending: true, nullsFirst: true })
    .limit(500);

  if (targetUserId) {
    query = query.eq("user_id", targetUserId);
  }

  const { data: profiles } = await query;

  // Le chemin CNI stocké pointe vers un objet privé ; on ne l'envoie tel
  // quel au client que comme « présence » (booléen) — le client ira
  // voir l'API d'URL signée au besoin. On garde les chemins car l'API
  // admin les lit côté serveur ; le client ne les utilise que pour
  // décider s'il affiche le bouton « voir le CNI ».
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
      filterUserId={targetUserId}
      canModerate={
        !!userData && ["admin_ops", "admin_founder"].includes(userData.role)
      }
    />
  );
}
