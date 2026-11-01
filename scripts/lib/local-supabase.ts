/**
 * Garde-fou des scripts de preuve (`scripts/proof-*.ts`) : ils créent,
 * modifient et suppriment des comptes et des données. Ils ne doivent
 * JAMAIS viser autre chose qu'une pile Supabase locale jetable.
 *
 * - Aucune lecture implicite de `.env.local` (qui vise le projet distant) :
 *   les valeurs viennent uniquement de l'environnement du processus, sous
 *   les noms produits par `supabase status -o env` (API_URL, ANON_KEY,
 *   SERVICE_ROLE_KEY), distincts des variables NEXT_PUBLIC_* de l'app.
 * - Hôte vérifié avec le parseur WHATWG URL (pas de recherche de
 *   sous-chaîne) : `localhost.evil.com`, `localhost@evil.com`… sont refusés.
 * - Aucun contournement pour une cible distante.
 *
 * Procédure : docs/testing/local-proofs.md
 */

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLocalUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  return LOCAL_HOSTNAMES.has(url.hostname);
}

export type LocalProofEnv = {
  supabaseUrl: string;
  anonKey: string;
  serviceKey: string;
  /** App Next.js locale appelée par certaines preuves (NEXT_APP_URL). */
  appUrl: string;
};

export function readLocalProofEnv(
  env: Record<string, string | undefined> = process.env,
): LocalProofEnv {
  const supabaseUrl = env.API_URL ?? "";
  const anonKey = env.ANON_KEY ?? "";
  const serviceKey = env.SERVICE_ROLE_KEY ?? "";
  const appUrl = env.NEXT_APP_URL ?? "http://localhost:3000";

  if (!supabaseUrl || !anonKey || !serviceKey) {
    throw new Error(
      "API_URL / ANON_KEY / SERVICE_ROLE_KEY manquants : voir docs/testing/local-proofs.md.",
    );
  }
  if (!isLocalUrl(supabaseUrl)) {
    throw new Error(
      `Refus : API_URL ne vise pas une pile locale (${safeHost(supabaseUrl)}).`,
    );
  }
  if (!isLocalUrl(appUrl)) {
    throw new Error(
      `Refus : NEXT_APP_URL ne vise pas une app locale (${safeHost(appUrl)}).`,
    );
  }
  return { supabaseUrl, anonKey, serviceKey, appUrl };
}

/**
 * Connexion Postgres directe (DB_URL de `supabase status -o env`), pour les
 * preuves qui passent par `supabase db query`. Toujours la passer en
 * `--db-url` : `--local` vise la pile du répertoire courant (celle de
 * développement), pas la pile dédiée aux preuves.
 */
export function readLocalDbUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = env.DB_URL ?? "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DB_URL manquant : voir docs/testing/local-proofs.md.");
  }
  const isPostgres =
    url.protocol === "postgresql:" || url.protocol === "postgres:";
  if (!isPostgres || !LOCAL_HOSTNAMES.has(url.hostname)) {
    throw new Error(
      `Refus : DB_URL ne vise pas une base locale (${url.hostname || "hôte invalide"}).`,
    );
  }
  // Le Postgres local n'offre pas TLS ; la CLI l'exige par défaut en --db-url.
  url.searchParams.set("sslmode", "disable");
  return url.toString();
}

/** Hôte seul pour le message d'erreur (jamais la chaîne complète). */
function safeHost(raw: string): string {
  try {
    return new URL(raw).host;
  } catch {
    return "URL invalide";
  }
}
