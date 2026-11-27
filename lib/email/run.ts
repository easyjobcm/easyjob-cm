import { createAdminClient } from "@/lib/supabase/server";
import { logServerError } from "@/lib/observability/server-log";
import { readEmailConfig } from "./config";
import {
  dispatchReplacementEmails,
  supabaseOutboxStore,
  transportFor,
  type DispatchSummary,
} from "./dispatcher";

/**
 * Lot 17d-4b — un passage d'envoi avec la configuration du serveur.
 *
 * Clé service (justification) : la file est fermée aux sessions ; seules
 * les fonctions `replacement_email_claim` et `replacement_email_record`
 * (exécutables par la seule clé service) la font avancer. Aucun contrôle de
 * rôle utilisateur n'est en jeu : l'appelant est soit la route interne
 * protégée par un secret, soit le serveur après un désistement enregistré.
 */
export async function runReplacementEmailDispatch(
  limit = 20,
): Promise<DispatchSummary> {
  const config = readEmailConfig();
  const transport = transportFor(config);
  return dispatchReplacementEmails({
    config,
    transport,
    store: supabaseOutboxStore(createAdminClient()),
    limit,
  });
}

/**
 * Réveil après un désistement : tente l'envoi tout de suite, sans jamais
 * peser sur la réponse ni sur le désistement (appelé dans `after()`).
 */
export async function kickReplacementEmails(): Promise<void> {
  const config = readEmailConfig();
  if (!config.ready) return;
  try {
    await runReplacementEmailDispatch(20);
  } catch (error) {
    logServerError("email.outbox.kick", error, { category: "provider" });
  }
}
