import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * Utilisateur de la session locale, pour un chargement côté navigateur
 * relancé par un signal ou une reconnexion (lot 7d).
 *
 * `getSession()` lit la session locale, sans appel réseau au serveur
 * d'authentification. Hors ligne, `getUser()` échouerait et l'écran
 * croirait la session absente (redirection vers la connexion, contenu
 * perdu). Les droits restent vérifiés par la base (RLS, RPC) à chaque
 * lecture.
 *
 * @returns l'utilisateur, `null` sans session, `undefined` si la lecture a
 *          échoué (réseau) : l'écran garde alors son état.
 */
export async function readSessionUser(
  supabase: SupabaseClient<Database>,
): Promise<{ id: string } | null | undefined> {
  const { data, error } = await supabase.auth.getSession();
  if (error) return undefined;
  return data.session?.user ?? null;
}

/**
 * Erreur PostgREST due au réseau (aucun code SQL ni HTTP) : la lecture n'a
 * pas eu lieu, l'écran ne doit rien retirer.
 */
export function isNetworkError(
  error: { code?: string | null; message?: string } | null | undefined,
): boolean {
  if (!error) return false;
  return !error.code && /fetch|network/i.test(error.message ?? "");
}
