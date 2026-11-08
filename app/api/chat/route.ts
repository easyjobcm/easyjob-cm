import { createGateway } from "ai";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { observedClientIp } from "@/lib/utils/observed-ip";
import { requestIdFrom } from "@/lib/observability/server-log";
import { handleChat } from "@/lib/chat/handler";
import { CHAT_LIMITS, CHAT_MODEL } from "@/lib/chat/config";

// Durée maximale de la fonction (s). Littéral exigé par Next.
export const maxDuration = 30;

/**
 * Fournisseur : passerelle Vercel AI. Clé `AI_GATEWAY_API_KEY`, ou jeton
 * OIDC du projet sur Vercel. `EASYBOT_GATEWAY_URL` (facultatif) remplace
 * l'URL de la passerelle, pour un fournisseur simulé en test local
 * (docs/chatbot.md). Sans clé hors Vercel : 503, aucun appel.
 */
function chatModel() {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey && process.env.VERCEL !== "1") return null;
  const gateway = createGateway({
    apiKey: apiKey || undefined,
    baseURL: process.env.EASYBOT_GATEWAY_URL || undefined,
  });
  return gateway(CHAT_MODEL);
}

export async function POST(req: Request) {
  const supabase = await createClient();

  return handleChat(req, {
    getUserId: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return user?.id ?? null;
    },
    readAccount: async (userId) => {
      const { data } = await supabase
        .from("users")
        .select("role, is_active, phone_verified")
        .eq("id", userId)
        .maybeSingle();
      return data;
    },
    consumeQuota: async (userId, ip) => {
      const { data, error } = await createAdminClient().rpc(
        "consume_chat_quota",
        {
          p_user_id: userId,
          p_user_per_hour: CHAT_LIMITS.userPerHour,
          p_user_per_day: CHAT_LIMITS.userPerDay,
          p_ip_per_hour: CHAT_LIMITS.ipPerHour,
          ...(ip ? { p_ip: ip } : {}),
        },
      );
      if (error) throw error;
      const row = data[0];
      if (!row) throw new Error("consume_chat_quota returned no row");
      return {
        allowed: row.allowed,
        reason: row.reason,
        retryAfterSeconds: row.retry_after_seconds,
      };
    },
    model: chatModel(),
    clientIp: observedClientIp(req.headers),
    requestId: requestIdFrom(req.headers),
  });
}
