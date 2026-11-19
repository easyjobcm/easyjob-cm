import { NextRequest } from "next/server";
import { adminAction } from "@/lib/api/admin-cancellation-route";
import { fraudReportSchema } from "@/lib/validations/cancellation";

/**
 * Lot 17c — signalement d'une fraude présumée (tout admin actif). Aucune
 * suspension automatique : un ops ou fondateur décide ensuite.
 */
export async function POST(request: NextRequest) {
  return adminAction(
    request,
    null,
    fraudReportSchema,
    "admin.fraud.report",
    "fraud_report_failed",
    (supabase, _id, body) =>
      supabase.rpc("admin_report_fraud", {
        p_subject_user_id: body.subject_user_id,
        p_cancellation_id: body.cancellation_id as string,
        p_reason: body.reason,
      }),
  );
}
