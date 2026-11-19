import { NextRequest } from "next/server";
import { adminRead } from "@/lib/api/admin-cancellation-route";

/**
 * Lot 17c — dossier d'annulation pour le support : journées et classement
 * (plan compris), motif, pièces (identifiants seulement), décision,
 * recours, fraudes, suspensions et engagements futurs du candidat.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return adminRead(
    request,
    params,
    "admin_cancellation",
    (supabase, id) =>
      supabase.rpc("admin_candidate_cancellation", { p_id: id! }),
    "cancellation_not_found",
  );
}
