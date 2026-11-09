import { z } from "zod";

/**
 * Réputation EasyJob (lot 9c) : lecture privée (RPC `my_reputation`) et
 * calcul de la progression affichée au titulaire. Fonctions pures, testées.
 *
 * Paliers (migration 20261109120000) : chaque catégorie avance par
 * demi-étoile ; expérience et avis par tranches de 5 unités ; profil à 50 %
 * puis 100 % ; compétences à 1 puis 2 compétences vérifiées.
 */

const halfStar = z.coerce.number().min(0).max(5);

export const reputationChangeSchema = z.object({
  id: z.string().uuid(),
  from: halfStar,
  to: halfStar,
  direction: z.enum(["gain", "loss"]),
  cause: z.string(),
  details: z
    .object({
      reasons: z.array(z.string()).optional(),
      documents: z
        .array(
          z.object({
            type: z.string().optional(),
            title: z.string().nullable().optional(),
          }),
        )
        .optional(),
      href: z.string().optional(),
    })
    .passthrough()
    .default({}),
  created_at: z.string(),
});

export type ReputationChange = z.infer<typeof reputationChangeSchema>;

export const myReputationSchema = z.object({
  subject_type: z.enum(["candidate", "company"]),
  stars: halfStar,
  server_now: z.string(),
  profile: z.object({ pct: z.number(), stars: halfStar }),
  experience: z.object({
    units: z.number(),
    cap: z.number(),
    stars: halfStar,
    confirmed: z.number(),
    breaches: z.number(),
  }),
  reviews: z.object({ units: z.number(), cap: z.number(), stars: halfStar }),
  skills: z.object({ count: z.number(), stars: halfStar }).nullable(),
  next_expiry_at: z.string().nullable(),
  pending_changes: z.array(reputationChangeSchema),
});

export type MyReputation = z.infer<typeof myReputationSchema>;

export type CategoryKey = "experience" | "reviews" | "profile" | "skills";

export type CategoryAction =
  | { kind: "missions" | "offers" | "reviews"; count: number }
  | { kind: "profile"; target: 50 | 100 }
  | { kind: "skills"; count: number };

export type CategoryProgress = {
  key: CategoryKey;
  stars: number;
  max: number;
  /** Avancement vers la prochaine demi-étoile de la catégorie (0 à 1). */
  progress: number;
  action: CategoryAction | null;
};

export type ReputationProgress = {
  stars: number;
  /** Prochain palier global (demi-étoile suivante), null à 5. */
  nextTier: number | null;
  categories: CategoryProgress[];
  /** Action mise en avant vers le prochain palier (catégorie la plus avancée). */
  primary: CategoryProgress | null;
};

const STEP = 5;

function unitProgress(
  units: number,
  cap: number,
): { progress: number; remaining: number | null } {
  if (units >= cap) return { progress: 1, remaining: null };
  const next = (Math.floor(units / STEP) + 1) * STEP;
  return { progress: (units % STEP) / STEP, remaining: next - units };
}

/** Effort relatif d'une action, pour choisir l'action principale. */
function effort(action: CategoryAction): number {
  if (action.kind === "profile") return 1;
  return action.count;
}

export function computeProgress(rep: MyReputation): ReputationProgress {
  const categories: CategoryProgress[] = [];

  const exp = unitProgress(rep.experience.units, rep.experience.cap);
  categories.push({
    key: "experience",
    stars: rep.experience.stars,
    max: 2,
    progress: exp.progress,
    action:
      exp.remaining === null
        ? null
        : {
            kind: rep.subject_type === "candidate" ? "missions" : "offers",
            count: exp.remaining,
          },
  });

  const rev = unitProgress(rep.reviews.units, rep.reviews.cap);
  categories.push({
    key: "reviews",
    stars: rep.reviews.stars,
    max: rep.reviews.cap / (STEP * 2),
    progress: rev.progress,
    action:
      rev.remaining === null ? null : { kind: "reviews", count: rev.remaining },
  });

  const pct = Math.max(0, Math.min(100, rep.profile.pct));
  categories.push({
    key: "profile",
    stars: rep.profile.stars,
    max: 1,
    progress: pct >= 100 ? 1 : pct >= 50 ? (pct - 50) / 50 : pct / 50,
    action:
      pct >= 100 ? null : { kind: "profile", target: pct >= 50 ? 100 : 50 },
  });

  if (rep.skills) {
    const count = Math.max(0, rep.skills.count);
    categories.push({
      key: "skills",
      stars: rep.skills.stars,
      max: 1,
      progress: count >= 2 ? 1 : 0,
      action: count >= 2 ? null : { kind: "skills", count: 1 },
    });
  }

  // Catégorie la plus avancée vers sa prochaine demi-étoile ; à égalité,
  // l'action la plus courte, puis l'ordre d'affichage.
  let primary: CategoryProgress | null = null;
  for (const c of categories) {
    if (!c.action) continue;
    if (
      !primary ||
      c.progress > primary.progress ||
      (c.progress === primary.progress &&
        effort(c.action) < effort(primary.action!))
    ) {
      primary = c;
    }
  }

  return {
    stars: rep.stars,
    nextTier: rep.stars >= 5 ? null : Math.min(5, rep.stars + 0.5),
    categories,
    primary,
  };
}

/** « 3,5 » / « 3.5 » ; « 3 » sans décimale. */
export function formatStarsNumber(value: number, locale: "fr" | "en"): string {
  return new Intl.NumberFormat(locale === "en" ? "en" : "fr", {
    maximumFractionDigits: 1,
  }).format(value);
}

/** « 1,5 étoile », « 3 étoiles », « 1 star », « 3.5 stars ». */
export function formatStars(
  value: number,
  locale: "fr" | "en",
  forms: { one: string; other: string },
): string {
  const rule = new Intl.PluralRules(locale === "en" ? "en" : "fr").select(
    value,
  );
  return (rule === "one" ? forms.one : forms.other).replaceAll(
    "{count}",
    formatStarsNumber(value, locale),
  );
}

/** Arrondi d'affichage à la demi-étoile (valeurs déjà en demi-étoiles). */
export function toHalfStars(value: number | null | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(5, Math.floor(n * 2) / 2));
}

/**
 * Animation à jouer pour des variations acquittées par cet onglet : la plus
 * récente donne le sens ; null si aucune.
 */
export function celebrationFor(
  acknowledged: readonly ReputationChange[],
): ReputationChange | null {
  if (acknowledged.length === 0) return null;
  return [...acknowledged].sort((a, b) =>
    a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0,
  )[0];
}
