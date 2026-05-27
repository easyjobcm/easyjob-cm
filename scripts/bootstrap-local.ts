import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";

const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
} as const;

function logInfo(message: string) {
  console.log(`${COLORS.blue}→ ${message}${COLORS.reset}`);
}

function logSuccess(message: string) {
  console.log(`${COLORS.green}✓ ${message}${COLORS.reset}`);
}

function logWarn(message: string) {
  console.log(`${COLORS.yellow}⚠ ${message}${COLORS.reset}`);
}

function logError(message: string) {
  console.error(`${COLORS.red}✗ ${message}${COLORS.reset}`);
}

function run(command: string, args: string[], captureOutput = false): string {
  const result = spawnSync(command, args, {
    stdio: captureOutput ? "pipe" : "inherit",
    shell: process.platform === "win32",
    env: process.env,
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    if (captureOutput) {
      const errorOutput = (result.stderr || result.stdout || "")
        .toString()
        .trim();
      if (errorOutput) {
        console.error(errorOutput);
      }
    }
    process.exit(result.status ?? 1);
  }

  return captureOutput ? (result.stdout || "").toString() : "";
}

function checkDockerRunning() {
  const result = spawnSync("docker", ["info"], {
    stdio: "pipe",
    shell: process.platform === "win32",
    env: process.env,
    encoding: "utf8",
  });

  if (result.error || result.status !== 0) {
    logError("Docker Desktop is not running or not accessible.");
    console.error(
      "Start Docker Desktop, wait until it is healthy, then rerun bootstrap.",
    );
    process.exit(1);
  }

  logSuccess("Docker is running");
}

function ensureEnvFile() {
  if (existsSync(".env.local")) {
    logSuccess(".env.local found");
    return;
  }

  if (existsSync(".env.local.example")) {
    copyFileSync(".env.local.example", ".env.local");
    logWarn(".env.local was missing. Copied from .env.local.example");
    return;
  }

  logError("Missing .env.local and .env.local.example");
  console.error(
    "Create .env.local (or add .env.local.example) before running bootstrap.",
  );
  process.exit(1);
}

function parseStatusEnv(envOutput: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of envOutput.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    values[key] = value;
  }
  return values;
}

function upsertEnvValue(content: string, key: string, value: string): string {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escapedKey}=.*$`, "m");
  if (pattern.test(content)) {
    return content.replace(pattern, `${key}=${value}`);
  }

  const separator = content.endsWith("\n") ? "" : "\n";
  return `${content}${separator}${key}=${value}\n`;
}

function writeSupabaseEnvFromStatus(statusEnv: Record<string, string>) {
  const apiUrl = statusEnv.API_URL;
  const anonKey = statusEnv.ANON_KEY;
  const serviceRoleKey = statusEnv.SERVICE_ROLE_KEY;

  if (!apiUrl || !anonKey || !serviceRoleKey) {
    logError(
      "Unable to extract API_URL, ANON_KEY, SERVICE_ROLE_KEY from `supabase status -o env`.",
    );
    process.exit(1);
  }

  let envContent = readFileSync(".env.local", "utf8");
  envContent = upsertEnvValue(envContent, "NEXT_PUBLIC_SUPABASE_URL", apiUrl);
  envContent = upsertEnvValue(
    envContent,
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    anonKey,
  );
  envContent = upsertEnvValue(
    envContent,
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    anonKey,
  );
  envContent = upsertEnvValue(envContent, "SUPABASE_URL", apiUrl);
  envContent = upsertEnvValue(
    envContent,
    "SUPABASE_SERVICE_ROLE_KEY",
    serviceRoleKey,
  );
  writeFileSync(".env.local", envContent, "utf8");

  logSuccess("Updated .env.local with local Supabase URL and keys");
}

function getCliOptions() {
  const args = process.argv.slice(2);
  return {
    skipSeed: args.includes("--skip-seed"),
  };
}

async function main() {
  const options = getCliOptions();

  logInfo("Checking Docker");
  checkDockerRunning();

  logInfo("Ensuring local env file");
  ensureEnvFile();

  if (!existsSync("node_modules")) {
    logInfo("Installing dependencies");
    run("pnpm", ["install"]);
    logSuccess("Dependencies installed");
  }

  logInfo("Starting Supabase local stack");
  run("npx", ["supabase", "start"]);
  logSuccess("Supabase started");

  logInfo("Reading Supabase local status");
  const statusEnvOutput = run("npx", ["supabase", "status", "-o", "env"], true);
  const statusEnv = parseStatusEnv(statusEnvOutput);
  writeSupabaseEnvFromStatus(statusEnv);

  logInfo("Resetting local database with migrations");
  run("npx", ["supabase", "db", "reset", "--local", "--yes", "--no-seed"]);
  logSuccess("Local database reset completed");

  if (options.skipSeed) {
    logWarn("Skipping seed step (--skip-seed)");
  } else {
    logInfo("Seeding local database");
    run("npx", ["tsx", "scripts/seed-test-data.ts"]);
    logSuccess("Seed completed");
  }

  logInfo("Generating local database types");
  mkdirSync("src/types", { recursive: true });
  run("npx", [
    "supabase",
    "gen",
    "types",
    "typescript",
    "--local",
    "--output",
    "src/types/database.ts",
  ]);
  logSuccess("Generated src/types/database.ts");

  logInfo("Current Supabase status");
  run("npx", ["supabase", "status"]);

  const studioUrl = statusEnv.STUDIO_URL ?? "http://127.0.0.1:54323";
  const mailpitUrl =
    statusEnv.INBUCKET_URL ?? statusEnv.MAILPIT_URL ?? "http://127.0.0.1:54324";
  const apiUrl = statusEnv.API_URL ?? "http://127.0.0.1:54321";

  console.log("");
  logSuccess("Local environment ready");
  console.log(`${COLORS.blue}→ Supabase API:${COLORS.reset} ${apiUrl}`);
  console.log(`${COLORS.blue}→ Supabase Studio:${COLORS.reset} ${studioUrl}`);
  console.log(`${COLORS.blue}→ Mailpit:${COLORS.reset} ${mailpitUrl}`);
  console.log(`${COLORS.blue}→ MCP:${COLORS.reset} ${apiUrl}/mcp`);
  console.log(
    `${COLORS.blue}→ Seed:${COLORS.reset} ${options.skipSeed ? "skipped" : "completed"}`,
  );
  console.log("");
  console.log(`${COLORS.blue}→ Test accounts:${COLORS.reset}`);
  console.log("- Candidate 1: +237690000001 (Jean Mbarga)");
  console.log("- Candidate 2: +237690000002 (Marie Ngo Ndongo)");
  console.log("- Candidate 3: +237690000003 (Paul Atangana)");
  console.log("- Company 1: +237690000004 (Restaurant Le Baobab)");
  console.log("- Company 2: +237690000005 (Hotel Akwa Palace)");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
