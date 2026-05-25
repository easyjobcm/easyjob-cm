import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { DashboardClient } from './dashboard-client'

export default async function CandidateDashboardPage() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    redirect('/login?redirect=/dashboard')
  }

  // Get user data
  const { data: userData } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!userData || userData.role !== 'candidate') {
    redirect('/')
  }

  // Get candidate profile
  const { data: profile } = await supabase
    .from('candidate_profiles')
    .select('*, candidate_skills(*)')
    .eq('user_id', user.id)
    .single()

  // Check if needs onboarding
  if (!profile || profile.onboarding_status !== 'completed') {
    redirect('/onboarding/candidate')
  }

  // Get recent applications
  const { data: applications } = await supabase
    .from('job_applications')
    .select(`
      *,
      job:jobs(
        id,
        title,
        city,
        start_date,
        start_time,
        end_time,
        hourly_rate,
        currency,
        company:company_profiles(company_name, logo_url)
      )
    `)
    .eq('candidate_id', profile.id)
    .order('created_at', { ascending: false })
    .limit(5)

  // Get stats
  const { count: totalApplications } = await supabase
    .from('job_applications')
    .select('*', { count: 'exact', head: true })
    .eq('candidate_id', profile.id)

  const { count: selectedCount } = await supabase
    .from('job_applications')
    .select('*', { count: 'exact', head: true })
    .eq('candidate_id', profile.id)
    .eq('status', 'selected')

  return (
    <DashboardClient 
      user={userData}
      profile={profile}
      applications={applications || []}
      stats={{
        totalApplications: totalApplications || 0,
        selectedCount: selectedCount || 0,
        completedMissions: profile.completed_missions || 0,
        reliabilityScore: profile.reliability_score || 0,
      }}
    />
  )
}
