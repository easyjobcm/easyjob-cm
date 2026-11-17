import { NextRequest, NextResponse } from "next/server";
import { adminIncidentContext } from "@/lib/api/admin-incident-route";
import { incidentRpcError, readJson } from "@/lib/api/incident-route";
import { internalErrorResponse } from "@/lib/api/errors";
import {
  dayConfirmationSchema,
  incidentBodyRefusal,
} from "@/lib/validations/incident";

/**
 * Confirmation d'une journée par le support (lot 15, RPC
 * `admin_confirm_mission_day`) : admin_ops ou admin_founder actif, dossier
 * « code non remis » ouvert, fin prévue atteinte, réponse « travail
 * confirmé » de l'entreprise consignée sur le dossier. La base enregistre la
 * réalisation (provenance « support », code non consommé), la décision, la
 * trace et les notifications dans une transaction ; une journée déjà
 * confirmée (code saisi entre-temps, relance) renvoie le résultat acquis.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await adminIncidentContext(params);
    if (ctx.error) return ctx.error;
    const parsed = dayConfirmationSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      const code = incidentBodyRefusal(parsed.error.issues[0]?.message);
      return NextResponse.json({ error: code, code }, { status: 400 });
    }
    const { data, error } = await ctx.supabase.rpc(
      "admin_confirm_mission_day",
      {
        p_incident_id: ctx.incidentId,
        p_contact_id: parsed.data.contact_id,
        p_reason: parsed.data.reason,
      },
    );
    if (error)
      return incidentRpcError(
        error,
        "admin.incidents.confirm_day",
        "confirmation_failed",
        request,
      );
    const row = data[0];
    if (!row) {
      return internalErrorResponse("admin.incidents.confirm_day", null, {
        code: "confirmation_failed",
        request,
        reason: "result_missing",
      });
    }
    return NextResponse.json({
      confirmation: {
        result: row.result,
        mission_day_id: row.mission_day_id,
        completed_at: row.completed_at,
        completed_via: row.completed_via,
        mission_completed: row.mission_completed,
        already_confirmed: row.already_confirmed,
      },
    });
  } catch (error) {
    return internalErrorResponse("admin.incidents.confirm_day", error, {
      code: "confirmation_failed",
      request,
    });
  }
}
