/**
 * Identification de la base Supabase visée par une URL, sans jamais lire ni
 * afficher de clé. Utilisé par `pnpm env:target` et `pnpm bootstrap:local`.
 *
 * Ports : `supabase/config.toml` (développement, 54321) et
 * `scripts/init-proof-stack.ts` (preuves, 54421).
 */
import { isLocalUrl } from "./local-supabase";

export type SupabaseTarget =
  | { kind: "missing" }
  | { kind: "placeholder" }
  | { kind: "invalid" }
  | { kind: "dev"; url: string }
  | { kind: "proof"; url: string }
  | { kind: "local"; url: string }
  | { kind: "remote"; url: string; projectRef: string | null };

export const DEV_API_PORT = "54321";
export const PROOF_API_PORT = "54421";

export function classifySupabaseUrl(raw: string | undefined): SupabaseTarget {
  if (!raw) return { kind: "missing" };
  if (raw.includes("YOUR_PROJECT_REF")) return { kind: "placeholder" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: "invalid" };
  }
  const origin = url.origin;
  if (isLocalUrl(raw)) {
    if (url.port === DEV_API_PORT) return { kind: "dev", url: origin };
    if (url.port === PROOF_API_PORT) return { kind: "proof", url: origin };
    return { kind: "local", url: origin };
  }
  const ref = url.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/)?.[1];
  return { kind: "remote", url: origin, projectRef: ref ?? null };
}

export function describeTarget(target: SupabaseTarget): string {
  switch (target.kind) {
    case "missing":
      return "non définie";
    case "placeholder":
      return "valeur d'exemple de .env.example (à remplacer)";
    case "invalid":
      return "URL invalide";
    case "dev":
      return `pile de développement locale « easyjob-cm » (${target.url})`;
    case "proof":
      return `pile de preuve « easyjob-proof » (${target.url}) : réservée à pnpm test:rls, ses données sont effacées`;
    case "local":
      return `pile locale sur un autre port (${target.url})`;
    case "remote":
      return `PROJET DISTANT ${target.projectRef ?? target.url} : données réelles`;
  }
}
