/**
 * Lot 17d-4b — authenticité des événements Resend (signature Svix).
 *
 * Documentation lue le 2026-11-26 (resend.com/docs/webhooks/verify-webhooks-requests,
 * docs.svix.com/receiving/verifying-payloads/how-manual) : contenu signé
 * `${svix-id}.${svix-timestamp}.${corps brut}`, HMAC-SHA256 avec la partie
 * base64 du secret `whsec_…`, signature base64 ; l'en-tête `svix-signature`
 * contient une ou plusieurs signatures `v1,<base64>` séparées par des
 * espaces ; comparaison en temps constant. La tolérance sur l'horodatage
 * n'est pas chiffrée par ces pages : 5 minutes ici (rejeu borné).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export type WebhookHeaders = {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
};

export type SignatureCheck =
  | { ok: true; eventId: string }
  | {
      ok: false;
      reason: "missing_headers" | "bad_secret" | "stale" | "mismatch";
    };

function secretKey(secret: string): Buffer | null {
  const part = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(part)) return null;
  const key = Buffer.from(part, "base64");
  return key.length >= 16 ? key : null;
}

export function verifyWebhookSignature(
  rawBody: string,
  headers: WebhookHeaders,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SignatureCheck {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !/^\d{1,12}$/.test(timestamp))
    return { ok: false, reason: "missing_headers" };
  const key = secretKey(secret);
  if (!key) return { ok: false, reason: "bad_secret" };
  if (Math.abs(nowSeconds - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS)
    return { ok: false, reason: "stale" };
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest();
  for (const entry of signature.split(" ")) {
    const [version, value] = entry.split(",", 2);
    if (version !== "v1" || !value) continue;
    const given = Buffer.from(value, "base64");
    if (given.length === expected.length && timingSafeEqual(given, expected))
      return { ok: true, eventId: id };
  }
  return { ok: false, reason: "mismatch" };
}
