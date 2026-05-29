import { headers } from "next/headers";

/**
 * Retourne la première IP cliente disponible depuis les headers proxy.
 * Renvoie `null` si aucune ne peut être déterminée.
 */
export async function getClientIp(): Promise<string | null> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    null
  );
}
