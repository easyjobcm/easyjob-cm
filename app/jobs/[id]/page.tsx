import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { JobDetailClient } from './job-detail-client'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function JobDetailPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()

  // Fetch job with company and category
  const { data: job, error } = await supabase
    .from('jobs')
    .select(`
      *,
      company:company_profiles(
        id, 
        company_name, 
        logo_url, 
        city, 
        sector,
        description
      ),
      category:job_categories(id, name_fr, name_en, icon)
    `)
    .eq('id', id)
    .single()

  if (error || !job) {
    notFound()
  }

  // Check if user has applied
  const { data: { user } } = await supabase.auth.getUser()
  let userApplication = null
  let isFavorite = false

  if (user) {
    const { data: candidateProfile } = await supabase
      .from('candidate_profiles')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (candidateProfile) {
      const { data: application } = await supabase
        .from('job_applications')
        .select('id, status, created_at')
        .eq('job_id', id)
        .eq('candidate_id', candidateProfile.id)
        .single()

      userApplication = application

      const { data: favorite } = await supabase
        .from('job_favorites')
        .select('id')
        .eq('job_id', id)
        .eq('candidate_id', candidateProfile.id)
        .single()

      isFavorite = !!favorite
    }
  }

  return (
    <JobDetailClient 
      job={job} 
      userApplication={userApplication}
      isFavorite={isFavorite}
      isLoggedIn={!!user}
    />
  )
}
