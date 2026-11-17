import { requireAdminPage } from "@/lib/auth/admin-page";
import { IncidentsAdminClient } from "./incidents-admin-client";

/**
 * Signalements de mission (lot 14). Garde relue à chaque rendu ; les
 * données sont lues par les routes `/api/admin/incidents`, qui revérifient
 * le grade en base (lecture : tout admin actif ; décision : ops et
 * fondateur).
 */
export default async function AdminIncidentsPage() {
  const { role } = await requireAdminPage("/admin/incidents");
  return (
    <IncidentsAdminClient
      canDecide={role === "admin_ops" || role === "admin_founder"}
    />
  );
}
