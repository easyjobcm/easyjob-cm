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

  it("pages admin : le grade de session passe par requireAdminPage (compte actif)", () => {
    // Lot 17a : la fiche candidat utilise la garde commune. Pages encore
    // lues sans filtre is_active (antérieures, signalées AUDIT.md §39, à
    // corriger) : la liste ne doit que diminuer.
    const KNOWN_UNGUARDED = [
      "app/admin/candidates/page.tsx",
      "app/admin/cni/page.tsx",
      "app/admin/companies/page.tsx",
      "app/admin/momo/page.tsx",
      "app/admin/skill-documents/page.tsx",
      "app/admin/update-requests/page.tsx",
    ];
    const pages: string[] = [];
    (function walkPages(dir: string) {
      for (const e of fs.readdirSync(path.join(ROOT, dir), {
        withFileTypes: true,
      })) {
        const rel = path.join(dir, e.name);
        if (e.isDirectory()) walkPages(rel);
        else if (e.name === "page.tsx") pages.push(rel.replace(/\\/g, "/"));
      }
    })("app/admin");
    const unguarded = pages.filter((f) => {
      const text = fs.readFileSync(path.join(ROOT, f), "utf8");
      return [
        ...text.matchAll(/\.from\("users"\)[\s\S]{0,400}?\.single\(\)/g),
      ].some((m) => /\.select\("role/.test(m[0]) && !/is_active/.test(m[0]));
    });
    expect(unguarded).not.toContain("app/admin/candidates/[id]/page.tsx");
    expect(
      fs.readFileSync(
        path.join(ROOT, "app/admin/candidates/[id]/page.tsx"),
        "utf8",
      ),
    ).toMatch(/requireAdminPage\(/);
    expect(unguarded.filter((f) => !KNOWN_UNGUARDED.includes(f))).toEqual([]);
  });

  it("isAdminRole ne reconnaît que les trois grades", () => {
    expect(isAdminRole("admin_support")).toBe(true);
    expect(isAdminRole("admin_founder")).toBe(true);
    expect(isAdminRole("candidate")).toBe(false);
    expect(isAdminRole(null)).toBe(false);
  });
});
