import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { internalErrorResponse } from "@/lib/api/errors";
import { readEmailConfig } from "@/lib/email/config";
import { runReplacementEmailDispatch } from "@/lib/email/run";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Lot 17d-4b — passage d'envoi de la file des alertes de remplacement.
 *
 * Appelée par un planificateur (à mettre en service : voir
 * docs/deployment/production.md, « E-mails de remplacement ») avec
 * `Authorization: Bearer <EMAIL_DISPATCH_SECRET>`. Sans secret configuré,
 * la route n'existe pas (404). Elle lance d'abord le balayage de la base
 * (rétablissements ANN-22, reprise des intentions, fermetures, 90 jours),
 * puis un passage d'envoi si le mode le permet. Réponse : compteurs
 * seulement.
 *
 * Clé service (justification) : balayage et file réservés à la clé service ;
 * l'appelant est authentifié par le secret, comparé en temps constant.
 */
function authorized(request: NextRequest, secret: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(request: NextRequest) {
  const config = readEmailConfig();
  if (!config.dispatchSecret || config.dispatchSecret.length < 32) {
    return NextResponse.json({ code: "not_found" }, { status: 404 });
  }
  if (!authorized(request, config.dispatchSecret)) {
    return NextResponse.json({ code: "unauthorized" }, { status: 401 });
  }
  try {
    const { data: sweep, error } = await createAdminClient().rpc(
      "replacement_email_sweep",
    );
    if (error) throw error;
    const summary = await runReplacementEmailDispatch(50);
    return NextResponse.json(
      { sweep, dispatch: summary, problems: config.problems },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return internalErrorResponse("email.outbox.dispatch", error, {
      code: "email_dispatch_failed",
      request,
    });
  }
}
