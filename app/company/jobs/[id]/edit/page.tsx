"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { JobForm, type JobFormInitial } from "@/components/company/job-form";
import { useI18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";
import { normalizeCompanyPlan } from "@/lib/utils/company-plan";
import { getPlanLimits } from "@/lib/utils/profile-status";
import { canEditJob, JOB_PUBLISHED_STATUS } from "@/lib/utils/job-status";

type EditState =
  | { kind: "loading" }
  | { kind: "ready"; job: JobFormInitial }
  | { kind: "blocked"; message: string };

/**
 * Correction d'une offre par son entreprise. L'écran n'est qu'un confort :
 * `update_job` refuse en base les offres non modifiables.
 */
export default function EditJobPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const tj = t.companyJobs;
  const [state, setState] = React.useState<EditState>({ kind: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push(`/login?redirect=/company/jobs/${id}/edit`);
        return;
      }

      const [{ data: company }, { data: job }] = await Promise.all([
        supabase
          .from("company_profiles")
          .select("subscription_plan")
          .eq("user_id", user.id)
          .single(),
        supabase
          .from("jobs")
          .select(
            `id, title, description, job_type, start_date, end_date,
             start_time, end_time, positions_available, positions_filled,
             mission_pay_per_candidate, required_skills, urgency, status`,
          )
          .eq("id", id)
          .maybeSingle(),
      ]);
      if (cancelled) return;

      if (!job) {
        setState({ kind: "blocked", message: tj.errors.job_not_found });
        return;
      }
      const { directEdit } = getPlanLimits(
        normalizeCompanyPlan(company?.subscription_plan),
      );
      if (!canEditJob(job, directEdit)) {
        const message =
          job.status !== JOB_PUBLISHED_STATUS
            ? tj.errors.job_not_editable
            : directEdit
              ? tj.errors.job_has_selected_candidates
              : tj.errors.job_locked_plan;
        setState({ kind: "blocked", message });
        return;
      }
      setState({ kind: "ready", job });
    })();
    return () => {
      cancelled = true;
    };
  }, [id, router, tj]);

  if (state.kind === "ready") return <JobForm initialJob={state.job} />;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header title={tj.form.editTitle} showBack onBack={() => router.back()} />
      <div className="px-6 py-6">
        {state.kind === "loading" ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <Card>
            <CardContent className="p-6 space-y-4">
              <p role="alert" className="flex gap-2 text-sm text-foreground">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-warning" />
                <span>{state.message}</span>
              </p>
              <Button asChild variant="outline" className="w-full">
                <Link href="/company/jobs">{tj.title}</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
