import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { internalErrorResponse } from "@/lib/api/errors";

/**
 * Réputation d'un candidat ou d'une entreprise vue par l'administration
 * (lot 9c). Seule surface où l'avis complet est lisible : note, auteur,
 * mission, motifs, commentaire et impact sur le solde.
 *
 * GET  : 3 grades (admin_support en lecture). Lecture en clé service après
 *        contrôle du rôle (aucune policy de session sur reviews).
 * POST : contestation reçue par le support.
 *        - open    : rattache la demande à l'avis (3 grades) ;
 *        - resolve : décision définitive (admin_ops, admin_founder).
 *        RPC en session admin : l'audit enregistre l'admin réel, le score
 *        est recalculé dans la même transaction.
 */

type RouteContext = { params: Promise<{ type: string; id: string }> };

const ADMIN_ROLES = ["admin_support", "admin_ops", "admin_founder"];
const DECIDER_ROLES = ["admin_ops", "admin_founder"];

const paramsSchema = z.object({
  type: z.enum(["candidate", "company"]),
  id: z.string().uuid(),
});

const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("open"),
    review_id: z.string().uuid(),
    note: z.string().trim().min(3).max(2000),
  }),
  z.object({
    action: z.literal("resolve"),
    review_id: z.string().uuid(),
    outcome: z.enum(["upheld", "rejected"]),
    note: z.string().trim().min(3).max(2000),
  }),
]);

const RPC_REFUSALS: Record<string, number> = {
  forbidden: 403,
  note_invalid: 400,
  outcome_invalid: 400,
  review_not_found: 404,
  contest_not_found: 409,
  contest_already_resolved: 409,
};

function json(status: number, code: string) {
  return NextResponse.json({ error: code, code }, { status });
}

