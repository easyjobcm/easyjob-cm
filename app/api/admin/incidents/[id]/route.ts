import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { incidentRpcError, readJson } from "@/lib/api/incident-route";
import { internalErrorResponse } from "@/lib/api/errors";
import {
  incidentBodyRefusal,
  incidentDecisionSchema,
} from "@/lib/validations/incident";

async function context(params: Promise<{ id: string }>) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      error: NextResponse.json(
        { error: "Unauthorized", code: "not_authenticated" },
        { status: 401 },
      ),
    } as const;
  }
  const incidentId = z.string().uuid().safeParse(id);
  if (!incidentId.success) {
    return {
      error: NextResponse.json(
        { error: "incident_not_found", code: "incident_not_found" },
        { status: 404 },
      ),
    } as const;
  }
  return { error: null, supabase, incidentId: incidentId.data } as const;
}

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
    const ctx = await context(params);
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
    return NextResponse.json(
      { incident: data },
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
    const ctx = await context(params);
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
