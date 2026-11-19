import { NextRequest, NextResponse } from "next/server";
import { missionRouteContext } from "@/lib/api/mission-route";
import { incidentRpcError, readJson } from "@/lib/api/incident-route";
import { internalErrorResponse } from "@/lib/api/errors";
import {
  incidentBodyRefusal,
  incidentReportSchema,
} from "@/lib/validations/incident";
import { interruptionReportSchema } from "@/lib/validations/partial-day";

/**
 * Signalements d'une mission (lot 14), vus par l'une de ses parties
 * (RPC `mission_incidents_for_party`) : faits déclarés, versions des deux
 * parties, nombre de pièces (jamais les pièces), décision du support.
 * Tiers : 404, comme une mission inexistante.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await missionRouteContext(params);
    if (ctx.error) return ctx.error;
    const { data, error } = await ctx.supabase.rpc(
      "mission_incidents_for_party",
      { p_mission_id: ctx.missionId },
    );
    if (error)
      return incidentRpcError(
        error,
        "incidents.list",
        "incidents_failed",
        request,
      );
    // Interruptions : versions des parties, cause, heure déclarée, travail
    // déclaré et règlement éventuel, rattachés à leur dossier.
    const { data: interruptions, error: interruptionsError } =
      await ctx.supabase.rpc("mission_interruptions_for_party", {
        p_mission_id: ctx.missionId,
      });
    if (interruptionsError)
      return incidentRpcError(
        interruptionsError,
        "incidents.list",
        "incidents_failed",
        request,
      );
    const byIncident = new Map(
      ((interruptions as { incident_id: string }[] | null) ?? []).map((x) => [
        x.incident_id,
        x,
      ]),
    );
    return NextResponse.json(
      {
        incidents: (data ?? []).map((i) => ({
          ...i,
          interruption: byIncident.get(i.incident_id) ?? null,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return internalErrorResponse("incidents.list", error, {
      code: "incidents_failed",
      request,
    });
  }
}

/**
 * Signaler un retard, une absence ou un code non remis sur une journée
 * (RPC `report_mission_incident`). La partie est déduite de la session ;
 * un second envoi renvoie le même signalement (`already_reported`).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await missionRouteContext(params);
    if (ctx.error) return ctx.error;
    const body = await readJson(request);
    // Interruption d'une journée commencée : dossier des lots 14 à 16,
    // champs propres (cause, heure déclarée, travail déclaré).
    if ((body as { kind?: unknown } | null)?.kind === "interruption") {
      const p = interruptionReportSchema.safeParse(body);
      if (!p.success) {
        const code = incidentBodyRefusal(p.error.issues[0]?.message);
        return NextResponse.json({ error: code, code }, { status: 400 });
      }
      const { data, error } = await ctx.supabase.rpc(
        "report_mission_interruption",
        {
          p_mission_id: ctx.missionId,
          p_mission_day_id: p.data.mission_day_id,
          p_cause: p.data.cause,
          p_declared_at: p.data.declared_at,
          p_work_done: p.data.work_done,
          p_reason: p.data.statement,
        },
      );
      if (error)
        return incidentRpcError(
          error,
          "incidents.report_interruption",
          "report_failed",
          request,
        );
      return NextResponse.json({ incident: data?.[0] ?? null });
    }
    const parsed = incidentReportSchema.safeParse(body);
    if (!parsed.success) {
      const code = incidentBodyRefusal(parsed.error.issues[0]?.message);
      return NextResponse.json({ error: code, code }, { status: 400 });
    }
    const { data, error } = await ctx.supabase.rpc("report_mission_incident", {
      p_mission_id: ctx.missionId,
      p_mission_day_id: parsed.data.mission_day_id,
      p_kind: parsed.data.kind,
      p_statement: parsed.data.statement,
      ...(parsed.data.late_minutes != null
        ? { p_late_minutes: parsed.data.late_minutes }
        : {}),
    });
    if (error)
      return incidentRpcError(
        error,
        "incidents.report",
        "report_failed",
        request,
      );
    const incident = data[0];
    if (!incident?.incident_id) {
      return internalErrorResponse("incidents.report", null, {
        code: "report_failed",
        request,
        reason: "result_mismatch",
      });
    }
    return NextResponse.json({ incident });
  } catch (error) {
    return internalErrorResponse("incidents.report", error, {
      code: "report_failed",
      request,
    });
  }
}
