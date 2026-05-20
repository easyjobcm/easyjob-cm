import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ProfileClient } from './profile-client'

export default async function ProfilePage() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    redirect('/login?redirect=/profile')
  }

  // Get user data
  const { data: userData } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!userData) {
    redirect('/login')
  }

  // Get profile based on role
  let profile = null
  let skills: any[] = []

  if (userData.role === 'candidate') {
    const { data: candidateProfile } = await supabase
      .from('candidate_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single()
    
    profile = candidateProfile

    if (candidateProfile) {
      const { data: candidateSkills } = await supabase
        .from('candidate_skills')
        .select('*')
        .eq('candidate_id', candidateProfile.id)
      
      skills = candidateSkills || []
    }
  } else if (userData.role === 'company') {
    const { data: companyProfile } = await supabase
      .from('company_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single()
    
    profile = companyProfile
  }

  return (
    <ProfileClient 
      user={userData}
      profile={profile}
      skills={skills}
    />
  )
}
