/**
 * `supabase db query` pour les preuves, avec échec borné (lot 10).
 *
 * Incident du lot 9 : `job-moderation` est resté bloqué plusieurs heures
 * après une perte de connexion à la base. Cause reproduite : quand la
 * connexion tombe PENDANT une requête, la CLI attend la réponse sans délai
 * (`select pg_sleep(4)` + `docker pause` : toujours bloquée après 120 s),
 * et les anciens appels `spawnSync` n'avaient aucun `timeout`. En passant
 * par `cmd.exe` puis `pnpm exec`, un délai n'aurait tué que `cmd.exe` :
 * la CLI serait restée orpheline, connexion ouverte.
 *
 * Ici :
 *  - le binaire natif de la CLI (celle de package.json) est lancé
 *    directement, sans shell : le délai arrête le processus qui tient la
 *    connexion, et rien d'autre ne reste en vie ;
 *  - au-delà de `PROOF_SQL_TIMEOUT_MS` (60 s par défaut ; la plus longue
 *    requête des preuves dure quelques secondes), l'appel échoue avec
 *    l'étape concernée ;
 *  - aucune reprise automatique : une requête qui échoue fait échouer
 *    l'assertion ou la preuve, comme avant.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const PLATFORM_PACKAGES: Record<string, Record<string, string[]>> = {
  darwin: { arm64: ["darwin-arm64"], x64: ["darwin-x64"] },
  linux: {
    arm64: ["linux-arm64", "linux-arm64-musl"],
    x64: ["linux-x64", "linux-x64-musl"],
  },
  win32: { arm64: ["windows-arm64"], x64: ["windows-x64"] },
};

let cachedBinary: string | null = null;

/**
 * Binaire natif de la CLI installée par `supabase` (devDependency), résolu
 * comme le fait son lanceur `dist/supabase.js`.
 */
export function supabaseCliBinary(): string {
  if (cachedBinary) return cachedBinary;
  const override = process.env.SUPABASE_CLI_BINARY_OVERRIDE;
  if (override) return (cachedBinary = override);

  const localRequire = createRequire(__filename);
  const pkgJson = localRequire.resolve("supabase/package.json");
  const fromCli = createRequire(pkgJson);
  const ext = process.platform === "win32" ? ".exe" : "";
  for (const suffix of PLATFORM_PACKAGES[process.platform]?.[os.arch()] ?? []) {
    try {
      const dir = path.dirname(
        fromCli.resolve(`@supabase/cli-${suffix}/package.json`),
      );
      const bin = path.join(dir, "bin", `supabase${ext}`);
      if (fs.existsSync(bin)) return (cachedBinary = bin);
    } catch {
      // paquet absent pour cette variante : suivante
    }
  }
  throw new Error(
    `CLI Supabase introuvable pour ${process.platform}-${os.arch()} : relancer pnpm install.`,
  );
}

export function sqlTimeoutMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = Number(env.PROOF_SQL_TIMEOUT_MS);
  return Number.isInteger(raw) && raw > 0 ? raw : 60_000;
}

/** Première ligne utile de la requête, pour situer l'étape en échec. */
export function sqlStep(sql: string): string {
  const line =
    sql
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith("--")) ?? "";
  return line.length > 80 ? `${line.slice(0, 77)}...` : line;
}

export type SqlRun = {
  status: number | null;
  /** Sortie standard, ou l'erreur à défaut (comportement des anciens appels). */
  out: string;
  stdout: string;
  stderr: string;
};

/**
 * Exécute une instruction SQL (la CLI n'en accepte qu'une par appel) sur la
 * base `dbUrl` (toujours la pile dédiée, `readLocalDbUrl`). Lève une erreur
 * explicite si le délai est dépassé ; sinon renvoie le code de sortie et la
 * sortie, que l'appelant interprète comme avant.
 */
export function runSupabaseQuery(
  dbUrl: string,
  sql: string,
  options: {
    proof: string;
    timeoutMs?: number;
    /** Tests : commande lancée à la place de la CLI (mêmes règles de délai). */
    command?: { file: string; args: string[] };
  } = { proof: "proof" },
): SqlRun {
  const timeoutMs = options.timeoutMs ?? sqlTimeoutMs();
  const tmp = path.join(
    os.tmpdir(),
    `proof-${options.proof}-${randomUUID()}.sql`,
  );
  fs.writeFileSync(tmp, sql, "utf-8");
  try {
    const command = options.command ?? {
      file: supabaseCliBinary(),
      args: [
        "db",
        "query",
        "--output-format",
        "json",
        "--db-url",
        dbUrl,
        "-f",
        tmp,
      ],
    };
    const r = spawnSync(command.file, command.args, {
      encoding: "utf-8",
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    });
    const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ETIMEDOUT") {
      throw new Error(
        `supabase db query : aucune réponse après ${Math.round(timeoutMs / 1000)} s ` +
          `(proof-${options.proof}, étape « ${sqlStep(sql)} »). Base injoignable ` +
          "ou connexion perdue pendant la requête ; processus de la CLI arrêté. " +
          "Vérifier la pile dédiée (docker ps, supabase status --workdir), puis relancer la preuve.",
      );
    }
    if (r.error) {
      throw new Error(
        `supabase db query : lancement impossible (${code ?? r.error.message}).`,
      );
    }
    const stdout = r.stdout ?? "";
    const stderr = r.stderr ?? "";
    return { status: r.status, out: stdout || stderr, stdout, stderr };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
