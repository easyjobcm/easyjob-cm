import { createClient } from "@/lib/supabase/server";
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

  // Offres en attente de modération
  const { data: pendingJobs } = await supabase
    .from("jobs")
    .select(
      `
      *,
      company:company_profiles(id, company_name, logo_url)
    `,
    )
    .eq("status", "pending_review")
    .order("created_at", { ascending: true })
    .limit(20);

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
    .eq("status", "published");

  const { count: totalApplications } = await supabase
    .from("job_applications")
    .select("*", { count: "exact", head: true });

  return (
    <AdminDashboardClient
      pendingJobs={pendingJobs || []}
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
