/**
 * Content-Security-Policy, première étape : `Report-Only` (audit F-25).
 *
 * Le navigateur n'applique rien : il signale à `/api/csp-report` ce que la
 * politique bloquerait. Après observation des rapports, la même politique
 * passera en `Content-Security-Policy` (procédure : docs/deployment/production.md).
 *
 * Origines inventoriées au lot 10 (code du dépôt, parcours connexion,
 * images et Realtime) :
 *  - l'application elle-même (`'self'`) : pages, `/api/*`, polices
 *    `next/font` auto-hébergées, icônes de `public/` ;
 *  - Supabase (`NEXT_PUBLIC_SUPABASE_URL`) : REST, Auth, Storage (URL
 *    signées des photos et des PDF affichés en `<iframe>`), Realtime en
 *    WebSocket (`wss:` ou `ws:` en local) ;
 *  - `https://nominatim.openstreetmap.org` : quartier déduit de la position
 *    (onboarding et édition du profil candidat) ;
 *  - `blob:` : aperçu local de la photo de profil avant envoi ; `data:` :
 *    images en ligne éventuelles.
 * La connexion Google est une navigation (`signInWithOAuth`), pas une
 * requête : elle n'est pas soumise à la CSP.
 *
 * `'unsafe-inline'` reste nécessaire pour les scripts : Next.js insère des
 * scripts en ligne sans nonce tant que les pages ne sont pas rendues avec un
 * nonce (étape ultérieure). `'unsafe-eval'` n'est ajouté qu'en développement.
 */

export const CSP_REPORT_PATH = "/api/csp-report";
export const NOMINATIM_ORIGIN = "https://nominatim.openstreetmap.org";

export type CspOptions = {
  /** `NEXT_PUBLIC_SUPABASE_URL` ; ignorée si absente ou invalide. */
  supabaseUrl?: string | null;
  /** `next dev` : React a besoin d'`eval` pour le rechargement à chaud. */
  dev?: boolean;
};

/** Origine HTTP de Supabase et son équivalent WebSocket pour Realtime. */
export function supabaseOrigins(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return [];
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return [];
  const ws = url.protocol === "https:" ? "wss:" : "ws:";
  return [url.origin, `${ws}//${url.host}`];
}

export function buildContentSecurityPolicy(options: CspOptions = {}): string {
  const [supabaseHttp, supabaseWs] = supabaseOrigins(options.supabaseUrl);
  const supabase = supabaseHttp ? [supabaseHttp] : [];
  const realtime = supabaseWs ? [supabaseWs] : [];

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      ...(options.dev ? ["'unsafe-eval'"] : []),
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", ...supabase],
    "font-src": ["'self'"],
    "connect-src": ["'self'", ...supabase, ...realtime, NOMINATIM_ORIGIN],
    "frame-src": supabase.length > 0 ? supabase : ["'none'"],
    "worker-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "report-uri": [CSP_REPORT_PATH],
  };

  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}
