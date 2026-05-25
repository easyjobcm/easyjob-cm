import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { CompanyDashboardClient } from './company-dashboard-client'

export default async function CompanyDashboardPage() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    redirect('/login?redirect=/company/dashboard')
  }

  // Get user data
  const { data: userData } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!userData || userData.role !== 'company') {
    redirect('/')
  }

  // Get company profile
  const { data: profile } = await supabase
    .from('company_profiles')
    .select('*')
    .eq('user_id', user.id)
    .single()

  // Check if needs onboarding
  if (!profile || profile.onboarding_status !== 'completed') {
    redirect('/onboarding/company')
  }

  // Get company's jobs with application count
  const { data: jobs } = await supabase
    .from('jobs')
    .select(`
      *,
      category:job_categories(id, name_fr, name_en, icon)
    `)
    .eq('company_id', profile.id)
    .order('created_at', { ascending: false })
    .limit(10)

  // Get application counts for each job
  const jobsWithCounts = await Promise.all(
    (jobs || []).map(async (job) => {
      const { count } = await supabase
        .from('job_applications')
        .select('*', { count: 'exact', head: true })
        .eq('job_id', job.id)
      
      return { ...job, applicationCount: count || 0 }
    })
  )

  // Get stats
  const { count: totalJobs } = await supabase
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', profile.id)

  const { count: activeJobs } = await supabase
    .from('jobs')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', profile.id)
    .eq('status', 'published')

  // Get total applications for all company jobs
  const { data: companyJobs } = await supabase
    .from('jobs')
    .select('id')
    .eq('company_id', profile.id)

  const jobIds = companyJobs?.map(j => j.id) || []
  
  let totalApplications = 0
  let pendingApplications = 0

  if (jobIds.length > 0) {
    const { count: total } = await supabase
      .from('job_applications')
      .select('*', { count: 'exact', head: true })
      .in('job_id', jobIds)
    
    const { count: pending } = await supabase
      .from('job_applications')
      .select('*', { count: 'exact', head: true })
      .in('job_id', jobIds)
      .eq('status', 'pending')
    
    totalApplications = total || 0
    pendingApplications = pending || 0
  }

  return (
    <CompanyDashboardClient 
      user={userData}
      profile={profile}
      jobs={jobsWithCounts}
      stats={{
        totalJobs: totalJobs || 0,
        activeJobs: activeJobs || 0,
        totalApplications,
        pendingApplications,
      }}
    />
  )
}
