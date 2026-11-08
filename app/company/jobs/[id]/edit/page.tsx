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
import {
  useAccountState,
  useLatestRequest,
  useLiveRefresh,
} from "@/lib/realtime/provider";
import { isNetworkError, readSessionUser } from "@/lib/supabase/session-user";

type EditState =
  | { kind: "loading" }
  | { kind: "ready"; job: JobFormInitial }
  | { kind: "blocked"; message: string };

/**
 * Correction d'une offre par son entreprise. L'écran n'est qu'un confort :
 * `update_job` refuse en base les offres non modifiables.
 *
 * Lot 7d : les droits sont réévalués sur signal (offre modérée, retirée ou
 * pourvue, plan échu, compte suspendu), y compris formulaire ouvert. Tant
 * que la modification reste permise, la saisie en cours est conservée.
 */
export default function EditJobPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const tj = t.companyJobs;
  const account = useAccountState();
  const latest = useLatestRequest();
  // undefined : en cours de lecture ; null : offre introuvable.
  const [job, setJob] = React.useState<
    | (JobFormInitial & {
        status: string | null;
        positions_filled: number | null;
      })
    | null
    | undefined
  >(undefined);

  const loadJob = React.useCallback(async () => {
    const token = latest.begin();
    const supabase = createClient();
    const user = await readSessionUser(supabase);
    if (user === undefined) return;
    if (!user) {
      router.push(`/auth/login?next=/company/jobs/${id}/edit`);
      return;
    }
    const { data, error } = await supabase
      .from("jobs")
      .select(
        `id, title, description, job_type, start_date, end_date,
         start_time, end_time, positions_available, positions_filled,
         mission_pay_per_candidate, required_skills, urgency, status`,
      )
      .eq("id", id)
      .maybeSingle();
    // Réseau indisponible : la saisie et l'état affiché sont conservés.
    if (isNetworkError(error)) return;
    if (latest.isLatest(token)) setJob(data ?? null);
  }, [id, router, latest]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadJob();
  }, [loadJob]);

  useLiveRefresh(["jobs", "applications", "subscription"], loadJob);

  // Plan effectif connu seulement après lecture de l'état du compte.
  const state: EditState = (() => {
    if (job === undefined || account === null) return { kind: "loading" };
    if (job === null)
      return { kind: "blocked", message: tj.errors.job_not_found };
    if (!account.is_active) {
      return { kind: "blocked", message: tj.errors.account_suspended };
    }
    const { directEdit } = getPlanLimits(
      normalizeCompanyPlan(account.company?.effective_plan ?? "free"),
    );
    if (!canEditJob(job, directEdit)) {
      const message =
        job.status !== JOB_PUBLISHED_STATUS
          ? tj.errors.job_not_editable
          : directEdit
            ? tj.errors.job_has_selected_candidates
            : tj.errors.job_locked_plan;
      return { kind: "blocked", message };
    }
    return { kind: "ready", job };
  })();

  // Première version modifiable : le formulaire n'est pas réinitialisé par
  // une relecture tant que la modification reste permise.
  const [initialJob, setInitialJob] = React.useState<JobFormInitial | null>(
    null,
  );
  if (state.kind === "ready" && initialJob === null) {
    setInitialJob(state.job);
  }

  if (state.kind === "ready") {
    return <JobForm initialJob={initialJob ?? state.job} />;
  }

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
