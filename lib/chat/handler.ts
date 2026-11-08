import { consumeStream, streamText, type LanguageModel } from "ai";
import { CHAT_LIMITS } from "./config";
import { CHAT_SYSTEM_PROMPT } from "./system-prompt";
import { parseChatBody, readBodyWithLimit } from "./request";
import {
  logServerError,
  logServerWarning,
} from "@/lib/observability/server-log";

/**
 * Traitement de `/api/chat` (F-15), indépendant de Next pour être testé avec
 * un fournisseur simulé. Ordre des contrôles, tous avant l'appel payant :
 *
 *   401 session absente → 403 compte inexistant, non vérifié ou suspendu
 *   → 413 corps trop gros → 400/413 forme, rôles, nombre et longueur des
 *   messages → 503 fournisseur non configuré → 429 quota (réservation
 *   atomique en base) → appel du modèle.
 *
 * Le modèle, les instructions système et le budget de sortie sont fixés ici.
 */

export type ChatAccount = {
  role: string;
  is_active: boolean | null;
  phone_verified: boolean | null;
};

export type ChatQuotaDecision = {
  allowed: boolean;
  reason: string | null;
  retryAfterSeconds: number;
};

export type ChatDeps = {
  getUserId: () => Promise<string | null>;
  readAccount: (userId: string) => Promise<ChatAccount | null>;
  /** Réserve une requête ; doit être atomique entre instances. */
  consumeQuota: (
    userId: string,
    ip: string | null,
  ) => Promise<ChatQuotaDecision>;
  /** `null` : fournisseur non configuré (aucune clé). */
  model: LanguageModel | null;
  /** IP fiable (infrastructure) ou null : jamais un en-tête du client. */
  clientIp: string | null;
  requestId: string | null;
};

const ADMIN_ROLES = new Set(["admin_support", "admin_ops", "admin_founder"]);

/** Compte ouvert (téléphone vérifié, sauf administrateur) et non suspendu. */
export function isChatAccountActive(account: ChatAccount | null): boolean {
  if (!account || account.is_active === false) return false;
  return account.phone_verified === true || ADMIN_ROLES.has(account.role);
}

function refusal(
  status: number,
  code: string,
  error: string,
  headers: Record<string, string> = {},
) {
  return Response.json(
    { error, code },
    { status, headers: { "Cache-Control": "no-store", ...headers } },
  );
}

export async function handleChat(
  req: Request,
  deps: ChatDeps,
): Promise<Response> {
  const { requestId } = deps;

  const userId = await deps.getUserId();
  if (!userId) {
    return refusal(401, "not_authenticated", "Authentication required");
  }

  const account = await deps.readAccount(userId);
  if (!isChatAccountActive(account)) {
    return refusal(403, "account_inactive", "Account not active");
  }

  const raw = await readBodyWithLimit(req);
  if (raw === null) {
    logServerWarning("chat.request", "body_too_large", {
      category: "validation",
      status: 413,
      requestId,
    });
    return refusal(413, "chat_payload_too_large", "Request too large");
  }

  const parsed = parseChatBody(raw);
  if (!parsed.ok) {
    const { status, code, reason } = parsed.refusal;
    logServerWarning("chat.request", reason, {
      category: "validation",
      status,
      requestId,
    });
    return refusal(status, code, reason);
  }

  if (!deps.model) {
    logServerWarning("chat.request", "provider_not_configured", {
      category: "provider",
      status: 503,
      requestId,
    });
    return refusal(503, "chat_unavailable", "Assistant unavailable");
  }

  let quota: ChatQuotaDecision;
  try {
    quota = await deps.consumeQuota(userId, deps.clientIp);
  } catch (error) {
    // Échec du contrôle : refus, jamais d'appel non compté.
    logServerError("chat.quota", error, { requestId });
    return refusal(503, "chat_unavailable", "Assistant unavailable");
  }
  if (!quota.allowed) {
    logServerWarning("chat.quota", `chat_quota_${quota.reason ?? "unknown"}`, {
      category: "quota",
      status: 429,
      requestId,
    });
    return refusal(429, "chat_quota_exceeded", "Too many requests", {
      "Retry-After": String(Math.max(1, quota.retryAfterSeconds)),
    });
  }

  const result = streamText({
    model: deps.model,
    system: CHAT_SYSTEM_PROMPT,
    messages: parsed.messages,
    maxOutputTokens: CHAT_LIMITS.maxOutputTokens,
    // Modèle à raisonnement : sans ce réglage, le budget de sortie peut être
    // consommé par le raisonnement et la réponse rester vide.
    providerOptions: { openai: { reasoningEffort: "minimal" } },
    maxRetries: 0,
    abortSignal: req.signal,
    onError: ({ error }) => {
      logServerError("chat.provider", error, {
        category: "provider",
        requestId,
      });
    },
  });

  return result.toUIMessageStreamResponse({
    consumeSseStream: consumeStream,
    headers: { "Cache-Control": "no-store" },
    // Jamais le message du fournisseur (peut contenir l'URL, la clé masquée
    // ou le contenu de la requête) : un code que l'interface traduit.
    onError: () => "chat_unavailable",
  });
}
