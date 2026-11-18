import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Lot 9 (F-19, F-18) : promesses non livrées et liens morts.
 *
 * 1. Aucune affirmation retirée ne réapparaît dans les dictionnaires ni sur
 *    l'accueil : paiement sous 48 h, séquestre ou montant bloqué, retrait
 *    Mobile Money, remplacement garanti, sélection par IA, essai gratuit,
 *    application hors ligne, validation des heures.
 * 2. Tout lien interne statique (`href`, `router.push`, `redirect`,
 *    `loginHref`) vise une page ou une route existante.
 */

const ROOT = path.resolve(__dirname, "..");
// Chaque fichier n'est lu qu'une fois : le parcours complet du dépôt
// (environ 280 fichiers) était relu quatre fois de façon synchrone, et le
// test dépassait parfois 5 s sous charge (lot 10).
const cache = new Map<string, string>();
const read = (p: string): string => {
  let text = cache.get(p);
  if (text === undefined) {
    text = fs.readFileSync(path.join(ROOT, p), "utf8");
    cache.set(p, text);
  }
  return text;
};

const FORBIDDEN: RegExp[] = [
  /payé en 48|100 ?% en 48|paiement sous 48|paid in 48|100 ?% within 48/i,
  /séquestre|escrow/i,
  /montant bloqué|paiements sont bloqués|locked amount|payments are held/i,
  /remplacement (en 2h )?garanti|guaranteed replacement|replacement in 2h guaranteed/i,
  /l'ia (sélectionne|pré-sélectionne|génère|complète|recrute)|ia qui sélectionne/i,
  /\bai (screens|shortlisting|pre-selects|generates|completes|hires)/i,
  /essai gratuit|jours gratuits|jours offerts|free trial|days free|7j gratuits|7d free/i,
  /fonctionne hors ligne|works offline/i,
  /paiement garanti|guaranteed payment|confiance garantie|guaranteed trust/i,
  /frais de retrait|withdrawal fee|retrait indisponible/i,
  /arrive directement sur votre momo|goes directly to your .*momo/i,
  /géré automatiquement par easyjob|handled automatically by easyjob/i,
  /validez vos heures|arrival and departure check-in|heures retenues/i,
  /payées en mobile money|paid via mobile money/i,
  // Progression Sandbox automatique (lot 9, §24), puis niveaux Sandbox
  // retirés (lot 9b, §25) : la réputation affichée est la note des avis.
  /progressez mission après mission|progress mission by mission/i,
  /montez en grade|level up/i,
  /\d+ missions? · \d/i,
  /sandbox/i,
  /niveau (minimum|de confiance|supérieur)|minimum level|trust level/i,
  /score de fiabilité|reliability score/i,
];

/**
 * Lot 17a : avantages Premium NON LIVRÉS, reconnus dans leur contexte
 * (mécanisme promis + objet : candidatures, entreprises, offres réservées
 * aux Premium, versement). L'existence d'une offre Premium, un appel comme
 * « Passez à Premium » ou un prix ne sont pas visés : le parcours commercial
 * reste prévu au plan (lot Free/Premium) et ses textes seront revus avec la
 * grille validée.
 */
