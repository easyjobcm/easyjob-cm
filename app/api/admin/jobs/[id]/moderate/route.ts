import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { action } = await request.json()

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Verify admin role
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { data: userData } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()

    if (userData?.role !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      )
    }

    // Update job status
    const newStatus = action === 'approve' ? 'published' : 'rejected'
    
    const { error } = await supabase
      .from('jobs')
      .update({ 
        status: newStatus,
        moderated_at: new Date().toISOString(),
        moderated_by: user.id,
      })
      .eq('id', id)

    if (error) {
      console.error('Moderation error:', error)
      return NextResponse.json(
        { error: 'Failed to moderate job' },
        { status: 500 }
      )
    }

    // TODO: Send notification to company

    return NextResponse.json({ 
      success: true, 
      status: newStatus 
    })
  } catch (error) {
    console.error('Moderation error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
