"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import {
  accountStateSchema,
  affectsAccount,
  createLatestGuard,
  createSignalBatcher,
  expireLocally,
  matches,
  nextEntitlementDeadline,
  parseSignal,
  topicFor,
  type AccountState,
  type LiveKey,
  type SignalScope,
} from "./signals";

/**
 * Temps réel de l'application (lot 7d) : une connexion par onglet, ouverte
 * pour l'utilisateur connecté et fermée à la déconnexion.
 *
 * - Canal privé `user:<uid>` toujours ouvert ; `admin` pour un admin actif ;
 *   `jobs:public` seulement tant qu'un écran d'offres l'écoute.
 * - Les écrans déclarent ce qu'ils écoutent (`useLiveRefresh`) et relisent
 *   eux-mêmes leurs données autorisées. Les signaux rapprochés sont regroupés.
 * - Reconnexion, retour au premier plan, retour réseau : relecture complète
 *   (« * »), qui récupère aussi les suppressions et retraits d'accès manqués.
 * - Changement de compte : canaux fermés, cache SWR vidé, page rechargée
 *   (aucun état mémoire du compte précédent ne survit).
 * - Échéance d'un plan : minuterie locale sur l'heure du serveur, droit
 *   retiré localement puis relecture de `my_account_state`.
 */

type Listener = { keys: readonly LiveKey[]; cb: () => void };

type RealtimeContextValue = {
  account: AccountState | null;
  /** Décalage horloge serveur − horloge locale (ms). */
  serverOffsetMs: number;
  register: (keys: readonly LiveKey[], cb: () => void) => () => void;
  resync: () => void;
};

const RealtimeContext = React.createContext<RealtimeContextValue | null>(null);

const BATCH_MS = 300;
const pendingRemovals = new Map<string, Promise<unknown>>();
/** Au-delà de cette absence, le retour au premier plan relit tout. */
const RESYNC_AFTER_HIDDEN_MS = 10_000;

