import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { missionReviewSchema } from "@/lib/validations/mission";
import {
  CANDIDATE_REVIEW_REASONS,
  COMPANY_REVIEW_REASONS,
  ALL_REVIEW_REASONS,
} from "@/lib/reputation/review-reasons";
import { fr } from "@/lib/i18n/fr";
import { en } from "@/lib/i18n/en";

const migration = readFileSync(
  path.resolve(
    __dirname,
    "../supabase/migrations/20261109120000_reputation_stars.sql",
  ),
  "utf8",
);

function firstIssue(input: unknown): string | undefined {
  const r = missionReviewSchema.safeParse(input);
  return r.success ? undefined : r.error.issues[0]?.message;
}

describe("missionReviewSchema (motifs)", () => {
  it("note < 3 sans motif : reasons_required", () => {
    expect(firstIssue({ rating: 2 })).toBe("reasons_required");
    expect(firstIssue({ rating: 1, reasons: [] })).toBe("reasons_required");
  });

  it("note < 3 avec motif : accepté", () => {
    expect(firstIssue({ rating: 2, reasons: ["late"] })).toBeUndefined();
  });

  it("note 3 : motif facultatif", () => {
    expect(firstIssue({ rating: 3 })).toBeUndefined();
    expect(firstIssue({ rating: 3, reasons: ["unsafe"] })).toBeUndefined();
  });

  it("note 4 ou 5 avec motif : reasons_invalid", () => {
    expect(firstIssue({ rating: 5, reasons: ["late"] })).toBe(
      "reasons_invalid",
    );
  });

  it("code inconnu ou doublon : reasons_invalid", () => {
    expect(firstIssue({ rating: 1, reasons: ["mauvais"] })).toBe(
      "reasons_invalid",
    );
    expect(firstIssue({ rating: 1, reasons: ["late", "late"] })).toBe(
      "reasons_invalid",
    );
  });

  it("note 5 sans motif : valeur par défaut []", () => {
    const r = missionReviewSchema.parse({ rating: 5 });
    expect(r.reasons).toEqual([]);
  });
});

describe("catalogue des motifs", () => {
  it("mêmes codes que review_reasons_for (SQL)", () => {
    const cand = migration.match(
      /when 'candidate' then array\[([^\]]+)\]/,
    )?.[1];
    const comp = migration.match(/when 'company' then array\[([^\]]+)\]/)?.[1];
    const codes = (s: string | undefined) =>
      (s ?? "").match(/'([a-z_]+)'/g)?.map((x) => x.slice(1, -1));
    expect(codes(cand)).toEqual([...CANDIDATE_REVIEW_REASONS]);
    expect(codes(comp)).toEqual([...COMPANY_REVIEW_REASONS]);
  });

  it("libellés FR/EN identiques à review_reason_label (casse près)", () => {
    for (const code of ALL_REVIEW_REASONS) {
      const re = new RegExp(`when '${code}' then '((?:[^']|'')+)'`, "g");
      const [enSql, frSql] = [...migration.matchAll(re)].map((m) =>
        m[1].replaceAll("''", "'"),
      );
      expect(en.reputation.reasons[code].toLowerCase()).toBe(enSql);
      expect(fr.reputation.reasons[code].toLowerCase()).toBe(frSql);
    }
  });
});
