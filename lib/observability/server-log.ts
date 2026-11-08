/**
 * Journal d'erreurs serveur (audit F-23, lot 8).
 *
 * Une ligne JSON par événement sur la sortie d'erreur, lisible et filtrable
 * dans les journaux Vercel (champ `op`, `category`, `requestId`), sans
 * dépendance ni service tiers.
 *
 * Règle de confidentialité : seuls des champs SÛRS sont écrits.
 *  - `code` : SQLSTATE Postgres (`23505`), code PostgREST (`PGRST116`) ou code
 *    d'erreur Supabase Auth (`otp_expired`), filtré par expression régulière ;
 *  - `reason` : message d'erreur UNIQUEMENT s'il a la forme d'un code métier
 *    (`account_suspended`), comme ceux levés par les RPC ;
 *  - `status` : statut HTTP numérique.
 * Jamais : message libre, `details`, `hint`, paramètres, corps de requête,
 * téléphone, email, code OTP ou de fin de mission, jeton, clé, URL signée,
 * contenu de conversation. Un message Postgres libre peut contenir des
 * valeurs (`Key (phone)=(+237…) already exists`) : il n'est pas écrit.
 */

export type ErrorCategory =
  | "database" // PostgREST / Postgres
  | "auth" // Supabase Auth (GoTrue)
  | "provider" // fournisseur externe (LLM, SMS, paiement)
  | "validation"
  | "quota"
  | "unexpected";

export type LogContext = {
  requestId?: string | null;
  category?: ErrorCategory;
  status?: number;
  /** Code applicatif sûr choisi par l'appelant (`chat_quota_user_hourly`). */
  reason?: string;
};

const SAFE_CODE = /^[A-Za-z0-9_.-]{1,64}$/;
const BUSINESS_CODE = /^[a-z][a-z0-9_]{2,63}$/;
const SAFE_REQUEST_ID = /^[A-Za-z0-9:._-]{1,128}$/;

type ErrorLike = {
  code?: unknown;
  status?: unknown;
  message?: unknown;
  name?: unknown;
  __isAuthError?: unknown;
};

function asErrorLike(error: unknown): ErrorLike {
  return error !== null && typeof error === "object"
    ? (error as ErrorLike)
    : {};
}

function safeString(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}

/** Catégorie déduite de la forme de l'erreur, si l'appelant n'en donne pas. */
export function categorizeError(error: unknown): ErrorCategory {
  const e = asErrorLike(error);
  if (e.__isAuthError === true) return "auth";
  const name = typeof e.name === "string" ? e.name : "";
  if (name.startsWith("Auth")) return "auth";
  if (name.startsWith("AI_") || name.startsWith("Gateway")) return "provider";
  if (typeof e.code === "string" && /^(PGRST|[0-9A-Z]{5}$)/.test(e.code)) {
    return "database";
  }
  return "unexpected";
}

/** Champs sûrs extraits d'une erreur quelconque (exportée pour les tests). */
export function safeErrorFields(error: unknown): {
  code?: string;
  reason?: string;
  status?: number;
  errorName?: string;
} {
  const e = asErrorLike(error);
  const status =
    typeof e.status === "number" && Number.isInteger(e.status)
      ? e.status
      : undefined;
  return {
    code: safeString(e.code, SAFE_CODE),
    reason: safeString(e.message, BUSINESS_CODE),
    status,
    errorName: safeString(e.name, SAFE_CODE),
  };
}

/**
 * Identifiant de requête pour corréler une réponse et une ligne de journal :
 * `x-vercel-id` sur Vercel, sinon `x-request-id` s'il est présent.
 */
export function requestIdFrom(
  headers: Pick<Headers, "get"> | null | undefined,
): string | null {
  if (!headers) return null;
  const raw = headers.get("x-vercel-id") ?? headers.get("x-request-id");
  return safeString(raw, SAFE_REQUEST_ID) ?? null;
}

function write(
  level: "error" | "warn",
  op: string,
  fields: Record<string, unknown>,
) {
  const line = JSON.stringify({ level, op, ...fields });
  if (level === "error") console.error(line);
  else console.warn(line);
}

/**
 * Journalise un échec serveur avec son contexte de diagnostic, sans aucune
 * donnée sensible. `op` est un identifiant stable (`jobs.list`,
 * `auth.verify_phone`).
 */
export function logServerError(
  op: string,
  error: unknown,
  ctx: LogContext = {},
): void {
  const fields = safeErrorFields(error);
  write("error", op, {
    category: ctx.category ?? categorizeError(error),
    code: fields.code,
    reason: ctx.reason ?? fields.reason,
    status: ctx.status ?? fields.status,
    errorName: fields.errorName,
    requestId: ctx.requestId ?? undefined,
  });
}

/** Événement attendu mais à surveiller (quota atteint, refus anormal). */
export function logServerWarning(
  op: string,
  reason: string,
  ctx: Omit<LogContext, "reason"> = {},
): void {
  write("warn", op, {
    category: ctx.category,
    reason: safeString(reason, BUSINESS_CODE),
    status: ctx.status,
    requestId: ctx.requestId ?? undefined,
  });
}
