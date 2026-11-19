import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAction } from "@/lib/api/admin-cancellation-route";

const schema = z.object({
  action: z.enum(["lift", "maintain"], "decision_invalid"),
  note: z.string().trim().min(10, "note_invalid").max(2000, "note_invalid"),
  // Décision prise sur une contestation du candidat.
  from_contest: z.boolean().default(false),
});

/**
 * Lot 17c — levée d'une suspension (cycle ou fraude) ou maintien après
 * contestation, par un ops ou fondateur actif. L'état du compte est
 * recalculé sur toutes les causes : une autre suspension en cours reste
 * appliquée.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return adminAction(
    request,
    params,
    schema,
    "admin.suspensions.decide",
    "suspension_failed",
    (supabase, id, body) =>
      body.action === "lift"
        ? supabase.rpc("admin_lift_suspension", {
            p_suspension_id: id!,
            p_reason: body.note,
            p_from_contest: body.from_contest,
          })
        : supabase.rpc("admin_maintain_suspension", {
            p_suspension_id: id!,
            p_note: body.note,
          }),
    "suspension_not_found",
  );
}
