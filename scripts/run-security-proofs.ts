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
 * Échec borné (lot 10) : chaque preuve a un délai (`PROOF_TIMEOUT_SECONDS`,
 * 600 s par défaut ; la plus longue dure environ 150 s). Au-delà, tout son
 * arbre de processus est arrêté (CLI Supabase et sockets Realtime comprises)
 * et la synthèse indique la dernière étape affichée. Aucune relance : une
 * preuve en échec ou hors délai fait échouer la suite.
 *
 * Usage : pnpm test:rls [nom-de-preuve…]
 */
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { readLocalDbUrl, readLocalProofEnv } from "./lib/local-supabase";

// Ordre : comptes et droits d'abord (les autres preuves supposent ces
// protections), puis profils, puis opérations admin.
const PROOFS = [
  "account-security",
  "phone-verification",
  "oauth-callback",
  "business-permissions",
  "jobs-rls-select",
  "essentials-gate",
  "license-gate",
  "profile-lock",
  "profile-location",
  "profile-momo",
  "profile-skills",
  "profile-documents",
  "company-onboarding",
  "company-permissions",
  "company-verification",
  "company-dossier-visibility",
  "job-moderation",
  "candidate-selection",
  "contract-signing",
  "mission-time-tracking",
  "reputation",
  "realtime",
  "chat-quota",
  "admin-centralization",
  "admin-candidate-profile",
  "admin-cni",
  "admin-momo-review",
  "admin-t84c-reviews",
  "admin-update-requests",
] as const;

type ProofResult = {
  name: string;
  ok: boolean;
  seconds: number;
  reason?: string;
};

function proofTimeoutSeconds(): number {
  const raw = Number(process.env.PROOF_TIMEOUT_SECONDS);
  return Number.isInteger(raw) && raw > 0 ? raw : 600;
}

/** Arrête le processus et tous ses descendants. */
function killTree(pid: number) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-pid, "SIGKILL"); // groupe créé par `detached: true`
  } catch {
    // déjà terminé
  }
}

/** Dernière ligne non vide affichée, pour situer l'étape en cours. */
function lastLineTracker() {
  let tail = "";
  let last = "";
  return {
    push(chunk: string) {
      tail += chunk;
      const lines = tail.split(/\r?\n/);
      tail = lines.pop() ?? "";
      // Lignes de pile (`at …`) et détails indentés : pas une étape.
      for (const l of lines) if (l.trim() && !/^\s/.test(l)) last = l.trim();
    },
    get last() {
      const pending = /^\s/.test(tail) ? "" : tail.trim();
      return (pending || last).slice(0, 200);
    },
  };
}

function runProof(name: string, timeoutSeconds: number): Promise<ProofResult> {
  const start = Date.now();
  const child = spawn(
    process.execPath,
    ["--import", "tsx", path.join("scripts", `proof-${name}.ts`)],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      // Linux : groupe de processus propre, arrêté d'un seul signal.
      detached: process.platform !== "win32",
      windowsHide: true,
    },
  );
  const step = lastLineTracker();
  child.stdout.setEncoding("utf-8");
  child.stderr.setEncoding("utf-8");
  child.stdout.on("data", (d: string) => {
    process.stdout.write(d);
    step.push(d);
  });
  child.stderr.on("data", (d: string) => {
    process.stderr.write(d);
    step.push(d);
  });

  return new Promise((resolve) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) killTree(child.pid);
    }, timeoutSeconds * 1000);
    const stopOnInterrupt = () => {
      if (child.pid) killTree(child.pid);
      process.exit(130);
    };
    process.once("SIGINT", stopOnInterrupt);

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      process.removeListener("SIGINT", stopOnInterrupt);
      const seconds = Math.round((Date.now() - start) / 1000);
      const where = `dernière étape affichée : « ${step.last || "aucune"} »`;
      if (timedOut) {
        const reason = `délai de ${timeoutSeconds} s dépassé, processus arrêtés ; ${where}`;
        console.error(`\n❌ proof-${name} : ${reason}`);
        resolve({ name, ok: false, seconds, reason });
        return;
      }
      if (code === 0) {
        resolve({ name, ok: true, seconds });
        return;
      }
      const exit = signal ? `signal ${signal}` : `code de sortie ${code}`;
      resolve({ name, ok: false, seconds, reason: `${exit} ; ${where}` });
    });
  });
}

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

  const timeoutSeconds = proofTimeoutSeconds();
  const results: ProofResult[] = [];
  for (const name of selected) {
    console.log(`\n════ proof-${name} ════`);
    results.push(await runProof(name, timeoutSeconds));
  }

  console.log("\n════ Synthèse ════");
  for (const r of results) {
    console.log(
      `${r.ok ? "✅" : "❌"} proof-${r.name} (${r.seconds} s)${r.ok ? "" : ` — ${r.reason}`}`,
    );
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
