import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { OnboardingClient } from './onboarding-client'

export default async function CandidateOnboardingPage() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    redirect('/login?redirect=/onboarding/candidate')
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

  // Get or create candidate profile
  let { data: profile } = await supabase
    .from('candidate_profiles')
    .select('*')
    .eq('user_id', user.id)
    .single()

  // If profile doesn't exist, create it
  if (!profile) {
    const { data: newProfile } = await supabase
      .from('candidate_profiles')
      .insert({
        user_id: user.id,
        onboarding_status: 'in_progress',
        onboarding_step: 1,
      })
      .select()
      .single()
    profile = newProfile
  }

  // If onboarding is already completed, redirect to dashboard
  if (profile?.onboarding_status === 'completed') {
    redirect('/dashboard')
  }

  // Get job categories for skills selection
  const { data: categories } = await supabase
    .from('job_categories')
    .select('*')
    .eq('is_active', true)
    .order('sort_order')

  return (
    <OnboardingClient 
      user={userData}
      profile={profile}
      categories={categories || []}
    />
  )
}