/** Hors ligne connu du navigateur : les relectures attendent « online ». */
function offline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function onAuthPage(): boolean {
  return window.location.pathname.startsWith("/auth/");
}

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const supabase = React.useMemo(() => createClient(), []);
  const { mutate } = useSWRConfig();

  const [userId, setUserId] = React.useState<string | null>(null);
  const [account, setAccount] = React.useState<AccountState | null>(null);
  const [serverOffsetMs, setServerOffsetMs] = React.useState(0);
  const [publicWanted, setPublicWanted] = React.useState(false);

  const userIdRef = React.useRef<string | null | undefined>(undefined);
  // Ensemble stable des écrans à l'écoute (lu hors rendu seulement).
  const [listeners] = React.useState(() => new Set<Listener>());
  const publicRefs = React.useRef(0);
  const accountGuard = React.useRef(createLatestGuard());

  const batcher = React.useMemo(
    () =>
      createSignalBatcher(BATCH_MS, (keys) => {
        // Hors ligne : rien n'est relu (une relecture échouerait) ; le
        // retour du réseau relit tout.
        if (offline()) return;
        for (const l of listeners) {
          if (matches(l.keys, keys)) l.cb();
        }
      }),
    [listeners],
  );

  const loadAccount = React.useCallback(async () => {
    const uid = userIdRef.current;
    if (!uid) return;
    const token = accountGuard.current.begin();
    const sentAt = Date.now();
    const { data, error } = await supabase.rpc("my_account_state");
    // Réponse ancienne ou d'un autre compte : ignorée.
    if (!accountGuard.current.isLatest(token) || userIdRef.current !== uid) {
      return;
    }
    if (error) return;
    const parsed = accountStateSchema.safeParse(data);
    if (!parsed.success || parsed.data.user_id !== uid) return;
    const receivedAt = Date.now();
    setServerOffsetMs(
      Date.parse(parsed.data.server_now) - (sentAt + receivedAt) / 2,
    );
    setAccount(parsed.data);
  }, [supabase]);

  // ── Compte connecté et changement de compte ─────────────────────────
  const applyUser = React.useCallback(
    (next: string | null) => {
      const prev = userIdRef.current;
      if (prev === next) return;
      userIdRef.current = next;
      if (typeof prev === "string") {
        // Purge : aucune réponse en vol ni signal en attente du compte
        // précédent ne doit s'afficher.
        accountGuard.current.invalidate();
        batcher.cancel();
        setAccount(null);
        void mutate(() => true, undefined, { revalidate: false });
        if (!onAuthPage()) {
          // Rechargement complet : l'état mémoire des écrans est effacé.
          if (next === null) window.location.replace("/auth/login");
          else window.location.reload();
          return;
        }
      }
      setUserId(next);
    },
    [batcher, mutate],
  );

  React.useEffect(() => {
    let alive = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (alive) applyUser(data.session?.user.id ?? null);
    });
    // Rappel synchrone : pas d'appel Supabase attendu dans ce callback.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      applyUser(session?.user.id ?? null);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase, applyUser]);

  React.useEffect(() => {
    if (!userId) return;
    void loadAccount();
  }, [userId, loadAccount]);

  // ── Réception ────────────────────────────────────────────────────────
  const onSignal = React.useCallback(
    (scope: SignalScope, payload: unknown) => {
      const signal = parseSignal(scope, payload);
      if (!signal) return;
      if (scope === "self" && affectsAccount(signal.key)) void loadAccount();
      batcher.push(signal.key);
    },
    [batcher, loadAccount],
  );

  const join = React.useCallback(
    (scope: SignalScope, uid: string, onJoined: () => void) => {
      const onRefused = () => void loadAccount();
      let channel: RealtimeChannel | null = null;
      let cancelled = false;
      const topic = topicFor(scope, uid);
      // realtime-js réutilise un canal de même nom : attendre la fermeture
      // du précédent avant d'en ouvrir un nouveau.
      void (pendingRemovals.get(topic) ?? Promise.resolve())
        .then(() => supabase.realtime.setAuth())
        .then(() => {
          if (cancelled) return;
          channel = supabase
            .channel(topic, { config: { private: true } })
            .on("broadcast", { event: "sync" }, ({ payload }) =>
              onSignal(scope, payload),
            )
            .subscribe((status, err) => {
              // Ouverture et chaque reconnexion : les événements manqués ne
              // sont pas rejoués, l'écran relit l'état.
              if (status === "SUBSCRIBED") onJoined();
              // Canal refusé (droit retiré) : relire l'état du compte ; si le
              // droit est perdu, l'effet ferme ce canal.
              if (
                status === "CHANNEL_ERROR" &&
                /unauthorized|permission/i.test(err?.message ?? "")
              ) {
                onRefused();
              }
            });
        });
      return () => {
        cancelled = true;
        if (!channel) return;
        const removal = supabase.removeChannel(channel).catch(() => null);
        pendingRemovals.set(topic, removal);
        void removal.then(() => {
          if (pendingRemovals.get(topic) === removal) {
            pendingRemovals.delete(topic);
          }
        });
      };
    },
    [supabase, onSignal, loadAccount],
  );

  React.useEffect(() => {
    if (!userId) return;
    return join("self", userId, () => {
      void loadAccount();
      batcher.push("*");
    });
  }, [userId, join, loadAccount, batcher]);

  const adminActive = !!account?.is_admin && account.is_active;
  React.useEffect(() => {
    if (!userId || !adminActive) return;
    return join("admin", userId, () => batcher.push("*"));
  }, [userId, adminActive, join, batcher]);

  const accountActive = account?.is_active === true;
  React.useEffect(() => {
    if (!userId || !publicWanted || !accountActive) return;
    return join("public", userId, () => batcher.push("public:jobs"));
  }, [userId, publicWanted, accountActive, join, batcher]);

  // Perte du rôle admin : cache admin purgé, sortie de l'espace admin.
  const wasAdmin = React.useRef(false);
  React.useEffect(() => {
    if (!account) return;
    if (wasAdmin.current && !account.is_admin) {
      void mutate(
        (key) => {
          const head = Array.isArray(key) ? key[0] : key;
          return typeof head === "string" && head.startsWith("/api/admin");
        },
        undefined,
        { revalidate: false },
      );
      if (window.location.pathname.startsWith("/admin")) {
        window.location.replace("/");
      }
    }
    wasAdmin.current = account.is_admin;
  }, [account, mutate]);

  // ── Reprise : retour réseau, premier plan, bfcache ──────────────────
  const resync = React.useCallback(() => {
    if (offline()) return;
    void supabase.auth.getSession().then(({ data }) => {
      applyUser(data.session?.user.id ?? null);
      if (data.session) {
        void loadAccount();
        batcher.push("*");
      }
    });
  }, [supabase, applyUser, loadAccount, batcher]);

  React.useEffect(() => {
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else if (hiddenAt && Date.now() - hiddenAt >= RESYNC_AFTER_HIDDEN_MS) {
        hiddenAt = 0;
        resync();
      }
    };
    const onPageShow = (e: PageTransitionEvent) => {
      // Page restaurée depuis le cache arrière : elle peut afficher un état
      // ancien, voire celui d'un autre compte.
      if (e.persisted) window.location.reload();
    };
    window.addEventListener("online", resync);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("online", resync);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [resync]);

  // ── Échéance d'un plan sans écriture SQL ────────────────────────────
  React.useEffect(() => {
    if (!account) return;
    const ms = nextEntitlementDeadline(account, Date.now() + serverOffsetMs);
    if (ms === null) return;
    const handle = window.setTimeout(() => {
      setAccount((a) =>
        a ? expireLocally(a, Date.now() + serverOffsetMs) : a,
      );
      batcher.push("subscription");
      void loadAccount();
    }, ms + 250);
    return () => window.clearTimeout(handle);
  }, [account, serverOffsetMs, batcher, loadAccount]);

  // ── Écrans à l'écoute ───────────────────────────────────────────────
  const register = React.useCallback(
    (keys: readonly LiveKey[], cb: () => void) => {
      const entry: Listener = { keys, cb };
      listeners.add(entry);
      const wantsPublic = keys.includes("public:jobs");
      if (wantsPublic) {
        publicRefs.current += 1;
        setPublicWanted(true);
      }
      return () => {
        listeners.delete(entry);
        if (wantsPublic) {
          publicRefs.current -= 1;
          if (publicRefs.current === 0) setPublicWanted(false);
        }
      };
    },
    [listeners],
  );

  const value = React.useMemo<RealtimeContextValue>(
    () => ({ account, serverOffsetMs, register, resync }),
    [account, serverOffsetMs, register, resync],
  );

  return (
    <RealtimeContext.Provider value={value}>
      {account && !account.is_active && <SuspendedBanner />}
      {children}
    </RealtimeContext.Provider>
  );
}

