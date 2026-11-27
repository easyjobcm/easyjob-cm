/**
 * Lot 17d-4b — configuration des e-mails du recrutement de remplacement
 * (ANN-21, `[UV]` 2026-11-26). Lue côté serveur uniquement : aucune de ces
 * variables n'est préfixée `NEXT_PUBLIC_`, et ce module n'est importé que
 * par des routes et des modules serveur.
 *
 * Modes (`EMAIL_TRANSPORT`) :
 *   - `disabled` (défaut) : rien n'est revendiqué ni envoyé ; les intentions
 *     restent en file ;
 *   - `fake` : fournisseur simulé en mémoire, sans réseau (poste local,
 *     preuves) ; refusé sur tout environnement Vercel ;
 *   - `resend` : envoi réel, refusé tant que la configuration n'est pas
 *     complète, et toujours refusé sur une preview Vercel ou hors
 *     production sans liste d'autorisation d'essai.
 *
 * La fonction n'est annoncée comme opérationnelle que si l'envoi réel est
 * prêt **et** marqué vérifié (`EMAIL_DELIVERY_VERIFIED=true`, posé à la main
 * après l'essai limité).
 */

export const EMAIL_SENDING_DOMAIN = "easyjobcm.com";

export type EmailMode = "disabled" | "fake" | "resend";

export type EmailConfig = {
  mode: EmailMode;
  /** Envoi permis avec ce mode (configuration complète, environnement admis). */
  ready: boolean;
  /** Fonction annoncée aux candidats comme opérationnelle. */
  deliveryActive: boolean;
  /** Raisons pour lesquelles l'envoi n'est pas prêt (noms de variables, jamais de valeur). */
  problems: string[];
  from: string | null;
  replyTo: string | null;
  apiKey: string | null;
  webhookSecret: string | null;
  dispatchSecret: string | null;
  appUrl: string | null;
  /** Essai limité : seules ces adresses peuvent recevoir un envoi réel. */
  allowlist: string[] | null;
};

type Env = Record<string, string | undefined>;

const ADDRESS = /^[^\s@<>]+@([a-z0-9-]+\.)+[a-z]{2,}$/i;

/** Adresse nue d'un champ « Nom <adresse> » ou « adresse ». */
export function bareAddress(value: string): string | null {
  const m = /^\s*(?:[^<>]*<\s*([^<>\s]+)\s*>|([^<>\s]+))\s*$/.exec(value);
  const addr = (m?.[1] ?? m?.[2] ?? "").toLowerCase();
  return ADDRESS.test(addr) ? addr : null;
}

/** Adresse du domaine d'envoi validé (domaine ou sous-domaine). */
export function onSendingDomain(address: string): boolean {
  const domain = address.split("@")[1] ?? "";
  return (
    domain === EMAIL_SENDING_DOMAIN ||
    domain.endsWith(`.${EMAIL_SENDING_DOMAIN}`)
  );
}

function clean(v: string | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

export function readEmailConfig(env: Env = process.env): EmailConfig {
  const raw = (clean(env.EMAIL_TRANSPORT) ?? "disabled").toLowerCase();
  const problems: string[] = [];
  const mode: EmailMode = raw === "fake" || raw === "resend" ? raw : "disabled";
  if (raw !== mode) problems.push("EMAIL_TRANSPORT");

  const from = clean(env.EMAIL_FROM);
  const replyTo = clean(env.EMAIL_REPLY_TO);
  const apiKey = clean(env.RESEND_API_KEY);
  const webhookSecret = clean(env.RESEND_WEBHOOK_SECRET);
  const dispatchSecret = clean(env.EMAIL_DISPATCH_SECRET);
  const appUrl = clean(env.NEXT_PUBLIC_APP_URL);
  const allowRaw = clean(env.EMAIL_RECIPIENT_ALLOWLIST);
  const allowlist = allowRaw
    ? allowRaw
        .split(",")
        .map((a) => bareAddress(a))
        .filter((a): a is string => a !== null)
    : null;
  const vercelEnv = clean(env.VERCEL_ENV);

  if (mode === "resend") {
    const fromAddr = from ? bareAddress(from) : null;
    if (!fromAddr || !onSendingDomain(fromAddr)) problems.push("EMAIL_FROM");
    // Adresse de réponse : obligatoire, jamais devinée. Expéditeur retenu :
    // noreply@easyjobcm.com (adresse non relevée) ; la boîte de réponse
    // prévue n'existe pas encore (2026-11-26) : tant qu'elle n'est pas
    // créée et testée, la variable reste vide et l'envoi réel refusé. Une
    // réponse vers l'expéditeur ou vers une adresse « noreply » est refusée.
    const replyAddr = replyTo ? bareAddress(replyTo) : null;
    if (
      !replyAddr ||
      replyAddr === fromAddr ||
      /^no-?reply([+._-]|@)/i.test(replyAddr)
    )
      problems.push("EMAIL_REPLY_TO");
    if (!apiKey) problems.push("RESEND_API_KEY");
    if (!webhookSecret) problems.push("RESEND_WEBHOOK_SECRET");
    if (!appUrl || !/^https:\/\//.test(appUrl))
      problems.push("NEXT_PUBLIC_APP_URL");
    // Aucun envoi externe depuis une preview ; hors production, seulement
    // vers une liste d'autorisation explicite (essai limité).
    if (vercelEnv === "preview" || vercelEnv === "development")
      problems.push("VERCEL_ENV");
    else if (vercelEnv !== "production" && !(allowlist && allowlist.length))
      problems.push("EMAIL_RECIPIENT_ALLOWLIST");
  }
  // Fournisseur simulé : poste local et preuves seulement. Sur Vercel, il
  // marquerait comme acceptées des intentions réelles si la base visée est
  // celle de la production (docs/deployment/production.md, §8).
  if (mode === "fake" && vercelEnv) problems.push("VERCEL_ENV");
  if (mode !== "disabled" && !appUrl) problems.push("NEXT_PUBLIC_APP_URL");

  const ready = mode !== "disabled" && problems.length === 0;
  const deliveryActive =
    ready &&
    mode === "resend" &&
    clean(env.EMAIL_DELIVERY_VERIFIED) === "true" &&
    !(allowlist && allowlist.length);

  return {
    mode,
    ready,
    deliveryActive,
    problems,
    from,
    replyTo,
    apiKey,
    webhookSecret,
    dispatchSecret,
    appUrl,
    allowlist,
  };
}
