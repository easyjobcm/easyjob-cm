import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// Get a single job by ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

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

    if (error) {
      console.error('Error fetching job:', error)
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Check if user has already applied
    const { data: { user } } = await supabase.auth.getUser()
    let hasApplied = false
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
          .select('id, status')
          .eq('job_id', id)
          .eq('candidate_id', candidateProfile.id)
          .single()

        hasApplied = !!application

        const { data: favorite } = await supabase
          .from('job_favorites')
          .select('id')
          .eq('job_id', id)
          .eq('candidate_id', candidateProfile.id)
          .single()

        isFavorite = !!favorite
      }
    }

    return NextResponse.json({ 
      job,
      userStatus: {
        hasApplied,
        isFavorite
      }
    })
  } catch (error) {
    console.error('Error in job detail API:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
