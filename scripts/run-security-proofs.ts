/**
 * Suite d'autorisation (audit F-21) : exécute les preuves `proof-*.ts` sur
 * une pile Supabase locale jetable et échoue si une seule échoue.
 *
 * Les preuves s'exécutent l'une après l'autre : plusieurs modifient les
 * mêmes tables (users, candidate_profiles, jobs…) et nettoient leurs propres
 * comptes par préfixe d'email. Une exécution en parallèle n'est pas isolée.
 *
 * Prérequis : API_URL, ANON_KEY, SERVICE_ROLE_KEY, DB_URL (sortie de
 * `supabase status -o env`) et l'application Next servie sur NEXT_APP_URL,
 * reliée à la même pile. Procédure : docs/testing/local-proofs.md.
 *
 * Usage : pnpm test:rls [nom-de-preuve…]
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { readLocalDbUrl, readLocalProofEnv } from "./lib/local-supabase";

// Ordre : comptes et droits d'abord (les autres preuves supposent ces
// protections), puis profils, puis opérations admin.
const PROOFS = [
  "account-security",
  "business-permissions",
  "jobs-rls-select",
  "essentials-gate",
  "license-gate",
  "profile-lock",
  "profile-location",
  "profile-momo",
  "profile-skills",
  "profile-documents",
  "admin-centralization",
  "admin-candidate-profile",
  "admin-cni",
  "admin-momo-review",
  "admin-t84c-reviews",
  "admin-update-requests",
] as const;

async function assertAppReachable(appUrl: string) {
  try {
    const res = await fetch(`${appUrl}/auth/login`, { redirect: "manual" });
    if (res.status === 200) return;
    throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    throw new Error(
      `Application injoignable sur ${appUrl} (${(e as Error).message}). ` +
        "Les preuves qui appellent les routes ne seraient pas exécutées.",
    );
  }
}

async function main() {
  // Refus des cibles non locales avant toute écriture (les preuves
  // revérifient de leur côté).
  const { appUrl } = readLocalProofEnv();
  readLocalDbUrl();

  const requested = process.argv.slice(2);
  const unknown = requested.filter(
    (n) => !(PROOFS as readonly string[]).includes(n),
  );
  if (unknown.length > 0) {
    throw new Error(`Preuve inconnue : ${unknown.join(", ")}`);
  }
  const selected = requested.length > 0 ? requested : [...PROOFS];

  await assertAppReachable(appUrl);

  const results: { name: string; ok: boolean; seconds: number }[] = [];
  for (const name of selected) {
    console.log(`\n════ proof-${name} ════`);
    const start = Date.now();
    const r = spawnSync(
      process.execPath,
      ["--import", "tsx", path.join("scripts", `proof-${name}.ts`)],
      { stdio: "inherit", env: process.env },
    );
    results.push({
      name,
      ok: r.status === 0 && !r.error,
      seconds: Math.round((Date.now() - start) / 1000),
    });
  }

  console.log("\n════ Synthèse ════");
  for (const r of results) {
    console.log(`${r.ok ? "✅" : "❌"} proof-${r.name} (${r.seconds} s)`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(
    `\n${results.length - failed}/${results.length} preuves réussies`,
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error(`❌ ${(e as Error).message}`);
  process.exitCode = 1;
});
