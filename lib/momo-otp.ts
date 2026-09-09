/**
 * T6 — Mobile Money : preuve de possession du numéro (OTP 6 chiffres SMS).
 *
 * Règle produit (décision T6) : le nouveau numéro DOIT être prouvé par le
 * candidat (SMS) AVANT toute validation admin ; 3 codes erronés refusent
 * la preuve (le numéro repasse « rejeté », un nouvel envoi réarme).
 *
 * Sécurité : le code en clair n'est JAMAIS persisté — seul son hash
 * SHA-256 le est (table `momo_otp`, RLS deny-by-default, accessible seule-
 * ment via les RPC SECURITY DEFINER `momo_issue_otp`/`momo_verify_otp`).
 *
 * Les fonctions ci-dessous sont pures (ou déterministes) et testables sans
 * DOM : l'environnement vitest est `node`, sans jsdom.
 */
import { randomInt } from "node:crypto";
import { createHash } from "node:crypto";

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_TTL_SECONDS = Math.floor(OTP_TTL_MS / 1000);
export const MAX_OTP_ATTEMPTS = 3;
export const OTP_TOKEN_LENGTH = 6;

/**
 * Génère un code de 6 chiffres (100000..999999).
 * `crypto.randomInt` = CSPRNG Node, pas de `Math.random` (pas de biais).
 */
export function generateMomoOtpToken(): string {
  return String(randomInt(100_000, 1_000_000));
}

/**
 * Hash SHA-256 hex du code — la valeur stockée dans `momo_otp.token_hash`.
 * `createHash` (sync) plutôt que `crypto.subtle` (async, navigateur) :
 * c'est du code server-only, sync = routes plus simples.
 */
export function hashMomoOtpToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Format d'affichage du numéro camerounais : `612 345 678` → « 612 345 678 ».
 * Utilisé à la fois pour l'affichage (page /profile/payment masquée par la
 * suite au composant) et pour l'interpolation i18n « Code envoyé au {x} ».
 * Ne modifie jamais le numéro source (borné par `phoneSchema` avant).
 */
export function formatMomoNumber(digits9: string): string {
  const d = digits9.replace(/\D/g, "").slice(0, 9);
  if (d.length < 4) return digits9;
  return d.replace(/^(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3");
}

/**
 * Texte SMS (FR — marché cible Cameroun ; en dev, l'UI affiche aussi la
 * traduction anglaise de la notification « code envoyé » via i18n, pas le
 * SMS lui-même).
 */
export function buildMomoOtpSmsBody(token: string): string {
  return `Easyjob CM : ${token} est votre code de vérification Mobile Money. Ne le partagez jamais.`;
}

export interface MomoSmsResult {
  /** true si le SMS a réellement été livré (Twilio). */
  delivered: boolean;
  /** twilio = SMS réel livré ; sandbox = code loggé localement (pas de Twilio). */
  channel: "twilio" | "sandbox";
}

/**
 * Envoie le SMS de preuve de possession.
 *
 * - **Twilio** (si `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` +
 *   `TWILIO_MOMO_OTP_SERVICE_SID` sont configurés) : POST REST natif
 *   `api.twilio.com` (Basic auth, `form-urlencoded`) — pas de dépendance
 *   SDK, l'app n'a pas de SDK Twilio.
 * - **Sandbox** (sinon — dev local, preuve E2E) : le code est loggé en
 *   `console.info` (jamais en production : la gate de config Twilio rend
 *   le channel `twilio` obligatoire ; sans config prod, la preuve MoMo
 *   reste indisponible — état documenté au SRS).
 *
 * N'ENVOIE JAMAIS le code dans le log Twilio : le body part tel quel.
 */
export async function sendMomoOtpSms(
  token: string,
  phone9Digits: string,
): Promise<MomoSmsResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const serviceSid = process.env.TWILIO_MOMO_OTP_SERVICE_SID;

  const to = `+237${phone9Digits.replace(/\D/g, "")}`;
  const body = buildMomoOtpSmsBody(token);

  if (sid && authToken && serviceSid) {
    // `From` = Messaging Service (prefixe MG) : on le garantit sans
    // dupliquer le préfixe si l'env est déjà en « MG… ».
    const from = serviceSid.startsWith("MG") ? serviceSid : `MG${serviceSid}`;
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${authToken}`).toString(
            "base64",
          )}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: to,
          From: from,
          Body: body,
        }).toString(),
      },
    );
    if (res.ok) {
      return { delivered: true, channel: "twilio" };
    }
    const detail = await res.text().catch(() => "");
    // Log de debug SANS le code (le corps du SMS est ré-expirable) :
    // on logge le statut + le début de la réponse Twilio.
    console.warn("[momo-otp] Twilio rejected the SMS:", {
      status: res.status,
      detail: detail.slice(0, 300),
    });
    return { delivered: false, channel: "twilio" };
  }

  console.info(
    `[momo-otp SANDBOX] SMS non envoyé (Twilio non configuré). Code de vérification pour ${to} : ${token}`,
  );
  return { delivered: false, channel: "sandbox" };
}
