import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

/**
 * /profile — redirige vers la route spécifique au rôle de l'utilisateur.
 * Aucun rendu UI ici : la logique métier est dans les sous-routes.
 */
export default async function ProfilePage() {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/auth/login?redirect=/profile");
  }

  const { data: userData } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!userData) {
    redirect("/auth/login");
  }

  const role = userData.role as string;

  if (role === "candidate" || role === "candidate_premium") {
    redirect("/profile/candidate");
  }

  if (role === "company" || role === "company_premium") {
    redirect("/profile/company");
  }

  // Rôles admin → tableau de bord admin
  redirect("/admin");
}
