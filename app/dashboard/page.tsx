import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

/**
 * /dashboard — route legacy dissoute dans la navigation à 4 onglets.
 * Conservée comme redirection compatible (pas de 404) vers la destination
 * adaptée au rôle. Les métriques candidat sont dans Profil, les candidatures
 * dans Mes Jobs.
 */
export default async function DashboardRedirectPage() {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/auth/login?next=/dashboard");
  }

  const { data: userData } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  const role = userData?.role as string | undefined;

  if (role === "company" || role === "company_premium") {
    redirect("/company/dashboard");
  }

  if (
    role === "admin_support" ||
    role === "admin_ops" ||
    role === "admin_founder"
  ) {
    redirect("/admin");
  }

  redirect("/jobs");
}
