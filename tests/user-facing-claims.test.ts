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
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

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
  // Progression Sandbox automatique : aucune fonction ne fait évoluer
  // `candidate_profiles.sandbox_level` (lot 9, §24).
  /progressez mission après mission|progress mission by mission/i,
  /montez en grade|level up/i,
  /\d+ missions? · \d/i,
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
