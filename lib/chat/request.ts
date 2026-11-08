import { z } from "zod";
import type { ModelMessage } from "ai";
import { CHAT_CLIENT_ROLES, CHAT_LIMITS } from "./config";

/**
 * Lecture et validation du corps de `/api/chat` (F-15). Tout est contrôlé
 * AVANT la réservation du quota et l'appel au fournisseur.
 */

export type ChatRefusal = {
  status: 400 | 413;
  code: "invalid_chat_request" | "chat_payload_too_large";
  /** Détail sûr (jamais le contenu) pour le journal et l'écran. */
  reason: string;
};

const textPartSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

const messageSchema = z.object({
  id: z.string().max(128).optional(),
  role: z.enum(CHAT_CLIENT_ROLES),
  parts: z.array(textPartSchema).min(1).max(8),
});

/** Champs inconnus (`id`, `trigger`, `messageId` de useChat) ignorés. */
export const chatBodySchema = z.object({
  messages: z.array(messageSchema).min(1),
});

export type ChatClientMessage = z.infer<typeof messageSchema>;

/**
 * Lit au plus `maxBytes` octets du corps. Renvoie `null` si la limite est
 * dépassée (Content-Length annoncé ou flux réel), sans lire la suite.
 */
export async function readBodyWithLimit(
  req: Request,
  maxBytes: number = CHAT_LIMITS.maxBodyBytes,
): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!req.body) return "";

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

const textOf = (m: ChatClientMessage) => m.parts.map((p) => p.text).join("");

/**
 * Valide un corps déjà lu et le convertit en messages pour le modèle. Les
 * instructions système ne viennent jamais du client.
 */
export function parseChatBody(
  raw: string,
):
  | { ok: true; messages: ModelMessage[] }
  | { ok: false; refusal: ChatRefusal } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return refuse(400, "invalid_chat_request", "invalid_json");
  }

  const parsed = chatBodySchema.safeParse(json);
  if (!parsed.success) {
    const roleIssue = parsed.error.issues.some((i) => i.path.at(-1) === "role");
    return refuse(
      400,
      "invalid_chat_request",
      roleIssue ? "invalid_role" : "invalid_shape",
    );
  }

  const messages = parsed.data.messages;
  if (messages.length > CHAT_LIMITS.maxMessages) {
    return refuse(413, "chat_payload_too_large", "too_many_messages");
  }

  let total = 0;
  for (const m of messages) {
    const length = textOf(m).length;
    const max =
      m.role === "user"
        ? CHAT_LIMITS.maxUserMessageChars
        : CHAT_LIMITS.maxAssistantMessageChars;
    if (length > max) {
      return refuse(413, "chat_payload_too_large", "message_too_long");
    }
    total += length;
  }
  if (total > CHAT_LIMITS.maxConversationChars) {
    return refuse(413, "chat_payload_too_large", "conversation_too_long");
  }

  const last = messages[messages.length - 1];
  if (last.role !== "user" || textOf(last).trim().length === 0) {
    return refuse(400, "invalid_chat_request", "last_message_not_user");
  }

  return {
    ok: true,
    messages: messages.map(
      (m): ModelMessage =>
        m.role === "user"
          ? { role: "user", content: textOf(m) }
          : { role: "assistant", content: textOf(m) },
    ),
  };
}

function refuse(
  status: ChatRefusal["status"],
  code: ChatRefusal["code"],
  reason: string,
): { ok: false; refusal: ChatRefusal } {
  return { ok: false, refusal: { status, code, reason } };
}