const PREMIUM_FORBIDDEN: RegExp[] = [
  // Priorité de candidature, de sélection ou d'affichage.
  /priorit[ée] (sur|dans) (toutes )?(les |vos )?candidatures/i,
  /priority (on|in) (every |all |your )?applications?/i,
  /(profil|offres?) remonte(nt)? en premier/i,
  /(shown|appears?) first to (companies|premium)/i,
  /candidats premium (prioritaires|en premier)/i,
  // Offres réservées aux Premium.
  /(offres?|missions?|jobs?) (exclusives?|réservées?)[^"`\n]{0,40}premium/i,
  /(exclusive|reserved)[^"`\n]{0,20}premium|premium[^"`\n]{0,20}(exclusive|reserved)/i,
  // Versement plus rapide.
  /paiement accéléré|accelerated payment|faster payment/i,
];

function premiumClaimHits(text: string): string[] {
  return PREMIUM_FORBIDDEN.filter((re) => re.test(text)).map(String);
}

const PREMIUM_SCOPE = [
  "lib/i18n/fr.ts",
  "lib/i18n/en.ts",
  "lib/chat/system-prompt.ts",
  "app/page.tsx",
];

describe("promesses retirées (F-19)", () => {
  it.each([
    "lib/i18n/fr.ts",
    "lib/i18n/en.ts",
    "app/page.tsx",
    "app/earnings/page.tsx",
  ])("%s ne contient aucune affirmation retirée", (file) => {
    const text = read(file);
    const hits = FORBIDDEN.filter((re) => re.test(text)).map(String);
    expect(hits).toEqual([]);
  });

  it("lot 9b : aucun niveau Sandbox ni score de fiabilité public dans le code", () => {
    const files = ["app", "components", "lib", "hooks"]
      .flatMap((d) => walk(d))
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .map((f) => f.replace(/\\/g, "/"))
      // Types générés.
      .filter((f) => f !== "lib/database.types.ts");
    const levels =
      /sandbox_level|sandboxLevel|SANDBOX_LEVELS|is_sandbox|sandbox_config|sandboxBadge/;
    expect(files.filter((f) => levels.test(read(f)))).toEqual([]);
    // reliability_score (jamais calculé) ne reste que sur l'écran admin.
    expect(
      files.filter(
        (f) => !f.includes("/admin/") && /reliability_score/.test(read(f)),
      ),
    ).toEqual([]);
  });

  it.each(PREMIUM_SCOPE)(
    "lot 17a : %s n'annonce aucun avantage Premium non livré",
    (file) => {
      const text = read(file);
      expect(premiumClaimHits(text)).toEqual([]);
    },
  );

  it("lot 17a : les motifs visent les promesses, pas l'offre Premium elle-même", () => {
    // Textes retirés au lot 17a : détectés.
    for (const removed of [
      "Priorité sur toutes les candidatures",
      "Votre profil remonte en premier auprès des entreprises.",
      "Accès aux offres exclusives Premium",
      "Accédez aux missions réservées aux candidats Premium.",
      "Priority on every application",
      "Your profile is shown first to companies.",
      "Access to exclusive Premium jobs",
      "Vos offres remontent en premier auprès des candidats Premium et notés 4★+.",
    ]) {
      expect(premiumClaimHits(removed), removed).not.toEqual([]);
    }
    // Parcours commercial prévu : autorisé.
    for (const allowed of [
      "Passez à Premium",
      "Go Premium",
      "Devenir Premium",
      "Premium coûte 1 000 FCFA par mois.",
      "Votre plan : Premium",
      "Premium est attribué par l'équipe EasyJob.",
    ]) {
      expect(premiumClaimHits(allowed), allowed).toEqual([]);
    }
  });

  it("lot 17a : aucun écran n'annonce d'avantage Premium non livré", () => {
    const files = ["app", "components", "hooks"]
      .flatMap((d) => walk(d))
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .map((f) => f.replace(/\\/g, "/"));
    const offenders = files.flatMap((f) =>
      PREMIUM_FORBIDDEN.filter((re) => re.test(read(f))).map(
        (re) => `${f} → ${String(re)}`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("l'accueil n'affiche plus de compteurs d'utilisateurs sans source", () => {
    const page = read("app/page.tsx");
    expect(page).not.toMatch(/"1 500\+"|"200\+"|"5 000\+"/);
  });
});

// ── Liens internes ──
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), {
    withFileTypes: true,
  })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

const routes = walk("app")
  .filter((f) => /[\\/](page\.tsx|route\.ts)$/.test(f))
  .map((f) => {
    const dir = path.dirname(f).replace(/\\/g, "/").replace(/^app/, "") || "/";
    return dir.replace(/\/\([^)]*\)/g, "") || "/";
  });
const routePatterns = routes.map(
  (r) => new RegExp(`^${r.replace(/\[[^\]]+\]/g, "[^/]+")}$`),
);

function routeExists(target: string): boolean {
  const pathname = target.split(/[?#]/)[0].replace(/\/$/, "") || "/";
  return routePatterns.some((re) => re.test(pathname));
}

const LINK =
  /(?:href=|href:\s*|push\(|replace\(|redirect\(|loginHref\()\s*\{?\s*["'`](\/[^"'`$]*)["'`]/g;

describe("liens internes (F-18)", () => {
  const files = [...walk("app"), ...walk("components")].filter((f) =>
    /\.(tsx|ts)$/.test(f),
  );

  it("chaque destination statique existe", () => {
    const broken: string[] = [];
    for (const file of files) {
      const text = read(file);
      for (const m of text.matchAll(LINK)) {
        const target = m[1];
        if (target.startsWith("/api/") || target.startsWith("/icons/"))
          continue;
        if (target.endsWith("/")) continue; // préfixe d'un lien dynamique
        if (!routeExists(target))
          broken.push(`${file.replace(/\\/g, "/")} → ${target}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("aucune redirection vers l'ancienne page /login", () => {
    const offenders = files.filter((f) => /["'`]\/login[?"'`/]/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});