function SuspendedBanner() {
  const { t } = useI18n();
  return (
    <div
      role="status"
      data-testid="account-suspended-banner"
      className="sticky top-0 z-50 bg-destructive px-4 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] text-center text-sm font-medium text-white"
    >
      <p>{t.realtime.suspendedTitle}</p>
      <p className="text-xs font-normal opacity-90">
        {t.realtime.suspendedBody}
      </p>
    </div>
  );
}

/** État du compte connecté (rôle, suspension, plan effectif), ou null. */
export function useAccountState(): AccountState | null {
  return React.useContext(RealtimeContext)?.account ?? null;
}

/** true seulement si le compte est connu ET suspendu. */
export function useAccountSuspended(): boolean {
  const account = useAccountState();
  return account !== null && !account.is_active;
}

/** Heure du serveur estimée (ms), pour comparer une échéance. */
export function useServerNow(): () => number {
  const offset = React.useContext(RealtimeContext)?.serverOffsetMs ?? 0;
  return React.useCallback(() => Date.now() + offset, [offset]);
}

/**
 * Relit les données de l'écran quand un signal correspondant arrive, après
 * une reconnexion ou au retour au premier plan.
 */
export function useLiveRefresh(
  keys: readonly LiveKey[],
  reload: () => unknown,
  enabled = true,
): void {
  const ctx = React.useContext(RealtimeContext);
  const register = ctx?.register;
  const reloadRef = React.useRef(reload);
  React.useEffect(() => {
    reloadRef.current = reload;
  });
  const keyList = keys.join(",");
  React.useEffect(() => {
    if (!register || !enabled || keyList === "") return;
    return register(keyList.split(",") as LiveKey[], () => {
      void reloadRef.current();
    });
  }, [register, keyList, enabled]);
}

/**
 * Garde « dernière requête » pour un chargement maison : une réponse lente
 * n'écrase pas une relecture plus récente (ni ne réaffiche une donnée
 * retirée entre-temps).
 */
export function useLatestRequest() {
  const [guard] = React.useState(createLatestGuard);
  return guard;
}

/** Variante pour une page rendue côté serveur : `router.refresh()`. */
export function LiveRefresh({ keys }: { keys: readonly LiveKey[] }) {
  const router = useRouter();
  useLiveRefresh(keys, () => router.refresh());
  return null;
}
