/**
 * Lot 17d-4b — transports d'e-mail.
 *
 * Classement d'une tentative (documentation Resend lue le 2026-11-26 :
 * `Idempotency-Key`, conservée 24 h ; même clé et même contenu → même
 * réponse sans second envoi ; autre contenu → 409
 * `invalid_idempotent_request` ; requête d'origine en cours → 409
 * `concurrent_idempotent_requests`) :
 *   - accepted      : 2xx avec identifiant ;
 *   - retry         : refus sans traitement (429 : débit ou quota) ;
 *   - uncertain     : la requête a pu être traitée (délai, réseau, 5xx,
 *                     requête concurrente en cours) : reprise avec la même
 *                     clé seulement ;
 *   - indeterminate : la clé a déjà servi avec un autre contenu : un envoi
 *                     passé est possible, aucune relance ;
 *   - failed        : refus définitif (autre 4xx).
 * Aucune adresse, aucun objet ni corps n'est journalisé ou renvoyé.
 */
import { randomUUID } from "node:crypto";

export type EmailMessage = {
  to: string;
  from: string;
  replyTo: string;
  subject: string;
  text: string;
  html: string;
  /** Étiquettes renvoyées par les événements du fournisseur (corrélation). */
  tags: Record<string, string>;
};

export type SendOutcome =
  | { kind: "accepted"; providerId: string }
  | { kind: "retry"; code: string; retryAfterSeconds?: number }
  | { kind: "uncertain"; code: string; retryAfterSeconds?: number }
  | { kind: "indeterminate"; code: string }
  | { kind: "failed"; code: string };

export interface EmailTransport {
  readonly name: "fake" | "resend";
  send(message: EmailMessage, idempotencyKey: string): Promise<SendOutcome>;
}

const PROVIDER_ID = /^[A-Za-z0-9_-]{1,128}$/;
const ERROR_NAME = /^[a-z0-9_]{1,64}$/;

function retryAfter(headers: Headers): number | undefined {
  const v = Number(headers.get("retry-after"));
  return Number.isFinite(v) && v >= 0 ? Math.min(v, 3600) : undefined;
}

/** Traduit une réponse HTTP de Resend en issue (exportée pour les tests). */
export async function classifyResendResponse(
  res: Response,
): Promise<SendOutcome> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const rec = (body ?? {}) as Record<string, unknown>;
  if (res.status >= 200 && res.status < 300) {
    const id = typeof rec.id === "string" ? rec.id : "";
    // Réponse 2xx sans identifiant exploitable : l'envoi a pu avoir lieu.
    return PROVIDER_ID.test(id)
      ? { kind: "accepted", providerId: id }
      : { kind: "uncertain", code: "accepted_without_id" };
  }
  const rawName = typeof rec.name === "string" ? rec.name : "";
  const name = ERROR_NAME.test(rawName) ? rawName : `http_${res.status}`;
  if (res.status === 409 && name === "concurrent_idempotent_requests")
    return {
      kind: "uncertain",
      code: name,
      retryAfterSeconds: retryAfter(res.headers),
    };
  if (res.status === 409 && name === "invalid_idempotent_request")
    return { kind: "indeterminate", code: name };
  if (res.status === 429)
    return {
      kind: "retry",
      code: name,
      retryAfterSeconds: retryAfter(res.headers),
    };
  if (res.status >= 500)
    return {
      kind: "uncertain",
      code: name,
      retryAfterSeconds: retryAfter(res.headers),
    };
  return { kind: "failed", code: name };
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export function resendTransport(
  apiKey: string,
  options: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): EmailTransport {
  const doFetch: FetchLike = options.fetchImpl ?? ((i, init) => fetch(i, init));
  const timeoutMs = options.timeoutMs ?? 10_000;
  return {
    name: "resend",
    async send(message, idempotencyKey) {
      let res: Response;
      try {
        res = await doFetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
            "User-Agent": "easyjob-cm-mailer/1",
          },
          body: JSON.stringify({
            from: message.from,
            to: [message.to],
            reply_to: message.replyTo,
            subject: message.subject,
            text: message.text,
            html: message.html,
            tags: Object.entries(message.tags).map(([name, value]) => ({
              name,
              value,
            })),
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        // Délai dépassé ou coupure : la requête a pu être reçue.
        const timeout =
          error instanceof Error &&
          (error.name === "TimeoutError" || error.name === "AbortError");
        return {
          kind: "uncertain",
          code: timeout ? "timeout" : "network_error",
        };
      }
      return classifyResendResponse(res);
    },
  };
}

/**
 * Fournisseur simulé, sans réseau. Imite l'idempotence de Resend (même clé
 * et même contenu : même identifiant, aucun second envoi ; autre contenu :
 * `indeterminate`). `script` impose les issues des appels successifs :
 * `accept_lost` accepte puis perd la réponse (issue incertaine côté
 * appelant, envoi réel côté fournisseur).
 */
export type FakeStep =
  | "accept"
  | "accept_lost"
  | "rate_limited"
  | "server_error"
  | "rejected";

export type FakeTransport = EmailTransport & {
  /** Envois effectifs (un par clé), sans adresse. */
  readonly deliveries: { key: string; providerId: string; subject: string }[];
  readonly calls: number;
};

export function fakeTransport(script: FakeStep[] = []): FakeTransport {
  const byKey = new Map<string, { providerId: string; digest: string }>();
  const deliveries: { key: string; providerId: string; subject: string }[] = [];
  let calls = 0;
  const steps = [...script];
  return {
    name: "fake",
    deliveries,
    get calls() {
      return calls;
    },
    async send(message, idempotencyKey) {
      calls += 1;
      const step = steps.shift() ?? "accept";
      if (step === "rate_limited")
        return { kind: "retry", code: "rate_limit_exceeded" };
      if (step === "server_error")
        return { kind: "uncertain", code: "application_error" };
      if (step === "rejected")
        return { kind: "failed", code: "validation_error" };
      const digest = JSON.stringify([
        message.to,
        message.subject,
        message.text,
        message.html,
      ]);
      const known = byKey.get(idempotencyKey);
      if (known && known.digest !== digest)
        return { kind: "indeterminate", code: "invalid_idempotent_request" };
      let providerId = known?.providerId;
      if (!providerId) {
        providerId = `fake_${randomUUID()}`;
        byKey.set(idempotencyKey, { providerId, digest });
        deliveries.push({
          key: idempotencyKey,
          providerId,
          subject: message.subject,
        });
      }
      if (step === "accept_lost") return { kind: "uncertain", code: "timeout" };
      return { kind: "accepted", providerId };
    },
  };
}
