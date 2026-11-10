import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { describe, expect, it } from "vitest";
import {
  runSupabaseQuery,
  sqlStep,
  sqlTimeoutMs,
  supabaseCliBinary,
} from "@/scripts/lib/db-query";

/**
 * Lot 10 : une requête de preuve sans réponse échoue en un temps borné, avec
 * l'étape concernée, et ne laisse aucun processus derrière elle.
 */
function isAlive(pid: number): boolean {
  if (process.platform === "win32") {
    const out = spawnSync("tasklist", ["/fi", `PID eq ${pid}`, "/nh"], {
      encoding: "utf-8",
    }).stdout;
    return out.includes(String(pid));
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("runSupabaseQuery (preuves)", () => {
  it("échoue après le délai, nomme l'étape et arrête le processus", () => {
    // Processus qui ne répond jamais, comme la CLI après une perte de connexion.
    const marker = `${process.pid}-${Date.now()}`;
    const started = Date.now();
    let message = "";
    try {
      runSupabaseQuery(
        "postgresql://postgres:postgres@127.0.0.1:1/postgres",
        "-- commentaire\nselect pg_sleep(600) as slept",
        {
          proof: "test",
          timeoutMs: 800,
          command: {
            file: process.execPath,
            args: [
              "-e",
              `require("fs").writeFileSync(require("os").tmpdir()+"/db-query-${marker}.pid", String(process.pid)); setInterval(() => {}, 1000);`,
            ],
          },
        },
      );
    } catch (e) {
      message = (e as Error).message;
    }
    const elapsed = Date.now() - started;
    expect(message).toContain("aucune réponse après 1 s");
    expect(message).toContain("proof-test");
    expect(message).toContain("étape « select pg_sleep(600) as slept »");
    expect(elapsed).toBeLessThan(10_000);

    const pidFile = `${os.tmpdir()}/db-query-${marker}.pid`;
    const pid = Number(fs.readFileSync(pidFile, "utf-8"));
    fs.rmSync(pidFile, { force: true });
    expect(isAlive(pid)).toBe(false);
  });

  it("rend le code de sortie et la sortie sans rien reprendre", () => {
    const r = runSupabaseQuery("x", "select 1", {
      proof: "test",
      command: {
        file: process.execPath,
        args: ["-e", 'process.stderr.write("refus"); process.exit(3)'],
      },
    });
    expect(r).toMatchObject({ status: 3, out: "refus", stderr: "refus" });
  });

  it("délai configurable et binaire natif de la CLI résolu", () => {
    expect(sqlTimeoutMs({})).toBe(60_000);
    expect(sqlTimeoutMs({ PROOF_SQL_TIMEOUT_MS: "5000" })).toBe(5000);
    expect(sqlTimeoutMs({ PROOF_SQL_TIMEOUT_MS: "abc" })).toBe(60_000);
    expect(sqlStep("\n  -- x\n  update public.jobs set a = 1")).toBe(
      "update public.jobs set a = 1",
    );
    expect(supabaseCliBinary()).toMatch(/supabase(\.exe)?$/);
  });
});
