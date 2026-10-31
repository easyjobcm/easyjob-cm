import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  documentRequirementMessage,
  parseDocumentRequirementDetail,
} from "@/lib/matching/skill-document-requirements";
import { checkEssentialCriteria } from "@/lib/utils/profile-completion";

// Les règles de candidature et de retrait sont appliquées en base par les
// RPC `apply_to_job` et `withdraw_job_application` (migration
// 20261031130000, SECURITY DEFINER, candidat déduit de la session). Un appel
// PostgREST direct rencontre donc les mêmes refus. Cette route ne fait que
// traduire leurs codes en réponses HTTP, inchangées pour l'interface.
//
// T8.3 — le gate de vérification porte sur `users.is_verified` (SRS §6.6 /
// §11.5). `checkEssentialCriteria` ne sert qu'à lister les champs manquants.

const jobIdSchema = z.string().uuid();

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
  sandbox_level_too_low: {
    status: 403,
    error: "Your sandbox level is too low for this job",
  },
  no_positions: { status: 400, error: "No positions available" },
  already_applied: { status: 400, error: "Already applied to this job" },
};

const WITHDRAW_REFUSALS: Record<string, { status: number; error: string }> = {
  not_authenticated: { status: 401, error: "Unauthorized" },
  application_not_found: { status: 404, error: "Application not found" },
  application_not_withdrawable: {
    status: 409,
    error: "Only pending applications can be cancelled",
  },
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

    const { data: application, error } = await supabase.rpc("apply_to_job", {
      p_job_id: jobId.data,
    });

    if (error) {
      return applyRefusalResponse(supabase, user.id, error);
    }

    // TODO: Send notification to company
    return NextResponse.json({ success: true, application });
  } catch (error) {
    console.error("Application error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

async function applyRefusalResponse(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  error: RpcError,
) {
  const refusal = APPLY_REFUSALS[error.message];
  if (refusal) {
    return NextResponse.json(
      { error: refusal.error, code: error.message },
      { status: refusal.status },
    );
  }

  if (error.message === "account_suspended") {
    return NextResponse.json(
      { error: "Votre compte est suspendu", code: "account_suspended" },
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
      return NextResponse.json(
        { error: documentRequirementMessage(detail) },
        { status: 403 },
      );
    }
  }

  console.error("Application error:", error);
  return NextResponse.json(
    { error: "Failed to submit application" },
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

    // Retrait : passage contrôlé à `withdrawn` (la ligne est conservée). Un
    // retrait déjà effectué renvoie la ligne inchangée.
    const { data: application, error } = await supabase.rpc(
      "withdraw_job_application",
      { p_job_id: jobId.data },
    );

    if (error) {
      const refusal = WITHDRAW_REFUSALS[error.message];
      if (refusal) {
        return NextResponse.json(
          { error: refusal.error },
          { status: refusal.status },
        );
      }
      console.error("Cancel application error:", error);
      return NextResponse.json(
        { error: "Failed to cancel application" },
        { status: 500 },
      );
    }

    if (application?.status !== "withdrawn") {
      console.error("Cancel application: unexpected state", application);
      return NextResponse.json(
        { error: "Failed to cancel application" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, application });
  } catch (error) {
    console.error("Cancel application error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
