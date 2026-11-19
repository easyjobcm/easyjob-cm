import { requireAdminPage } from "@/lib/auth/admin-page";
import { CancellationsAdminClient } from "./cancellations-admin-client";

/**
 * Lot 17c — annulations des candidats. Garde relue à chaque rendu ; les
 * données passent par `/api/admin/cancellations`, qui revérifient le grade
 * en base (lecture : tout admin actif ; décisions et suspensions : ops et
 * fondateur ; signalement de fraude : tout admin actif).
 */
export default async function AdminCancellationsPage() {
  const { role } = await requireAdminPage("/admin/cancellations");
  return (
    <CancellationsAdminClient
      canDecide={role === "admin_ops" || role === "admin_founder"}
    />
  );
}
