import { z } from "zod";
import { CHAT_LIMITS } from "@/lib/chat/config";

/**
 * Message saisi dans EasyBot, contrôlé côté client avant envoi. Le serveur
 * applique les mêmes limites et davantage (lib/chat/request.ts).
 */
export const chatUserMessageSchema = z
  .string()
  .trim()
  .min(1)
  .max(CHAT_LIMITS.maxUserMessageChars);
