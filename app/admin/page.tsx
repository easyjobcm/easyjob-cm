import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AdminDashboardClient } from "./admin-dashboard-client";

export default async function AdminDashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/login?redirect=/admin");
  }

  // Get user data and verify admin role
  const { data: userData } = await supabase
    .from("users")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!userData || userData.role !== "admin") {
    redirect("/");
  }

  // Get pending jobs for moderation
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

  // Get stats
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
      user={userData}
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
