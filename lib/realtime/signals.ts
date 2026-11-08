import { z } from "zod";

/**
 * Signaux Realtime de l'application (lot 7d). Fonctions pures, sans
 * dépendance au navigateur : testées unitairement.
 *
 * La base émet `{ d: domaine, r: ressource | null }` (migration
 * 20261107150000) sur trois canaux privés :
 *   user:<uid>   domaines du compte connecté ;
 *   admin        domaines des écrans admin (sans identifiant) ;
 *   jobs:public  offres visibles des candidats.
 *
 * Un signal ne sert qu'à demander une relecture autorisée : il n'est jamais
 * affiché ni utilisé pour accorder un droit.
 */

export const DOMAINS = [
  "account",
  "profile",
  "subscription",
  "jobs",
  "applications",
  "missions",
  "contracts",
  "notifications",
] as const;

export type Domain = (typeof DOMAINS)[number];

export type SignalScope = "self" | "admin" | "public";

/**
 * Clé d'écoute d'un écran :
 *   "jobs"        → signal du compte connecté (canal user:<uid>) ;
 *   "admin:jobs"  → signal admin ;
 *   "public:jobs" → offres visibles (abonnement au canal ouvert tant
 *                   qu'un écran l'écoute).
 */
export type LiveKey = Domain | `admin:${Domain}` | "public:jobs";

export const signalPayloadSchema = z.object({
  d: z.enum(DOMAINS),
  r: z.string().uuid().nullable().optional(),
});

export type Signal = { key: LiveKey; resource: string | null };

/** Valide un message reçu ; tout message inattendu est ignoré (null). */
export function parseSignal(scope: SignalScope, raw: unknown): Signal | null {
  const parsed = signalPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { d, r } = parsed.data;
  if (scope === "public") {
    return d === "jobs" ? { key: "public:jobs", resource: r ?? null } : null;
  }
  if (scope === "admin") {
    // Le canal admin ne porte jamais d'identifiant.
    return { key: `admin:${d}`, resource: null };
  }
  return { key: d, resource: r ?? null };
}

export function topicFor(scope: SignalScope, userId: string): string {
  if (scope === "admin") return "admin";
  if (scope === "public") return "jobs:public";
  return `user:${userId}`;
}

/** Les signaux qui modifient l'état du compte (rôle, statut, plan). */
export function affectsAccount(key: LiveKey): boolean {
  return key === "account" || key === "subscription" || key === "profile";
}

/**
 * Regroupe les signaux rapprochés : un seul appel `flush` par fenêtre, avec
 * l'ensemble des clés reçues ("*" = tout relire : reconnexion, retour au
 * premier plan).
 */
export function createSignalBatcher(
  delayMs: number,
  flush: (keys: Set<LiveKey | "*">) => void,
  timers: {
    set: (cb: () => void, ms: number) => unknown;
    clear: (handle: unknown) => void;
  } = {
    set: (cb, ms) => setTimeout(cb, ms),
    clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  },
) {
  let pending = new Set<LiveKey | "*">();
  let handle: unknown = null;
  return {
    push(key: LiveKey | "*") {
      pending.add(key);
      if (handle !== null) return;
      handle = timers.set(() => {
        handle = null;
        const keys = pending;
        pending = new Set();
        flush(keys);
      }, delayMs);
    },
    cancel() {
      if (handle !== null) timers.clear(handle);
      handle = null;
      pending = new Set();
    },
  };
}

/** Un écran écoutant `keys` est-il concerné par ce lot de signaux ? */
export function matches(
  listening: readonly LiveKey[],
  received: Set<LiveKey | "*">,
): boolean {
  if (received.has("*")) return true;
  return listening.some((k) => received.has(k));
}

// ─── État du compte (RPC my_account_state) ──────────────────────────

const isoDate = z.string().nullable();

export const accountStateSchema = z.object({
  user_id: z.string().uuid(),
  role: z.string().nullable(),
  is_active: z.boolean(),
  is_admin: z.boolean(),
  server_now: z.string(),
  company: z
    .object({
      plan: z.string(),
      effective_plan: z.string(),
      expires_at: isoDate,
      trial_ends_at: isoDate,
      verification_status: z.string().nullable(),
      is_active: z.boolean(),
      renews: z.boolean().nullable(),
    })
    .nullable()
    .optional(),
  candidate: z
    .object({
      premium_until: isoDate,
      premium: z.boolean(),
      renews: z.boolean().nullable(),
    })
    .nullable()
    .optional(),
});

export type AccountState = z.infer<typeof accountStateSchema>;

export const ADMIN_ROLES = ["admin_support", "admin_ops", "admin_founder"];

const MAX_TIMER_MS = 2_147_483_647;

/**
 * Prochaine échéance de droits encore future (plan entreprise ou premium
 * candidat), en millisecondes depuis `serverNowMs`. null si aucune.
 */
export function nextEntitlementDeadline(
  state: AccountState | null,
  serverNowMs: number,
): number | null {
  if (!state) return null;
  const candidates: number[] = [];
  const c = state.company;
  if (c && c.effective_plan !== "free" && c.expires_at) {
    candidates.push(Date.parse(c.expires_at));
  }
  const k = state.candidate;
  if (k && k.premium && k.premium_until) {
    candidates.push(Date.parse(k.premium_until));
  }
  const future = candidates
    .filter((t) => Number.isFinite(t))
    .map((t) => t - serverNowMs);
  if (future.length === 0) return null;
  // Déjà atteinte : relire tout de suite.
  return Math.min(Math.max(0, Math.min(...future)), MAX_TIMER_MS);
}

/**
 * État après l'échéance locale, en attendant la relecture autorisée : les
 * droits échus sont retirés, jamais accordés.
 */
export function expireLocally(
  state: AccountState,
  serverNowMs: number,
): AccountState {
  let next = state;
  const c = state.company;
  if (c && c.expires_at && Date.parse(c.expires_at) <= serverNowMs) {
    next = { ...next, company: { ...c, effective_plan: "free" } };
  }
  const k = state.candidate;
  if (k && k.premium_until && Date.parse(k.premium_until) <= serverNowMs) {
    next = { ...next, candidate: { ...k, premium: false } };
  }
  return next;
}

/**
 * Garde contre les réponses anciennes : seule la dernière requête lancée
 * peut écrire l'état (une réponse lente ne réaffiche pas une donnée retirée).
 */
export function createLatestGuard() {
  let seq = 0;
  return {
    begin(): number {
      seq += 1;
      return seq;
    },
    isLatest(token: number): boolean {
      return token === seq;
    },
    invalidate() {
      seq += 1;
    },
  };
}
