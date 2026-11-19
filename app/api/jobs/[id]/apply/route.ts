import { createClient } from "@/lib/supabase/server";
import { logServerError, requestIdFrom } from "@/lib/observability/server-log";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  documentRequirementMessage,
  parseDocumentRequirementDetail,
} from "@/lib/matching/skill-document-requirements";
import { checkEssentialCriteria } from "@/lib/utils/profile-completion";
import { cniExpiredDetailSchema } from "@/lib/utils/cni-validity";
import {
  JOB_DAYS_MAX,
  parseBlockedDays,
  parseDaysDetail,
} from "@/lib/jobs/schedule";

// Les règles de candidature et de retrait sont appliquées en base par les
// RPC `apply_to_job` et `withdraw_job_application` (migration
// 20261031130000, SECURITY DEFINER, candidat déduit de la session). Un appel
// PostgREST direct rencontre donc les mêmes refus. Cette route ne fait que
// traduire leurs codes en réponses HTTP, inchangées pour l'interface.
//
// T8.3 — le gate de vérification porte sur `users.is_verified` (SRS §6.6 /
// §11.5). `checkEssentialCriteria` ne sert qu'à lister les champs manquants.
//
// Lot 9d — une CNI expirée (ou un renouvellement non encore approuvé)
// refuse toute nouvelle candidature : 403 `cni_expired` avec l'état du
// renouvellement. Un refus documentaire mémorise l'offre
// (`record_application_blocker`, recalcul en base) pour que la tâche reste
// visible dans l'onglet Tâches après reconnexion.

const jobIdSchema = z.string().uuid();

// Lot 12 : journées visées (format « journées au choix »), tout ou rien.
// Corps absent : candidature à l'offre entière (période complète).
const applyBodySchema = z.object({
  day_ids: z.array(z.string().uuid()).min(1).max(JOB_DAYS_MAX).optional(),
});

type RpcError = { message: string; details?: string | null };

const APPLY_REFUSALS: Record<string, { status: number; error: string }> = {
  not_authenticated: { status: 401, error: "Unauthorized" },
  profile_not_found: { status: 404, error: "Candidate profile not found" },
  onboarding_incomplete: {
    status: 400,
    error: "Please complete your profile first",
  },
  profile_incomplete: {
    status: 400,
    error: "Profile must be at least 60% complete to apply",
  },
  job_not_found: { status: 404, error: "Job not found" },
  job_not_available: { status: 400, error: "Job is not available" },
  no_positions: { status: 400, error: "No positions available" },
  // Lot 11b : échéance de l'offre atteinte (H−24, ou H−2 si urgente).
  recruitment_closed: { status: 409, error: "Applications are closed" },
  already_applied: { status: 400, error: "Already applied to this job" },
  // Lot 12 : journées au choix.
  job_days_required: { status: 400, error: "Choose at least one day" },
  job_days_invalid: { status: 400, error: "Invalid days" },
  job_days_not_selectable: {
    status: 400,
    error: "This job covers the whole period",
  },
  job_days_missing: { status: 409, error: "Job is not available" },
  // Lot 17d-1 : offre clôturée par l'entreprise (course avec la clôture).
  job_closed: { status: 409, error: "This job was closed by the company" },
};

const WITHDRAW_REFUSALS: Record<string, { status: number; error: string }> = {
  not_authenticated: { status: 401, error: "Unauthorized" },
  application_not_found: { status: 404, error: "Application not found" },
  application_not_withdrawable: {
    status: 409,
    error: "Only pending applications can be cancelled",
  },
  // Lot 17d-1 : candidature figée sur une offre clôturée (historique).
  job_closed: { status: 409, error: "This job was closed by the company" },
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const jobId = jobIdSchema.safeParse(id);
    if (!jobId.success) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const raw = await request.text();
    let parsedBody: unknown = {};
    try {
      parsedBody = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      parsedBody = null;
    }
    const body = applyBodySchema.safeParse(parsedBody);
    if (!body.success) {
      return NextResponse.json(
        { error: "Invalid days", code: "job_days_invalid" },
        { status: 400 },
      );
    }

    if (body.data.day_ids) {
      const { data: applications, error } = await supabase.rpc(
        "apply_to_job_days",
        { p_job_id: jobId.data, p_day_ids: body.data.day_ids },
      );
      if (error) {
        return applyRefusalResponse(supabase, user.id, jobId.data, error);
      }
      return NextResponse.json({
        success: true,
        application: applications[0] ?? null,
        applications,
      });
    }

    const { data: application, error } = await supabase.rpc("apply_to_job", {
      p_job_id: jobId.data,
    });

    if (error) {
      return applyRefusalResponse(supabase, user.id, jobId.data, error);
    }

    return NextResponse.json({ success: true, application });
  } catch (error) {
    logServerError("jobs.apply", error, {
      requestId: requestIdFrom(request.headers),
    });
    return NextResponse.json(
      { error: "Internal server error", code: "application_failed" },
      { status: 500 },
    );
  }
}

