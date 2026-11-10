import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { jobModerationSchema, jobRefusal } from "@/lib/validations/job";
import { JOB_PUBLISHED_STATUS } from "@/lib/utils/job-status";
import { internalErrorResponse } from "@/lib/api/errors";

/**
 * Modération d'une offre en attente (approbation ou refus motivé).
 *
 * Passe par la RPC `moderate_job` en session admin (jamais la clé service) :
 * grade admin_ops/admin_founder vérifié en base, transition contrôlée sur
 * l'état courant sous verrou, champs de modération, notification à
 * l'entreprise et audit_logs écrits dans la même transaction. Une seconde
 * décision (double clic, autre admin) reçoit 409 `job_not_pending`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const jobId = z.string().uuid().safeParse(id);
    if (!jobId.success) {
      return NextResponse.json(
        { error: "Job not found", code: "job_not_found" },
        { status: 404 },
      );
    }

    const parsed = jobModerationSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      const code =
        parsed.error.issues.find((i) => i.path[0] === "reason")?.message ??
        "invalid_action";
      return NextResponse.json({ error: code, code }, { status: 400 });
    }
    const { action, reason, seen_updated_at } = parsed.data;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized", code: "not_authenticated" },
        { status: 401 },
      );
    }

    const { data: job, error } = await supabase.rpc("moderate_job", {
      p_job_id: jobId.data,
      p_action: action,
      p_reason: reason,
      p_seen_updated_at: seen_updated_at,
    });

    if (error) {
      const refusal = jobRefusal(error.message);
      if (refusal) {
        return NextResponse.json(
          { error: refusal.code, code: refusal.code },
          { status: refusal.status },
        );
      }
      return internalErrorResponse("admin.jobs.moderate", error, {
        code: "moderation_failed",
        request,
      });
    }

    // Résultat réel relu dans la ligne renvoyée par la RPC.
    const expected = action === "approve" ? JOB_PUBLISHED_STATUS : "rejected";
    if (job?.status !== expected) {
      return internalErrorResponse("admin.jobs.moderate", null, {
        code: "moderation_failed",
        request,
        reason: "result_mismatch",
      });
    }

    return NextResponse.json({ success: true, status: job.status });
  } catch (error) {
    return internalErrorResponse("admin.jobs.moderate", error, {
      code: "moderation_failed",
      request,
    });
  }
}
