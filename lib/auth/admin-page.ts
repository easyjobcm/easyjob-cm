// SERVER ONLY — pages `app/admin/**` (Server Components).
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdminRole, type AdminRole } from "@/lib/auth/admin-role";
import { loginHref } from "@/lib/auth/safe-redirect";

/**
 * Garde d'une page admin, relue en base à chaque rendu (audit F-31).
 *
 * Le layout `app/admin/layout.tsx` ne suffit pas comme seule garde : lors
 * d'une navigation côté client, Next ne réexécute que les segments qui
 * changent, et une requête RSC peut demander la page sans son layout. Toute
 * page qui lit des données hors RLS (clé service) appelle donc cette
 * fonction AVANT la lecture. Les pages qui ne lisent qu'en session restent
 * protégées par la RLS ; les routes `/api/admin/*` gardent leur propre
 * contrôle.
 *
 * Compte sans session → connexion (retour sur `next`) ; non admin ou
 * compte suspendu → accueil. Même règle que `is_admin_user()` en base
 * (`is_active` n'est pas false, migration 20261110130000).
 */
export async function requireAdminPage(next: string): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  role: AdminRole;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(loginHref(next));

  const { data: row } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .not("is_active", "is", false)
    .single();
  if (!row || !isAdminRole(row.role)) redirect("/");

  return { supabase, userId: user.id, role: row.role };
}