async function applyRefusalResponse(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  jobId: string,
  error: RpcError,
) {
  const refusal = APPLY_REFUSALS[error.message];
  if (refusal) {
    return NextResponse.json(
      { error: refusal.error, code: error.message },
      { status: refusal.status },
    );
  }

  // Lot 12 : journées bloquantes nommées (date, motif), rien n'est créé.
  if (error.message === "job_days_unavailable") {
    return NextResponse.json(
      {
        error: "Some days are no longer available",
        code: "job_days_unavailable",
        days: parseBlockedDays(error.details),
      },
      { status: 409 },
    );
  }

  // Engagement du candidat lui-même incompatible (chevauchement ou moins de
  // 3 h) : journées de cette offre concernées.
  if (error.message === "schedule_conflict") {
    return NextResponse.json(
      {
        error: "You already have a commitment at that time",
        code: "schedule_conflict",
        days: parseDaysDetail(error.details),
      },
      { status: 409 },
    );
  }

  if (error.message === "account_suspended") {
    return NextResponse.json(
      { error: "Votre compte est suspendu", code: "account_suspended" },
      { status: 403 },
    );
  }

  if (error.message === "cni_expired") {
    let parsed: unknown = null;
    try {
      parsed = error.details ? JSON.parse(error.details) : null;
    } catch {
      parsed = null;
    }
    const detail = cniExpiredDetailSchema.safeParse(parsed);
    return NextResponse.json(
      {
        error: "Your national ID card has expired",
        code: "cni_expired",
        state: detail.success ? detail.data.state : "expired",
      },
      { status: 403 },
    );
  }

  if (error.message === "profile_not_verified") {
    const { data: profile } = await supabase
      .from("candidate_profiles")
      .select(
        "first_name, last_name, date_of_birth, cni_verified, cni_expires_at, momo_verified",
      )
      .eq("user_id", userId)
      .single();
    return NextResponse.json(
      {
        error: "Your profile must be verified before you can apply",
        code: "profile_not_verified",
        missing: profile ? checkEssentialCriteria(profile).missing : [],
      },
      { status: 403 },
    );
  }

  if (error.message === "document_requirement") {
    const detail = parseDocumentRequirementDetail(error.details);
    if (detail) {
      // Tâche « justificatif » : l'échec de la mémorisation ne change pas
      // la réponse (le refus reste exact), il est seulement journalisé.
      const { error: recordError } = await supabase.rpc(
        "record_application_blocker",
        { p_job_id: jobId },
      );
      if (recordError) logServerError("jobs.apply.blocker", recordError);
      // `error` (français) conservé ; `code` et `requirement` permettent
      // à l'interface de traduire le refus (lot 9).
      return NextResponse.json(
        {
          error: documentRequirementMessage(detail),
          code: "document_requirement",
          requirement: detail,
        },
        { status: 403 },
      );
    }
  }

  logServerError("jobs.apply", error);
  return NextResponse.json(
    { error: "Failed to submit application", code: "application_failed" },
    { status: 500 },
  );
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const jobId = jobIdSchema.safeParse(id);
    if (!jobId.success) {
      return NextResponse.json(
        { error: "Application not found" },
        { status: 404 },
      );
    }

    // Lot 12 : journée précise (`?application=<id>`, journées au choix) ;
    // sans paramètre, la candidature à l'offre entière.
    const applicationParam = new URL(request.url).searchParams.get(
      "application",
    );
    const applicationId = applicationParam
      ? z.string().uuid().safeParse(applicationParam)
      : null;
    if (applicationId && !applicationId.success) {
      return NextResponse.json(
        { error: "Application not found", code: "application_not_found" },
        { status: 404 },
      );
    }

    // Retrait : passage contrôlé à `withdrawn` (la ligne est conservée). Un
    // retrait déjà effectué renvoie la ligne inchangée.
    const { data: application, error } = await supabase.rpc(
      "withdraw_job_application",
      {
        p_job_id: jobId.data,
        ...(applicationId?.success
          ? { p_application_id: applicationId.data }
          : {}),
      },
    );

    if (error) {
      const refusal = WITHDRAW_REFUSALS[error.message];
      if (refusal) {
        return NextResponse.json(
          { error: refusal.error, code: error.message },
          { status: refusal.status },
        );
      }
      logServerError("jobs.withdraw", error);
      return NextResponse.json(
        { error: "Failed to cancel application", code: "application_failed" },
        { status: 500 },
      );
    }

    if (application?.status !== "withdrawn") {
      // Statut seul : jamais la ligne (identifiants, données du candidat).
      logServerError("jobs.withdraw", null, {
        category: "unexpected",
        reason: "unexpected_state",
      });
      return NextResponse.json(
        { error: "Failed to cancel application", code: "application_failed" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, application });
  } catch (error) {
    logServerError("jobs.withdraw", error, {
      requestId: requestIdFrom(request.headers),
    });
    return NextResponse.json(
      { error: "Internal server error", code: "application_failed" },
      { status: 500 },
    );
  }
}
