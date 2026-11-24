import { requireAdminPage } from "@/lib/auth/admin-page";
import { InterventionsAdminClient } from "./interventions-admin-client";

/**
 * Lot 17d-3 — interventions du support sur les engagements. Garde relue à
 * chaque rendu ; les données passent par `/api/admin/engagement-requests`
 * et `/api/admin/absence-findings`, qui revérifient le grade en base
 * (lecture et instruction : tout admin actif ; décisions : ops et
 * fondateur actifs).
 */
export default async function AdminInterventionsPage() {
  const { role } = await requireAdminPage("/admin/interventions");
  return (
    <InterventionsAdminClient
      canDecide={role === "admin_ops" || role === "admin_founder"}
    />
  );
}
