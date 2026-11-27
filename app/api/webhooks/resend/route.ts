import { NextRequest, NextResponse } from "next/server";
import { internalErrorResponse } from "@/lib/api/errors";
import { readEmailConfig } from "@/lib/email/config";
import { verifyWebhookSignature } from "@/lib/email/webhook-signature";
import { logServerWarning } from "@/lib/observability/server-log";
import { createAdminClient } from "@/lib/supabase/server";
import {
  outboxIdFromTags,
  resendWebhookSchema,
} from "@/lib/validations/email-webhook";

/**
 * Lot 17d-4b — événements du fournisseur d'e-mail (Resend, signature Svix).
 *
 * 1. Signature vérifiée sur le corps brut, avant toute lecture ; horodatage
 *    à ±5 min. Échec → 401, rien n'est écrit.
 * 2. Contenu validé (Zod) ; seuls type, date, identifiant du message et
 *    étiquette `outbox_id` sont transmis à la base. Un événement sans
 *    cette étiquette (e-mail d'authentification envoyé par le SMTP de
 *    Supabase sur le même compte Resend) est accusé sans écriture.
 * 3. `replacement_email_provider_event` dédoublonne par `svix-id` et
 *    applique l'état sans retour en arrière (ordre d'arrivée quelconque).
 *
 * Clé service (justification) : aucune session (appel du fournisseur) ;
 * l'appelant est authentifié par la signature avant l'appel ; la fonction
 * n'est exécutable que par la clé service.
 */
export async function POST(request: NextRequest) {
  const config = readEmailConfig();
  if (!config.webhookSecret) {
    return NextResponse.json({ code: "not_found" }, { status: 404 });
  }
  const raw = await request.text();
  if (raw.length > 256 * 1024) {
    return NextResponse.json({ code: "payload_too_large" }, { status: 413 });
  }
  const check = verifyWebhookSignature(
    raw,
    {
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    },
    config.webhookSecret,
  );
  if (!check.ok) {
    logServerWarning("email.webhook", `signature_${check.reason}`, {
      category: "provider",
      status: 401,
    });
    return NextResponse.json({ code: "invalid_signature" }, { status: 401 });
  }
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(check.eventId)) {
    return NextResponse.json({ code: "invalid_event" }, { status: 400 });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ code: "invalid_event" }, { status: 400 });
  }
  const parsed = resendWebhookSchema.safeParse(json);
  if (!parsed.success) {
    // Authentique mais inattendu : accusé sans effet (aucune reprise inutile).
    logServerWarning("email.webhook", "event_unparsed", {
      category: "provider",
    });
    return NextResponse.json({ effect: "ignored_shape" });
  }
  const event = parsed.data;
  if (!event.type.startsWith("email.")) {
    return NextResponse.json({ effect: "ignored_type" });
  }
  // Compte Resend partagé avec le SMTP de Supabase Auth : les événements
  // des e-mails d'authentification (sans étiquette `outbox_id`) sont
  // accusés sans aucune écriture. Chaque alerte de remplacement porte
  // cette étiquette.
  // La base vérifie ensuite que l'étiquette et l'identifiant du fournisseur
  // correspondent à un véritable envoi d'alerte, sinon rien n'est écrit.
  const outboxId = outboxIdFromTags(event.data.tags);
  if (
    !outboxId ||
    event.data.tags?.kind !== "replacement_alert" ||
    !event.data.email_id
  ) {
    return NextResponse.json({ effect: "ignored_foreign" });
  }

  try {
    const { data, error } = await createAdminClient().rpc(
      "replacement_email_provider_event",
      {
        p_event_id: check.eventId,
        p_type: event.type,
        p_occurred_at: event.created_at,
        p_provider_id: event.data.email_id,
        p_outbox_id: outboxId,
      },
    );
    if (error) throw error;
    return NextResponse.json({ effect: data });
  } catch (error) {
    // 500 : le fournisseur reprendra l'envoi de l'événement.
    return internalErrorResponse("email.webhook", error, {
      code: "email_webhook_failed",
      request,
    });
  }
}
