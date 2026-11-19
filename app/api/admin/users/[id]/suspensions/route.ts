import { NextRequest } from "next/server";
import { adminRead } from "@/lib/api/admin-cancellation-route";

/**
 * Lot 17c — suspensions d'un compte (toutes causes), fraudes signalées et
 * engagements futurs déjà sélectionnés (information : rien n'est supprimé
 * ni transformé en absence). Trois grades actifs, contrôle en base.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return adminRead(
    request,
    params,
    "admin_suspensions",
    (supabase, id) =>
      supabase.rpc("admin_account_suspensions", { p_user_id: id! }),
    "user_not_found",
  );
}
