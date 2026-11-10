/**
 * `pnpm env:target` : indique quelle base Supabase l'application utilisera,
 * à partir de `.env.local` et des variables de la session, sans afficher
 * aucune clé. Lecture seule : ne contacte aucun service.
 *
 * Next.js donne la priorité aux variables déjà définies dans la session
 * (PowerShell `$env:…`) sur `.env.local` : elles sont signalées.
 */
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { classifySupabaseUrl, describeTarget } from "./lib/supabase-target";

const file = ".env.local";
const fromFile: Record<string, string | undefined> = existsSync(file)
  ? parseEnv(readFileSync(file, "utf8"))
  : {};

function effective(name: string): { value?: string; source: string } {
  if (process.env[name]) return { value: process.env[name], source: "session" };
  if (fromFile[name]) return { value: fromFile[name], source: file };
  return { source: "absente" };
}

console.log(
  existsSync(file) ? `Fichier : ${file}` : `Fichier : ${file} absent`,
);

for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"]) {
  const { value, source } = effective(name);
  console.log(
    `${name.padEnd(30)} ${describeTarget(classifySupabaseUrl(value))} [${source}]`,
  );
}
for (const name of [
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
]) {
  const { value, source } = effective(name);
  console.log(
    `${name.padEnd(30)} ${!value ? "absente" : value.startsWith("YOUR_") ? "valeur d'exemple" : "définie"} [${source}]`,
  );
}

const app = effective("NEXT_PUBLIC_SUPABASE_URL").value;
const server = effective("SUPABASE_URL").value;
const originOf = (raw?: string) => {
  const t = classifySupabaseUrl(raw);
  return "url" in t ? t.url : null;
};
if (app && server && originOf(app) !== originOf(server)) {
  console.log(
    "⚠ NEXT_PUBLIC_SUPABASE_URL et SUPABASE_URL visent deux bases différentes.",
  );
  process.exitCode = 1;
}
