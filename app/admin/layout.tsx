import { requireAdminPage } from "@/lib/auth/admin-page";
import { BottomNav } from "@/components/layout/bottom-nav";
import type { UserRole } from "@/components/layout/bottom-nav";
import { LiveRefresh } from "@/lib/realtime/provider";

/**
 * T8.1 — Layout admin : garde de rôle et navigation basse.
 *
 * Premier contrôle du rôle admin (admin_support / admin_ops /
 * admin_founder) au chargement de `app/admin/**`. Il ne
 * suffit pas seul : une navigation côté client ne réexécute pas le layout.
 * Toute page qui lit hors RLS (clé service) rappelle `requireAdminPage`
 * avant sa lecture (audit F-31, `lib/auth/admin-page.ts`).
 *
 * La navigation basse admin (`adminNavItems` de `BottomNav`) est montée
 * ici, sur `/admin` et ses sous-pages (`/admin/momo`, `/admin/users`,
 * `/admin/jobs`, `/admin/settings`, `/admin/skill-documents`…) :
 * mobile-first + safe-area-inset-bottom, comme la barre candidat.
 */
export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { role } = await requireAdminPage("/admin");

  return (
    <>
      {/* Lot 7d : rôle ou grade modifié → relecture (garde ci-dessus). */}
      <LiveRefresh keys={["account"]} />
      <div className="pb-[calc(5rem+env(safe-area-inset-bottom))]">
        {children}
      </div>
      <BottomNav userRole={role as UserRole} />
    </>
  );
}
