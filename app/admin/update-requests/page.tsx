import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { UpdateRequestsAdminClient } from "./update-requests-admin-client";

/**
 * T8.5 — Revue des mises à jour de profil initiées par l'admin
 * (SRS §5.1.1). Page de pilotage « En attente / Exécutées / Annulées »
 * (sections dérivées côté client sur `status`) + demande d'une nouvelle
 * mise à jour (POST T2 `/api/admin/profile-update-requests`).
 *
 * Garde de rôle : `app/admin/layout.tsx` (T8.1). Lecture = les 3 grades
 * (policy `profile_update_requests_select_own_or_admin`) ; mutation
 * (annulation `PATCH`, purge `DELETE`, création `POST`) =
 * admin_ops/admin_founder (admin_support lecture seule).
 *
 * LECTURE en session admin (pas service_role) : contrairement à `users`
 * (T8.4a), `profile_update_requests` a une policy SELECT admin explicite —
 * la session lit bien. L'initiateur (`requested_by → users.email`) est
 * résolu en service_role car session = « propre profil » seulement.
 */
export default async function AdminUpdateRequestsPage() {
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

  return (
    <UpdateRequestsAdminClient
      canModerate={
        !!userData && ["admin_ops", "admin_founder"].includes(userData.role)
      }
    />
  );
}
