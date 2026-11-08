/**
 * `fetch` vers l'application locale pour les preuves, avec une seule reprise
 * sur connexion keep-alive morte.
 *
 * Cause : `execSql` (supabase db query via spawnSync) bloque la boucle
 * d'événements plusieurs secondes. undici ne peut pas fermer à temps ses
 * connexions inactives, alors que Next les ferme après 5 s. La requête
 * suivante part sur une socket déjà fermée par le serveur, et échoue avant
 * toute réponse : ECONNRESET sous Windows, UND_ERR_SOCKET (« other side
 * closed ») sous Linux (CI).
 *
 * Seules ces erreurs de socket, sans réponse HTTP, sont reprises, une fois.
 * Une réponse HTTP, même 5xx, est toujours rendue telle quelle.
 */
const STALE_SOCKET_CODES = new Set([
  "ECONNRESET",
  "EPIPE",
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
]);

export function isStaleSocketError(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } } | null)?.cause;
  return !!cause?.code && STALE_SOCKET_CODES.has(cause.code);
}

export async function appFetch(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (!isStaleSocketError(error)) throw error;
    return await fetch(input, init);
  }
}
