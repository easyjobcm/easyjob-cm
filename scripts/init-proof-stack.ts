/**
 * Prépare une pile Supabase locale DÉDIÉE aux scripts de preuve, distincte
 * de la pile de développement (qui peut contenir des données à préserver).
 *
 * Copie supabase/{config.toml,migrations,templates} dans un répertoire de
 * travail hors du dépôt, puis adapte config.toml :
 *  - project_id distinct → conteneurs et volumes Docker séparés ;
 *  - ports décalés de +100 → coexistence avec la pile de dev ;
 *  - fournisseurs externes coupés (SMS Twilio, OAuth Google) et services
 *    inutiles aux preuves (studio, analytics, edge runtime) désactivés.
 *
 * Ne démarre rien et n'écrit dans aucune base. Usage et suite de la
 * procédure : docs/testing/local-proofs.md
 */
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PROJECT_ID = "easyjob-proof";
const PORT_SHIFT: Record<string, string> = {
  "54320": "54420",
  "54321": "54421",
  "54322": "54422",
  "54323": "54423",
  "54324": "54424",
  "54327": "54427",
  "54329": "54429",
  "8083": "8183",
};
const DISABLED_SECTIONS = new Set([
  "studio",
  "analytics",
  "edge_runtime",
  "auth.sms.twilio",
  "auth.external.google",
  "storage.s3_protocol",
]);

const repoRoot = path.resolve(__dirname, "..");
const workdir = path.resolve(
  process.argv[2] ?? path.join(tmpdir(), "easyjob-proof-stack"),
);
if (workdir === repoRoot || workdir.startsWith(repoRoot + path.sep)) {
  throw new Error(
    "Le répertoire de la pile de preuve doit être hors du dépôt.",
  );
}

const src = path.join(repoRoot, "supabase");
const dst = path.join(workdir, "supabase");
mkdirSync(dst, { recursive: true });
// Migrations recopiées à chaque exécution : la pile reflète la branche.
rmSync(path.join(dst, "migrations"), { recursive: true, force: true });
for (const entry of ["config.toml", "migrations", "templates"]) {
  cpSync(path.join(src, entry), path.join(dst, entry), { recursive: true });
}

let section = "";
const config = readFileSync(path.join(dst, "config.toml"), "utf8")
  .split("\n")
  .map((line) => {
    const header = line.match(/^\[([^\]]+)\]/);
    if (header) section = header[1];
    if (/^project_id\s*=/.test(line)) return `project_id = "${PROJECT_ID}"`;
    if (DISABLED_SECTIONS.has(section) && /^enabled\s*=/.test(line)) {
      return "enabled = false";
    }
    return line.replace(
      /\b(54320|54321|54322|54323|54324|54327|54329|8083)\b/g,
      (port) => PORT_SHIFT[port],
    );
  })
  .join("\n");
writeFileSync(path.join(dst, "config.toml"), config);

console.log(`Pile de preuve préparée : ${workdir}`);
console.log(`project_id = ${PROJECT_ID}, API sur http://127.0.0.1:54421`);