async function adminContext(params: RouteContext["params"]) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return { error: json(404, "not_found") } as const;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: json(401, "not_authenticated") } as const;
  const { data: me } = await supabase
    .from("users")
    .select("role, is_active")
    .eq("id", user.id)
    .single();
  if (!me || me.is_active === false || !ADMIN_ROLES.includes(me.role)) {
    return { error: json(403, "forbidden") } as const;
  }
  return { supabase, role: me.role as string, ...parsed.data } as const;
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await adminContext(params);
  if ("error" in ctx) return ctx.error;
  const admin = createAdminClient();

  const { data: score, error: scoreError } = await admin.rpc(
    "compute_reputation",
    { p_subject_type: ctx.type, p_subject_id: ctx.id },
  );
  if (scoreError) {
    return internalErrorResponse("admin.reputation.score", scoreError, {
      code: "reputation_failed",
      request,
    });
  }
  const breakdown = score?.[0] ?? null;
  if (!breakdown) return json(404, "not_found");

  const [reviewsRes, impactsRes, changesRes, incidentsRes] = await Promise.all([
    admin
      .from("reviews")
      .select(
        "id, mission_id, reviewer_type, reviewer_id, overall_rating, reasons, comment, origin, created_at",
      )
      .eq("reviewed_type", ctx.type)
      .eq("reviewed_id", ctx.id)
      .order("created_at", { ascending: false })
      .limit(100),
    admin.rpc("admin_reputation_review_impacts", {
      p_subject_type: ctx.type,
      p_subject_id: ctx.id,
    }),
    admin
      .from("reputation_changes")
      .select("id, from_stars, to_stars, direction, cause, created_at")
      .eq("subject_type", ctx.type)
      .eq("subject_id", ctx.id)
      .order("created_at", { ascending: false })
      .limit(10),
    admin
      .from("reputation_incidents")
      .select("id, kind, source, occurred_at, scheduled_start_at, voided_at")
      .eq("subject_type", ctx.type)
      .eq("subject_id", ctx.id)
      .order("occurred_at", { ascending: false }),
  ]);
  const failed = [reviewsRes, impactsRes, changesRes, incidentsRes].find(
    (r) => r.error,
  );
  if (failed?.error) {
    return internalErrorResponse("admin.reputation.read", failed.error, {
      code: "reputation_failed",
      request,
    });
  }

  const reviewRows = reviewsRes.data ?? [];
  const reviewIds = reviewRows.map((r) => r.id);
  const missionIds = [...new Set(reviewRows.map((r) => r.mission_id))];
  const candidateAuthors = reviewRows
    .filter((r) => r.reviewer_type === "candidate")
    .map((r) => r.reviewer_id);
  const companyAuthors = reviewRows
    .filter((r) => r.reviewer_type === "company")
    .map((r) => r.reviewer_id);

  const contests = reviewIds.length
    ? ((
        await admin
          .from("disputes")
          .select(
            "id, review_id, status, outcome, description, resolution, created_at, resolved_at",
          )
          .in("review_id", reviewIds)
      ).data ?? [])
    : [];
  const missions = missionIds.length
    ? ((
        await admin
          .from("missions")
          .select("id, scheduled_date, job_id")
          .in("id", missionIds)
      ).data ?? [])
    : [];
  const jobIds = [...new Set(missions.map((m) => m.job_id))];
  const jobs = jobIds.length
    ? ((await admin.from("jobs").select("id, title").in("id", jobIds)).data ??
      [])
    : [];
  const candidates = candidateAuthors.length
    ? ((
        await admin
          .from("candidate_profiles")
          .select("id, first_name, last_name")
          .in("id", candidateAuthors)
      ).data ?? [])
    : [];
  const companies = companyAuthors.length
    ? ((
        await admin
          .from("company_profiles")
          .select("id, company_name")
          .in("id", companyAuthors)
      ).data ?? [])
    : [];

  const impactById = new Map(
    (impactsRes.data ?? []).map((i) => [i.review_id, i]),
  );
  const contestById = new Map(contests.map((c) => [c.review_id, c]));
  const missionById = new Map(missions.map((m) => [m.id, m]));
  const jobTitle = new Map(jobs.map((j) => [j.id, j.title]));
  const authorName = new Map<string, string>();
  for (const c of candidates) {
    authorName.set(c.id, `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim());
  }
  for (const c of companies) authorName.set(c.id, c.company_name);

  return NextResponse.json(
    {
      subject_type: ctx.type,
      subject_id: ctx.id,
      can_decide: DECIDER_ROLES.includes(ctx.role),
      score: breakdown,
      reviews: reviewRows.map((r) => {
        const mission = missionById.get(r.mission_id);
        const impact = impactById.get(r.id);
        const contest = contestById.get(r.id);
        return {
          id: r.id,
          rating: r.overall_rating,
          reasons: r.reasons,
          comment: r.comment,
          origin: r.origin,
          created_at: r.created_at,
          author: {
            type: r.reviewer_type,
            id: r.reviewer_id,
            name: authorName.get(r.reviewer_id) ?? null,
          },
          mission: mission
            ? {
                id: mission.id,
                scheduled_date: mission.scheduled_date,
                job_title: jobTitle.get(mission.job_id) ?? null,
              }
            : null,
          impact: impact
            ? {
                admissible: impact.admissible,
                nominal: impact.nominal_delta,
                applied: impact.applied_delta,
                balance: impact.balance_after,
              }
            : null,
          contest: contest
            ? {
                id: contest.id,
                status: contest.status,
                outcome: contest.outcome,
                note: contest.description,
                resolution: contest.resolution,
                created_at: contest.created_at,
                resolved_at: contest.resolved_at,
              }
            : null,
        };
      }),
      changes: changesRes.data ?? [],
      incidents: incidentsRes.data ?? [],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const ctx = await adminContext(params);
  if ("error" in ctx) return ctx.error;
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(400, "invalid_input");

  // La contestation doit viser un avis reçu par ce profil.
  const admin = createAdminClient();
  const { data: review } = await admin
    .from("reviews")
    .select("id")
    .eq("id", parsed.data.review_id)
    .eq("reviewed_type", ctx.type)
    .eq("reviewed_id", ctx.id)
    .maybeSingle();
  if (!review) return json(404, "review_not_found");

  const { data, error } =
    parsed.data.action === "open"
      ? await ctx.supabase.rpc("admin_open_review_contest", {
          p_review_id: parsed.data.review_id,
          p_note: parsed.data.note,
        })
      : await ctx.supabase.rpc("admin_resolve_review_contest", {
          p_review_id: parsed.data.review_id,
          p_outcome: parsed.data.outcome,
          p_note: parsed.data.note,
        });
  if (error) {
    const status = error.message ? RPC_REFUSALS[error.message] : undefined;
    if (status) return json(status, error.message);
    return internalErrorResponse("admin.reputation.contest", error, {
      code: "contest_failed",
      request,
    });
  }
  return NextResponse.json({ result: data });
}
