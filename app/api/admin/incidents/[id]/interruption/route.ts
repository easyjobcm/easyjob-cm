import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { internalErrorResponse } from "@/lib/api/errors";
import { readJson } from "@/lib/api/incident-route";
import {
  founderInterruptionActionSchema,
  interruptionRefusal,
} from "@/lib/validations/partial-day";

/**
 * Décisions du fondateur sur un dossier d'interruption (décision du
 * 2026-11-20) : proposer ou modifier un montant motivé, clore (non établie,
 * désaccord non résolu), prolonger exceptionnellement son délai, finaliser
 * un accord dont le code n'a pas été remis, traiter un réexamen demandé
 * par une partie. `viewed` : consultation
 * observée par le fondateur. Réservé à un admin_founder ACTIF : revérifié
 * ici (compte actif exigé) puis par chaque RPC (`is_founder_admin_user`).
 * admin_support et admin_ops instruisent par les routes du lot 16.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const op = "admin.incidents.interruption";
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
    const { data: me } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .not("is_active", "is", false)
      .single();
    if (me?.role !== "admin_founder") {
      return NextResponse.json(
        { error: "forbidden", code: "forbidden" },
        { status: 403 },
      );
    }
    const incidentId = z.string().uuid().safeParse(id);
    if (!incidentId.success) {
      return NextResponse.json(
        { error: "incident_not_found", code: "incident_not_found" },
        { status: 404 },
      );
    }
    const parsed = founderInterruptionActionSchema.safeParse(
      await readJson(request),
    );
    if (!parsed.success) {
      const code =
        interruptionRefusal(parsed.error.issues[0]?.message)?.code ??
        "invalid_request";
      return NextResponse.json({ error: code, code }, { status: 400 });
    }
    const body = parsed.data;
    const p_incident_id = incidentId.data;
    const { data, error } =
      body.action === "propose"
        ? await supabase.rpc("admin_propose_interruption_amount", {
            p_incident_id,
            p_amount: body.amount,
            p_motivation: body.motivation,
            p_expected_version: body.expected_version,
          })
        : body.action === "close"
          ? await supabase.rpc("admin_close_interruption", {
              p_incident_id,
              p_outcome: body.outcome,
              p_motivation: body.motivation,
            })
          : body.action === "extend"
            ? await supabase.rpc("admin_extend_interruption_review", {
                p_incident_id,
                p_ends_at: body.ends_at,
                p_reason: body.reason,
              })
            : body.action === "finalize"
              ? await supabase.rpc("admin_finalize_interruption", {
                  p_incident_id,
                  p_version: body.version,
                  p_motivation: body.motivation,
                })
              : body.action === "reexamination"
                ? await supabase.rpc(
                    "admin_decide_interruption_reexamination",
                    {
                      p_reexamination_id: body.reexamination_id,
                      p_decision: body.decision,
                      p_motivation: body.motivation,
                    },
                  )
                : await supabase.rpc("mark_interruption_viewed", {
                    p_incident_id,
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
        code: "interruption_decision_failed",
        request,
      });
    }
    return NextResponse.json({ result: data });
  } catch (error) {
    return internalErrorResponse(op, error, {
      code: "interruption_decision_failed",
      request,
    });
  }
}
