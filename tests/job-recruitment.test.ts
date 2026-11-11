import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isRecruitmentOpen,
  nextRecruitmentChange,
  recruitmentCloseInstant,
} from "@/lib/jobs/recruitment";
import { isJobUrgent } from "@/lib/jobs/urgency";
import {
  jobInputSchema,
  jobRefusal,
  jobUpdateSchema,
} from "@/lib/validations/job";

/**
 * Lot 11b : échéance de recrutement (H−24, ou H−2 en publication urgente),
 * figée en base. L'écran ne fait que la refléter ; la preuve
 * `job-deadlines` couvre les refus en base.
 */

const MIGRATION = fs.readFileSync(
  path.join(
    process.cwd(),
    "supabase/migrations/20261112120000_job_recruitment_deadlines.sql",
  ),
  "utf8",
);

/** Corps d'une fonction de la migration (du `create` au `$$;`). */
function fnBody(name: string): string {
  const a = MIGRATION.indexOf(`create or replace function public.${name}(`);
  expect(a).toBeGreaterThan(-1);
  return MIGRATION.slice(a, MIGRATION.indexOf("$$;", a));
}

const close = "2026-11-12T07:00:00.000Z";
const closeMs = Date.parse(close);

describe("isRecruitmentOpen", () => {
  it("ouvert strictement avant l'échéance, clos à l'instant exact et après", () => {
    const job = { applications_close_at: close, status: "active" };
    expect(isRecruitmentOpen(job, closeMs - 1)).toBe(true);
    expect(isRecruitmentOpen(job, closeMs)).toBe(false);
    expect(isRecruitmentOpen(job, closeMs + 1)).toBe(false);
  });

  it("sans échéance (offre antérieure au lot) ou non active → clos", () => {
    expect(isRecruitmentOpen({ applications_close_at: null }, 0)).toBe(false);
    expect(
      isRecruitmentOpen(
        { applications_close_at: close, status: "pending_review" },
        0,
      ),
    ).toBe(false);
    expect(recruitmentCloseInstant({ applications_close_at: "x" })).toBeNull();
  });

  it("le badge « Urgente » ne prolonge pas l'échéance", () => {
    // Début dans 20 h : badge affiché, échéance normale (H−24) passée.
    const now = Date.parse("2026-11-11T12:00:00Z");
    const job = {
      start_date: "2026-11-12",
      start_time: "09:00",
      status: "active",
      applications_close_at: "2026-11-11T08:00:00Z",
    };
    expect(isJobUrgent(job, now)).toBe(true);
    expect(isRecruitmentOpen(job, now)).toBe(false);
  });
});

describe("nextRecruitmentChange", () => {
  it("prochaine échéance future parmi les offres affichées", () => {
    const jobs = [
      { applications_close_at: "2026-11-12T09:00:00Z" },
      { applications_close_at: close },
      { applications_close_at: "2026-11-10T00:00:00Z" },
      { applications_close_at: null },
    ];
    expect(nextRecruitmentChange(jobs, closeMs - 10)).toBe(closeMs);
    expect(nextRecruitmentChange(jobs, closeMs)).toBe(
      Date.parse("2026-11-12T09:00:00Z"),
    );
    expect(nextRecruitmentChange(jobs, Date.parse("2027-01-01"))).toBeNull();
  });
});

describe("codes métier", () => {
  it("recruitment_closed et job_start_too_close → 409", () => {
    expect(jobRefusal("recruitment_closed")).toEqual({
      code: "recruitment_closed",
      status: 409,
    });
    expect(jobRefusal("job_start_too_close")?.status).toBe(409);
    expect(jobRefusal("job_schedule_locked")?.status).toBe(409);
  });
});

describe("schémas d'offre", () => {
  const job = {
    title: "Serveur",
    description: "Service en salle.",
    address: "Akwa",
    city: "Douala",
    start_date: "2020-01-01",
    start_time: "08:00:00",
    end_time: "16:00",
    mission_pay_per_candidate: 2500,
  };
  it("création : date passée refusée ; correction : date publiée renvoyée telle quelle, même passée", () => {
    expect(jobInputSchema.safeParse(job).success).toBe(false);
    expect(jobUpdateSchema.safeParse(job).success).toBe(true);
    expect(
      jobUpdateSchema.safeParse({ ...job, end_date: "2019-12-31" }).success,
    ).toBe(false);
  });
});

describe("migration 20261112120000", () => {
  it("bornes de publication : normal avant H−24, urgent de H−24 exclu à H−4 inclus", () => {
    const f = fnBody("job_publication_regime");
    expect(f).toMatch(/p_at < p_start - interval '24 hours' then 'normal'/);
    expect(f).toMatch(/p_at > p_start - interval '24 hours'/);
    expect(f).toMatch(/p_at <= p_start - interval '4 hours' then 'urgent'/);
    expect(fnBody("job_recruitment_close")).toMatch(
      /'urgent'\s+then interval '2 hours' else interval '24 hours'/,
    );
    expect(fnBody("job_start_instant")).toContain(
      "at time zone 'Africa/Douala'",
    );
  });

  it("candidature et sélection refusent à l'échéance avec l'heure de la base", () => {
    for (const name of ["apply_to_job", "select_candidate"]) {
      const f = fnBody(name);
      expect(f).toContain(
        "now() >= v_job.applications_close_at then\n    raise exception 'recruitment_closed'",
      );
    }
    // Sélection : l'échéance vient après la relance idempotente.
    const s = fnBody("select_candidate");
    expect(s.indexOf("v_application.status = 'selected'")).toBeLessThan(
      s.indexOf("'recruitment_closed'"),
    );
  });

  it("horaires, régime et échéance figés après la première publication (tout auteur, update_job)", () => {
    const guard = fnBody("job_publication_guard");
    expect(guard).toContain("'job_schedule_locked'");
    expect(guard).toMatch(
      /\(new\.start_date, new\.end_date, new\.start_time, new\.end_time\)\s+is distinct from/,
    );
    expect(guard).toMatch(/new\.applications_close_at\)\s+is distinct from/);
    const update = fnBody("update_job");
    expect(update).toContain(
      "if v_current.first_published_at is not null or v_current.legacy_publication then",
    );
    expect(update).toContain("raise exception 'job_schedule_locked'");
    expect(MIGRATION).not.toContain("job_republishable");
  });

  it("régime figé par trigger, champs de publication refusés au client, sans pg_cron", () => {
    expect(MIGRATION).toMatch(
      /create trigger trg_job_publication_guard\s+before insert or update on public\.jobs/,
    );
    expect(fnBody("job_publication_guard")).toContain(
      "'publication_regime_locked'",
    );
    for (const name of ["create_job", "update_job"]) {
      expect(fnBody(name)).toContain(
        "'first_published_at', 'publication_regime',",
      );
      expect(fnBody(name)).toContain("'job_start_too_close'");
    }
    expect(fnBody("moderate_job")).toContain("'job_start_too_close'");
    // Nouvelle approbation après correction : pas de borne temporelle.
    expect(fnBody("moderate_job")).toContain(
      "p_action = 'approve' and v_job.first_published_at is null",
    );
    expect(MIGRATION).not.toMatch(/cron\.(schedule|job)/);
    expect(MIGRATION).not.toMatch(/clock_timestamp/);
  });
});
