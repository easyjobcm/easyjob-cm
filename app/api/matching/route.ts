import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { findMatchingCandidates, calculateMatchScore } from "@/lib/matching/ai-matching"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const jobId = searchParams.get('jobId')
    const candidateId = searchParams.get('candidateId')
    const limit = parseInt(searchParams.get('limit') || '20')

    // If both jobId and candidateId are provided, calculate specific match
    if (jobId && candidateId) {
      const result = await calculateMatchScore({ jobId, candidateId })
      return NextResponse.json(result)
    }

    // If only jobId is provided, find matching candidates
    if (jobId) {
      // Verify user owns this job
      const { data: company } = await supabase
        .from('company_profiles')
        .select('id')
        .eq('user_id', user.id)
        .single()

      if (!company) {
        return NextResponse.json({ error: "Profil entreprise non trouve" }, { status: 404 })
      }

      const { data: job } = await supabase
        .from('jobs')
        .select('company_id')
        .eq('id', jobId)
        .single()

      if (!job || job.company_id !== company.id) {
        return NextResponse.json({ error: "Offre non trouvee" }, { status: 404 })
      }

      const matches = await findMatchingCandidates(jobId, limit)
      
      // Enrich with candidate data
      const candidateIds = matches.map(m => m.candidateId)
      const { data: candidates } = await supabase
        .from('candidate_profiles')
        .select(`
          id,
          first_name,
          last_name,
          profile_photo_url,
          city,
          reliability_score,
          completed_missions,
          skills:candidate_skills(skill_name)
        `)
        .in('id', candidateIds)

      const enrichedMatches = matches.map(match => {
        const candidate = candidates?.find(c => c.id === match.candidateId)
        return {
          ...match,
          candidate
        }
      })

      return NextResponse.json({ matches: enrichedMatches })
    }

    return NextResponse.json({ error: "jobId requis" }, { status: 400 })
  } catch (error) {
    console.error('[v0] Matching error:', error)
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 })
  }
}

// Suggest jobs for a candidate
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 })
    }

    // Get candidate profile
    const { data: candidate } = await supabase
      .from('candidate_profiles')
      .select('id, city, latitude, longitude, max_travel_distance_km')
      .eq('user_id', user.id)
      .single()

    if (!candidate) {
      return NextResponse.json({ error: "Profil candidat non trouve" }, { status: 404 })
    }

    // Get published jobs in candidate's city or nearby
    const { data: jobs } = await supabase
      .from('jobs')
      .select(`
        id,
        title,
        city,
        hourly_rate,
        start_date,
        start_time,
        end_time,
        positions_available,
        positions_filled,
        company:company_profiles(company_name)
      `)
      .eq('status', 'published')
      .gte('start_date', new Date().toISOString().split('T')[0])
      .order('start_date', { ascending: true })
      .limit(50)

    if (!jobs || jobs.length === 0) {
      return NextResponse.json({ suggestions: [] })
    }

    // Calculate match scores for each job
    const suggestionsWithScores = await Promise.all(
      jobs.map(async (job) => {
        const match = await calculateMatchScore({
          candidateId: candidate.id,
          jobId: job.id
        })
        return {
          job,
          score: match.score,
          reasons: match.reasons
        }
      })
    )

    // Sort by score and filter
    const suggestions = suggestionsWithScores
      .filter(s => s.score >= 40) // Minimum threshold
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)

    return NextResponse.json({ suggestions })
  } catch (error) {
    console.error('[v0] Job suggestions error:', error)
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 })
  }
}
