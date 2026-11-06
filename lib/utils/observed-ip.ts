import { isIP } from "node:net";

/**
 * Adresse IP du client telle qu'observée par l'infrastructure d'EasyJob
 * (preuve de signature d'un contrat, lot 7b).
 *
 * Seul Vercel fournit une source fiable : il écrase `x-forwarded-for` et
 * pose `x-vercel-forwarded-for`, qu'un proxy placé devant ne peut pas
 * réécrire (https://vercel.com/docs/headers/request-headers). Ailleurs
 * (`next start` local, autre hébergeur), ces en-têtes viennent du client et
 * peuvent être forgés : la fonction renvoie `null` plutôt qu'une valeur
 * invérifiable. Une valeur qui n'est pas une adresse IP renvoie aussi `null`.
 *
 * Ne pas utiliser pour un quota anti-abus, qui tolère une valeur approchée
 * (`getClientIp`).
 */
export function observedClientIp(
  headers: Headers,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (env.VERCEL !== "1") return null;
  const raw =
    headers.get("x-vercel-forwarded-for") ?? headers.get("x-forwarded-for");
  const first = raw?.split(",")[0]?.trim();
  return first && isIP(first) !== 0 ? first : null;
}
