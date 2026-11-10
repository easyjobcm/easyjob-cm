import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isAdminRole } from "@/lib/auth/admin-role";

/**
 * Admin suspendu (AUDIT.md §28) : toute lecture du grade de la session dans
 * une route admin ou la garde des pages exige un compte actif, comme
 * `is_admin_user()` en base. La preuve `admin-centralization` (I3 à I8)
 * vérifie l'effet réel ; ce test empêche d'oublier le filtre dans une
 * nouvelle route.
 */
const ROOT = path.resolve(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), {
    withFileTypes: true,
  })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, out);
    else if (/\.ts$/.test(e.name)) out.push(rel);
  }
  return out;
}

describe("garde admin : compte actif exigé", () => {
  it("chaque lecture du rôle de session filtre is_active", () => {
    const files = [...walk("app/api/admin"), "lib/auth/admin-page.ts"];
    const missing: string[] = [];
    let reads = 0;
    for (const f of files) {
      const text = fs.readFileSync(path.join(ROOT, f), "utf8");
      for (const m of text.matchAll(
        /\.from\("users"\)[\s\S]{0,400}?\.single\(\)/g,
      )) {
        if (!/\.select\("role/.test(m[0])) continue;
        reads += 1;
        if (!/is_active/.test(m[0])) missing.push(f.replace(/\\/g, "/"));
      }
    }
    expect(reads).toBeGreaterThanOrEqual(20);
    expect(missing).toEqual([]);
  });

  it("isAdminRole ne reconnaît que les trois grades", () => {
    expect(isAdminRole("admin_support")).toBe(true);
    expect(isAdminRole("admin_founder")).toBe(true);
    expect(isAdminRole("candidate")).toBe(false);
    expect(isAdminRole(null)).toBe(false);
  });
});
