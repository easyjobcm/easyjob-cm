import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { internalErrorResponse } from "@/lib/api/errors";
import { readJson } from "@/lib/api/incident-route";
import {
  interruptionRefusal,
  partyInterruptionActionSchema,
} from "@/lib/validations/partial-day";

/**
 * Actions d'une partie (candidat ou entreprise) sur un dossier
 * d'interruption :
 * - `respond` : accepter ou refuser une proposition du fondateur, sur sa
 *   version (`respond_interruption_proposal`) ; échéance de 48 h incluse,
 *   contrôlée à l'heure de la base ; le silence ne vaut jamais accord ;
 * - `recourse` : le code n'est pas remis malgré l'accord
 *   (`request_interruption_finalization`) ;
 * - `viewed` : consultation observée du dossier (`mark_interruption_viewed`),
 *   distincte de la notification créée ;
 * - `reexamination` : signaler une erreur dans une décision du fondateur
 *   (`request_interruption_reexamination`) ; ne change ni blocage ni délai.
 * La partie est déduite de la session ; la base revérifie tout.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const op = "missions.interruption_action";
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "not_authenticated", code: "not_authenticated" },
        { status: 401 },
      );
    }
    const incidentId = z.string().uuid().safeParse(id);
    if (!incidentId.success) {
      return NextResponse.json(
        { error: "incident_not_found", code: "incident_not_found" },
        { status: 404 },
      );
    }
    const parsed = partyInterruptionActionSchema.safeParse(
      await readJson(request),
    );
    if (!parsed.success) {
      const code =
        interruptionRefusal(parsed.error.issues[0]?.message)?.code ??
        "invalid_request";
      return NextResponse.json({ error: code, code }, { status: 400 });
    }
    const body = parsed.data;
    const { data, error } =
      body.action === "respond"
        ? await supabase.rpc("respond_interruption_proposal", {
            p_proposal_id: body.proposal_id,
            p_version: body.version,
            p_decision: body.decision,
          })
        : body.action === "recourse"
          ? await supabase.rpc("request_interruption_finalization", {
              p_incident_id: incidentId.data,
            })
          : body.action === "reexamination"
            ? await supabase.rpc("request_interruption_reexamination", {
                p_incident_id: incidentId.data,
                p_reason: body.reason,
              })
            : await supabase.rpc("mark_interruption_viewed", {
                p_incident_id: incidentId.data,
              });
    if (error) {
      const refusal = interruptionRefusal(error.message);
      if (refusal) {
        return NextResponse.json(
          { error: refusal.code, code: refusal.code },
          { status: refusal.status },
        );
      }
      return internalErrorResponse(op, error, {
        code: "interruption_action_failed",
        request,
      });
    }
    return NextResponse.json({ result: data });
  } catch (error) {
    return internalErrorResponse(op, error, {
      code: "interruption_action_failed",
      request,
    });
  }
}
