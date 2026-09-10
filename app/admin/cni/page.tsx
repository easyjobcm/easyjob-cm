import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CniAdminClient } from "./cni-admin-client";

/**
 * T8.3 — Revue admin CNI (recto/verso/selfie).
 *
 * Garde de rôle : assurée par `app/admin/layout.tsx` (lecture = tous les
 * grades admin ; mutation = admin_ops/admin_founder). Cette page ne fait
 * que charger les profils CNI en attente et dériver `canModerate`
 * (ops + founder uniquement) — admin_support a une vue en lecture
 * seule (SRS §8.4).
 *
 * T8.4c — vue centralisée : la page ne liste QUE les CNI « En attente »
 * (`cni_verified='pending'`) — le statut de chaque document (vérifié /
 * refusé + motif / expiré) s'affiche désormais sur la section de
 * l'utilisateur (`/admin/candidates/[id]`, T8.4b) et sur la carte de la
 * vue centralisée (T8.4a).
 *
 * `?userId=<uuid>` (depuis la carte T8.4a) : filtre sur ce candidat
 * uniquement — l'admin arrive depuis `/admin/candidates` et veut voir
 * uniquement les CNI de CET utilisateur, sans repérer les autres.
 *
 * Les photos sont stockées dans le bucket privé `candidate-documents` ;
 * le client les échange contre des URLs signées à courte durée via
 * l'API T8.2 `/api/admin/momo/[profileId]/cni-url?field=<cni_front_url|
 * cni_back_url|cni_selfie_url>`. À l'approbation OU au rejet, la route
 * `/api/admin/cni` POST supprime les 3 objets (T8.4c : purge immédiate
 * des fichiers rejetés — decision produit).
 */

type CniSearch = { userId?: string | string[] };

export default async function AdminCniPage({
  searchParams,
}: {
  searchParams: Promise<CniSearch>;
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

  // T8.4c : liste « En attente » uniquement (cni_verified = 'pending' —
  // la DEFAULT de la baseline, mais on filtre explicitement car le RPC
  // de revue peut la basculer à 'verified'/'rejected').
  // T8.4c : ?userId= → filtre sur ce candidat uniquement (arrivée depuis
  // la carte `/admin/candidates/[id]` ou `/admin/candidates`).
  let query = supabase
    .from("candidate_profiles")
    .select(
      `id, user_id, first_name, last_name, date_of_birth,
       cni_number, cni_verified, cni_expires_at, cni_rejection_reason,
       cni_front_url, cni_back_url, cni_selfie_url`,
    )
    .eq("cni_verified", "pending")
    .not("cni_front_url", "is", null)
    .order("cni_expires_at", { ascending: true, nullsFirst: true })
    .limit(500);

  if (targetUserId) {
    query = query.eq("user_id", targetUserId);
  }

  const { data: profiles } = await query;

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
      filterUserId={targetUserId}
      canModerate={
        !!userData && ["admin_ops", "admin_founder"].includes(userData.role)
      }
    />
  );
}
