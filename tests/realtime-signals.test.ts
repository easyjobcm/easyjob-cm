import { describe, expect, it } from "vitest";
import {
  accountStateSchema,
  createLatestGuard,
  createSignalBatcher,
  expireLocally,
  matches,
  nextEntitlementDeadline,
  parseSignal,
  topicFor,
  type AccountState,
  type LiveKey,
} from "@/lib/realtime/signals";
import { isCandidatePremiumActive } from "@/lib/utils/company-plan";

const UID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const RES = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("parseSignal", () => {
  it("garde le domaine et la ressource du canal personnel", () => {
    expect(parseSignal("self", { d: "contracts", r: RES, id: "x" })).toEqual({
      key: "contracts",
      resource: RES,
    });
  });

  it("retire tout identifiant du canal admin", () => {
    expect(parseSignal("admin", { d: "jobs", r: RES })).toEqual({
      key: "admin:jobs",
      resource: null,
    });
  });

  it("n'accepte que les offres sur le canal public", () => {
    expect(parseSignal("public", { d: "jobs", r: RES })?.key).toBe(
      "public:jobs",
    );
    expect(parseSignal("public", { d: "account", r: null })).toBeNull();
  });

  it("ignore un message inattendu", () => {
    expect(parseSignal("self", { d: "grant_admin" })).toBeNull();
    expect(parseSignal("self", { d: "jobs", r: "pas-un-uuid" })).toBeNull();
    expect(parseSignal("self", null)).toBeNull();
    expect(parseSignal("self", "account")).toBeNull();
  });
});

describe("topicFor", () => {
  it("nomme les trois canaux privés", () => {
    expect(topicFor("self", UID)).toBe(`user:${UID}`);
    expect(topicFor("admin", UID)).toBe("admin");
    expect(topicFor("public", UID)).toBe("jobs:public");
  });
});

describe("createSignalBatcher", () => {
  function fakeTimers() {
    let pending: (() => void) | null = null;
    return {
      timers: {
        set: (cb: () => void) => {
          pending = cb;
          return 1;
        },
        clear: () => {
          pending = null;
        },
      },
      fire: () => {
        const cb = pending;
        pending = null;
        cb?.();
      },
    };
  }

  it("regroupe les signaux rapprochés en un seul appel", () => {
    const calls: Set<LiveKey | "*">[] = [];
    const t = fakeTimers();
    const b = createSignalBatcher(300, (k) => calls.push(k), t.timers);
    b.push("applications");
    b.push("missions");
    b.push("applications");
    t.fire();
    expect(calls).toHaveLength(1);
    expect([...calls[0]].sort()).toEqual(["applications", "missions"]);
  });

  it("n'émet plus rien après annulation (changement de compte)", () => {
    const calls: unknown[] = [];
    const t = fakeTimers();
    const b = createSignalBatcher(300, (k) => calls.push(k), t.timers);
    b.push("contracts");
    b.cancel();
    t.fire();
    expect(calls).toHaveLength(0);
  });
});

describe("matches", () => {
  it("« * » concerne tous les écrans", () => {
    expect(matches(["jobs"], new Set(["*"]))).toBe(true);
  });
  it("ne mélange pas canal personnel et canal admin", () => {
    expect(matches(["jobs"], new Set<LiveKey>(["admin:jobs"]))).toBe(false);
    expect(matches(["admin:jobs"], new Set<LiveKey>(["admin:jobs"]))).toBe(
      true,
    );
  });
});

const base: AccountState = {
  user_id: UID,
  role: "company",
  is_active: true,
  is_admin: false,
  server_now: "2026-11-07T10:00:00.000Z",
  company: {
    plan: "pro",
    effective_plan: "pro",
    expires_at: "2026-11-07T10:00:30.000Z",
    trial_ends_at: null,
    verification_status: "verified",
    is_active: true,
    renews: false,
  },
  candidate: null,
};
const NOW = Date.parse("2026-11-07T10:00:00.000Z");

describe("échéance d'un plan", () => {
  it("programme la minuterie sur l'heure du serveur", () => {
    expect(nextEntitlementDeadline(base, NOW)).toBe(30_000);
  });

  it("relit tout de suite une échéance déjà passée", () => {
    expect(nextEntitlementDeadline(base, NOW + 60_000)).toBe(0);
  });

  it("n'a pas d'échéance sans date ou une fois le plan gratuit", () => {
    expect(
      nextEntitlementDeadline(
        { ...base, company: { ...base.company!, expires_at: null } },
        NOW,
      ),
    ).toBeNull();
    expect(
      nextEntitlementDeadline(
        { ...base, company: { ...base.company!, effective_plan: "free" } },
        NOW,
      ),
    ).toBeNull();
  });

  it("retire le droit à l'échéance sans jamais en accorder", () => {
    expect(expireLocally(base, NOW).company?.effective_plan).toBe("pro");
    expect(expireLocally(base, NOW + 30_000).company?.effective_plan).toBe(
      "free",
    );
    const expired = {
      ...base,
      company: { ...base.company!, effective_plan: "free" },
    };
    expect(expireLocally(expired, NOW).company?.effective_plan).toBe("free");
  });

  it("prend la plus proche des échéances entreprise et candidat", () => {
    const both: AccountState = {
      ...base,
      candidate: {
        premium: true,
        premium_until: "2026-11-07T10:00:10.000Z",
        renews: true,
      },
    };
    expect(nextEntitlementDeadline(both, NOW)).toBe(10_000);
    expect(expireLocally(both, NOW + 10_000).candidate?.premium).toBe(false);
  });

  it("valide la réponse de my_account_state", () => {
    expect(accountStateSchema.safeParse(base).success).toBe(true);
    expect(
      accountStateSchema.safeParse({ ...base, is_active: "yes" }).success,
    ).toBe(false);
  });
});

describe("isCandidatePremiumActive", () => {
  it("exige le rôle premium et une échéance future", () => {
    const future = "2026-11-08T00:00:00.000Z";
    expect(isCandidatePremiumActive("candidate_premium", future, NOW)).toBe(
      true,
    );
    expect(isCandidatePremiumActive("candidate", future, NOW)).toBe(false);
    expect(isCandidatePremiumActive("candidate_premium", null, NOW)).toBe(
      false,
    );
    expect(
      isCandidatePremiumActive(
        "candidate_premium",
        "2026-11-07T09:00:00.000Z",
        NOW,
      ),
    ).toBe(false);
  });
});

describe("createLatestGuard", () => {
  it("ignore une réponse plus ancienne que la dernière lecture", () => {
    const g = createLatestGuard();
    const first = g.begin();
    const second = g.begin();
    expect(g.isLatest(first)).toBe(false);
    expect(g.isLatest(second)).toBe(true);
    g.invalidate();
    expect(g.isLatest(second)).toBe(false);
  });
});
