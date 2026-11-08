/**
 * Destination interne sûre après authentification (audit F-13, lot 8).
 *
 * `next` vient de l'URL de retour OAuth : il est contrôlé par quiconque
 * fabrique le lien. Seul un chemin absolu interne est accepté. Tout le reste
 * (URL absolue, `//hôte`, barre oblique inverse, `@hôte`, caractères de
 * contrôle, variantes encodées de ces formes, chemins d'API ou du callback
 * lui-même) est remplacé par `fallback`.
 */

export const DEFAULT_AFTER_AUTH_PATH = "/";
const MAX_NEXT_LENGTH = 2048;
const BLOCKED_PREFIXES = ["/api/", "/auth/callback", "/_next/"];
const PLACEHOLDER_ORIGIN = "https://easyjob.invalid";

function decodeOnce(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Seule la partie chemin décide de l'hôte : la query string peut contenir
 * des caractères encodés (`?q=a%20b`) sans risque, `URL` les réencode.
 */
function looksExternal(value: string): boolean {
  const pathPart = value.split(/[?#]/, 1)[0];
  return (
    !pathPart.startsWith("/") ||
    pathPart.startsWith("//") ||
    pathPart.includes("\\") ||
    // Contrôles et espaces : les navigateurs les retirent ou les
    // réinterprètent (`/\t/hôte` devient `//hôte`).
    /[\u0000-\u001f\u007f\s]/.test(pathPart)
  );
}

/**
 * @param raw valeur déjà décodée une fois (`URLSearchParams.get`), ou null.
 * @returns chemin + query string internes, ou `fallback`.
 */
export function safeInternalPath(
  raw: string | null | undefined,
  fallback: string = DEFAULT_AFTER_AUTH_PATH,
): string {
  if (!raw || raw.length > MAX_NEXT_LENGTH) return fallback;

  // Chaque niveau de décodage doit rester un chemin interne : une forme
  // encodée (`/%2F%2Fhôte`, `/%5Chôte`, `%2F%2Fhôte`) est refusée même si le
  // navigateur ne la décoderait pas, pour ne dépendre d'aucun intermédiaire.
  let current: string | null = raw;
  for (let i = 0; i < 3 && current !== null; i++) {
    if (looksExternal(current)) return fallback;
    const next = decodeOnce(current);
    if (next === current) break;
    current = next;
  }
  if (current === null) return fallback;

  let url: URL;
  try {
    url = new URL(raw, PLACEHOLDER_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return fallback;

  const path = `${url.pathname}${url.search}`;
  const lowerPath = url.pathname.toLowerCase();
  if (BLOCKED_PREFIXES.some((p) => lowerPath.startsWith(p))) return fallback;
  return path;
}

/** Rôle d'inscription porté par une destination déjà validée. */
export function signupRoleFromPath(
  path: string,
): "candidate" | "company" | null {
  const pathname = new URL(path, PLACEHOLDER_ORIGIN).pathname.replace(
    /\/+$/,
    "",
  );
  if (pathname === "/auth/signup/company") return "company";
  if (pathname === "/auth/signup/candidate") return "candidate";
  return null;
}

/** Paramètre de retour vers une page protégée (`next`, ancien `redirect`). */
export function loginReturnParam(
  params: Pick<URLSearchParams, "get">,
): string | null {
  return params.get("next") ?? params.get("redirect");
}

/**
 * Destination demandée après connexion (lot 9), ou `null` pour appliquer
 * la destination par défaut du rôle. Réutilise `safeInternalPath` : seul un
 * chemin interne est accepté. Les pages d'authentification et l'accueil ne
 * sont pas des destinations de retour (boucle ou retour sans objet).
 */
export function postLoginPath(raw: string | null | undefined): string | null {
  const path = safeInternalPath(raw, "");
  if (!path || path === "/") return null;
  const pathname = path.split("?", 1)[0].toLowerCase();
  if (pathname === "/auth" || pathname.startsWith("/auth/")) return null;
  return path;
}

/** Lien vers la connexion qui ramène ensuite à `path` (chemin interne). */
export function loginHref(path: string): string {
  const safe = postLoginPath(path);
  return safe ? `/auth/login?next=${encodeURIComponent(safe)}` : "/auth/login";
}
