import { createAdminClient, createClient } from "@/lib/supabase/server";
import { AdminDashboardClient } from "../admin-dashboard-client";

/**
 * T8.1 — Page dashboard admin.
 *
 * La garde de rôle admin (connexion + rôle admin_*) est assurée
 * par `app/admin/layout.tsx` ; ce composant ne fait qu'extraire
 * les données et les transmettre au client.
 */
export default async function AdminDashboardPage() {
  const supabase = await createClient();

  // Offres en attente de modération (policy « Admins can view all jobs »).
  const { data: jobRows } = await supabase
    .from("jobs")
    .select(
      `id, company_id, title, description, city, start_date, end_date,
       start_time, end_time, mission_pay_per_candidate, positions_available,
       urgency, updated_at`,
    )
    .eq("status", "pending_review")
    .order("created_at", { ascending: true })
    .limit(20);

  // company_profiles n'a pas de policy SELECT admin : nom seul, lu par la
  // clé service (même principe que /api/admin/companies), et uniquement pour
  // les offres que la session a pu lire sous RLS.
  const companyIds = [...new Set((jobRows ?? []).map((j) => j.company_id))];
  const { data: companies } = companyIds.length
    ? await createAdminClient()
        .from("company_profiles")
        .select("id, company_name")
        .in("id", companyIds)
    : { data: [] };
  const companyNames = new Map(
    (companies ?? []).map((c) => [c.id, c.company_name]),
  );
  const pendingJobs = (jobRows ?? []).map(({ company_id, ...job }) => ({
    ...job,
    company: { company_name: companyNames.get(company_id) },
  }));

  // Statistiques globales
  const { count: totalUsers } = await supabase
    .from("users")
    .select("*", { count: "exact", head: true });

  const { count: totalCandidates } = await supabase
    .from("users")
    .select("*", { count: "exact", head: true })
    .eq("role", "candidate");

  const { count: totalCompanies } = await supabase
    .from("users")
    .select("*", { count: "exact", head: true })
    .eq("role", "company");

  const { count: totalJobs } = await supabase
    .from("jobs")
    .select("*", { count: "exact", head: true });

  const { count: pendingJobsCount } = await supabase
    .from("jobs")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending_review");

  const { count: activeJobs } = await supabase
    .from("jobs")
    .select("*", { count: "exact", head: true })
    .eq("status", "active");

  const { count: totalApplications } = await supabase
    .from("job_applications")
    .select("*", { count: "exact", head: true });

  return (
    <AdminDashboardClient
      pendingJobs={pendingJobs}
      stats={{
        totalUsers: totalUsers || 0,
        totalCandidates: totalCandidates || 0,
        totalCompanies: totalCompanies || 0,
        totalJobs: totalJobs || 0,
        pendingJobs: pendingJobsCount || 0,
        activeJobs: activeJobs || 0,
        totalApplications: totalApplications || 0,
      }}
    />
  );
}
