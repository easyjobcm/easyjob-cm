import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/layout/bottom-nav";
import type { UserRole } from "@/components/layout/bottom-nav";

/**
 * T8.1 — Layout admin : guard de rôle unique + navigation basse.
 *
 * Toutes les pages `app/admin/**` passent ici : vérification de
 * connectivité ET du rôle admin (admin_support / admin_ops /
 * admin_founder) en UN SEUL endroit — les pages admin n'ont plus à
 * re-garder le rôle (elles peuvent faire confiance au layout).
 *
 * La navigation basse admin (`adminNavItems` de `BottomNav`) est montée
 * ici, sur `/admin` et ses sous-pages (`/admin/momo`, `/admin/users`,
 * `/admin/jobs`, `/admin/settings`, `/admin/skill-documents`…) :
 * mobile-first + safe-area-inset-bottom, comme la barre candidat.
 */
export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login?next=/admin");
  }

  const { data: userData } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  const adminRoles = ["admin_support", "admin_ops", "admin_founder"];
  if (!userData?.role || !adminRoles.includes(userData.role)) {
    redirect("/");
  }

  return (
    <>
      <div className="pb-[calc(5rem+env(safe-area-inset-bottom))]">
        {children}
      </div>
      <BottomNav userRole={userData.role as UserRole} />
    </>
  );
}
