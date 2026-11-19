import { NextRequest } from "next/server";
import { adminAction } from "@/lib/api/admin-cancellation-route";
import { fraudSuspensionSchema } from "@/lib/validations/cancellation";

/**
 * Lot 17c — suspension pour fraude (ops ou fondateur actif) : fin explicite
 * ou aucune fin (jusqu'à levée), motif conservé. Aucun barème.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return adminAction(
    request,
    params,
    fraudSuspensionSchema,
    "admin.fraud.suspend",
    "suspension_failed",
    (supabase, id, body) =>
      supabase.rpc("admin_suspend_for_fraud", {
        p_report_id: id!,
        p_ends_at: body.ends_at as string,
        p_reason: body.reason,
      }),
    "fraud_report_not_found",
  );
}
