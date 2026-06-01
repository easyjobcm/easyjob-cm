import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: jobId } = await params;
    const supabase = await createClient();

    // Get authenticated user
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get candidate profile (include fields required for SRS validation)
    const { data: candidateProfile } = await supabase
      .from("candidate_profiles")
      .select("id, onboarding_status, profile_completion_pct, sandbox_level")
      .eq("user_id", user.id)
      .single();

    if (!candidateProfile) {
      return NextResponse.json(
        { error: "Candidate profile not found" },
        { status: 404 },
      );
    }

    if (candidateProfile.onboarding_status !== "completed") {
      return NextResponse.json(
        { error: "Please complete your profile first" },
        { status: 400 },
      );
    }

    // SRS §6.6 — complétude minimale 60%
    if ((candidateProfile.profile_completion_pct ?? 0) < 60) {
      return NextResponse.json(
        { error: "Profile must be at least 60% complete to apply" },
        { status: 400 },
      );
    }

    // Check if job exists and is active (SRS ENUM: active, not published)
    const { data: job } = await supabase
      .from("jobs")
      .select("id, status, positions_available, positions_filled, sandbox_level_required")
      .eq("id", jobId)
      .single();

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.status !== "active") {
      return NextResponse.json(
        { error: "Job is not available" },
        { status: 400 },
      );
    }

    // SRS §5.2 — vérification du niveau Sandbox requis
    if (
      (job.sandbox_level_required ?? 0) >
      (candidateProfile.sandbox_level ?? 0)
    ) {
      return NextResponse.json(
        { error: "Your sandbox level is too low for this job" },
        { status: 403 },
      );
    }

    if (job.positions_filled >= job.positions_available) {
      return NextResponse.json(
        { error: "No positions available" },
        { status: 400 },
      );
    }

    // Check if already applied
    const { data: existingApplication } = await supabase
      .from("job_applications")
      .select("id")
      .eq("job_id", jobId)
      .eq("candidate_id", candidateProfile.id)
      .single();

    if (existingApplication) {
      return NextResponse.json(
        { error: "Already applied to this job" },
        { status: 400 },
      );
    }

    // Create application
    const { data: application, error } = await supabase
      .from("job_applications")
      .insert({
        job_id: jobId,
        candidate_id: candidateProfile.id,
        status: "pending",
      })
      .select()
      .single();

    if (error) {
      console.error("Application error:", error);
      return NextResponse.json(
        { error: "Failed to submit application" },
        { status: 500 },
      );
    }

    // TODO: Send notification to company
    // TODO: Update job application count

    return NextResponse.json({
      success: true,
      application,
    });
  } catch (error) {
    console.error("Application error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: jobId } = await params;
    const supabase = await createClient();

    // Get authenticated user
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get candidate profile
    const { data: candidateProfile } = await supabase
      .from("candidate_profiles")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!candidateProfile) {
      return NextResponse.json(
        { error: "Candidate profile not found" },
        { status: 404 },
      );
    }

    // Delete application
    const { error } = await supabase
      .from("job_applications")
      .delete()
      .eq("job_id", jobId)
      .eq("candidate_id", candidateProfile.id)
      .eq("status", "pending"); // Can only cancel pending applications

    if (error) {
      console.error("Cancel application error:", error);
      return NextResponse.json(
        { error: "Failed to cancel application" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Cancel application error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
