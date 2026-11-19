import { NextRequest, NextResponse } from "next/server";
import { adminIncidentContext } from "@/lib/api/admin-incident-route";
import { incidentRpcError, readJson } from "@/lib/api/incident-route";
import { internalErrorResponse } from "@/lib/api/errors";
import {
  incidentBodyRefusal,
  incidentDecisionSchema,
} from "@/lib/validations/incident";

/**
 * Dossier complet d'un signalement pour le support (lot 14, RPC
 * `admin_mission_incident`) : faits de la journée, versions, liste des
 * pièces (sans contenu), décision. Tout admin actif.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await adminIncidentContext(params);
    if (ctx.error) return ctx.error;
    const { data, error } = await ctx.supabase.rpc("admin_mission_incident", {
      p_incident_id: ctx.incidentId,
    });
    if (error)
      return incidentRpcError(
        error,
        "admin.incidents.read",
        "incident_failed",
        request,
      );
    // Interruption : versions des parties, travail déclaré, règlement et
    // règles de valorisation validées (aucune aujourd'hui).
    const kind = (data as { kind?: unknown } | null)?.kind;
    let interruption: unknown = null;
    if (kind === "interruption") {
      const res = await ctx.supabase.rpc("admin_mission_interruption", {
        p_incident_id: ctx.incidentId,
      });
      if (res.error)
        return incidentRpcError(
          res.error,
          "admin.incidents.read",
          "incident_failed",
          request,
        );
      interruption = res.data;
    }
    // Interruption : l'état courant de l'instruction (dossier rouvert
    // compris) vient de `incident_instruction_open`, la même lecture que
    // les RPC ; jamais du statut générique figé à la première décision.
    const instructionOpen = (
      interruption as { instruction_open?: unknown } | null
    )?.instruction_open;
    return NextResponse.json(
      {
        incident:
          data && typeof data === "object" && !Array.isArray(data)
            ? {
                ...data,
                interruption,
                ...(typeof instructionOpen === "boolean"
                  ? {
                      can_record_contact: instructionOpen,
                      instruction_open: instructionOpen,
                    }
                  : {}),
              }
            : data,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return internalErrorResponse("admin.incidents.read", error, {
      code: "incident_failed",
      request,
    });
  }
}

/**
 * Décision motivée (lot 14, RPC `admin_decide_mission_incident`) :
 * admin_ops ou admin_founder actif, définitive, tracée dans `audit_logs`.
 * Aucune conséquence (sanction, annulation, paiement) n'est appliquée.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await adminIncidentContext(params);
    if (ctx.error) return ctx.error;
    const parsed = incidentDecisionSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      const code = incidentBodyRefusal(parsed.error.issues[0]?.message);
      return NextResponse.json({ error: code, code }, { status: 400 });
    }
    const { data, error } = await ctx.supabase.rpc(
      "admin_decide_mission_incident",
      {
        p_incident_id: ctx.incidentId,
        p_outcome: parsed.data.outcome,
        p_note: parsed.data.note,
      },
    );
    if (error)
      return incidentRpcError(
        error,
        "admin.incidents.decide",
        "decision_failed",
        request,
      );
    return NextResponse.json({ decision: data[0] ?? null });
  } catch (error) {
    return internalErrorResponse("admin.incidents.decide", error, {
      code: "decision_failed",
      request,
    });
  }
}
