import { NextRequest } from "next/server";
import { adminRead } from "@/lib/api/admin-cancellation-route";

const STATUSES = new Set([
  "to_review",
  "closed_no_sanction",
  "awaiting_evidence",
  "under_review",
  "sanctioned_no_evidence",
  "accepted",
  "refused",
]);

/**
 * Lot 17c — demandes d'annulation des candidats (trois grades actifs,
 * contrôle en base). `status=to_review` : justificatifs et recours à
 * examiner.
 */
export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get("status");
  return adminRead(request, null, "admin_cancellations", (supabase) =>
    supabase.rpc("admin_candidate_cancellations", {
      p_status: (status && STATUSES.has(status) ? status : null) as string,
    }),
  );
}
