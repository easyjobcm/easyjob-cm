'use client'

import * as React from 'react'
import { AppShell } from '@/components/layout/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useTranslation } from '@/lib/i18n'
import { Briefcase, Search, ChevronRight, MapPin, Clock, Calendar, Building2, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import useSWR from 'swr'

type TabType = 'applied' | 'booked' | 'completed'

interface Application {
  id: string
  status: string
  created_at: string
  job: {
    id: string
    title: string
    city: string
    hourly_rate: number
    start_date: string
    start_time: string
    end_time: string
    company: {
      company_name: string
    }
  }
}

interface Mission {
  id: string
  status: string
  scheduled_date: string
  scheduled_start_time: string
  scheduled_end_time: string
  job: {
    id: string
    title: string
    city: string
    hourly_rate: number
    company: {
      company_name: string
    }
  }
}

const fetcher = async (url: string) => {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) return { applications: [], missions: [] }
  
  // Get candidate profile
  const { data: profile } = await supabase
    .from('candidate_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()
  
  if (!profile) return { applications: [], missions: [] }
  
  // Get applications
  const { data: applications } = await supabase
    .from('job_applications')
    .select(`
      id,
      status,
      created_at,
      job:jobs (
        id,
        title,
        city,
        hourly_rate,
        start_date,
        start_time,
        end_time,
        company:company_profiles (
          company_name
        )
      )
    `)
    .eq('candidate_id', profile.id)
    .order('created_at', { ascending: false })
  
  // Get missions
  const { data: missions } = await supabase
    .from('missions')
    .select(`
      id,
      status,
      scheduled_date,
      scheduled_start_time,
      scheduled_end_time,
      job:jobs (
        id,
        title,
        city,
        hourly_rate,
        company:company_profiles (
          company_name
        )
      )
    `)
    .eq('candidate_id', profile.id)
    .order('scheduled_date', { ascending: false })
  
  return {
    applications: applications || [],
    missions: missions || []
  }
}

export default function MyJobsPage() {
  const { locale } = useTranslation()
  const [activeTab, setActiveTab] = React.useState<TabType>('applied')
  const { data, isLoading } = useSWR('/api/my-jobs', fetcher)

  const tabs: { id: TabType; label: string; labelEn: string }[] = [
    { id: 'applied', label: 'Candidatures', labelEn: 'Applied' },
    { id: 'booked', label: 'Reservees', labelEn: 'Booked' },
    { id: 'completed', label: 'Terminees', labelEn: 'Completed' },
  ]

  const applications = (data?.applications || []) as unknown as Application[]
  const missions = (data?.missions || []) as unknown as Mission[]
  
  const pendingApplications = applications.filter((a) => 
    ['pending', 'shortlisted'].includes(a.status)
  )
  const bookedMissions = missions.filter((m) => 
    ['pending', 'confirmed', 'in_progress'].includes(m.status)
  )
  const completedMissions = missions.filter((m) => 
    m.status === 'completed'
  )

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'destructive' }> = {
      pending: { label: locale === 'fr' ? 'En attente' : 'Pending', variant: 'warning' },
      shortlisted: { label: locale === 'fr' ? 'Preselectionne' : 'Shortlisted', variant: 'default' },
      selected: { label: locale === 'fr' ? 'Selectionne' : 'Selected', variant: 'success' },
      rejected: { label: locale === 'fr' ? 'Refuse' : 'Rejected', variant: 'destructive' },
      confirmed: { label: locale === 'fr' ? 'Confirme' : 'Confirmed', variant: 'success' },
      in_progress: { label: locale === 'fr' ? 'En cours' : 'In Progress', variant: 'default' },
      completed: { label: locale === 'fr' ? 'Termine' : 'Completed', variant: 'success' },
    }
    const config = statusMap[status] || { label: status, variant: 'default' as const }
    return <Badge variant={config.variant}>{config.label}</Badge>
  }

  const renderEmptyState = () => (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="relative mb-6">
        <div className="h-24 w-24 rounded-3xl bg-gradient-to-br from-primary/10 to-accent/10 flex items-center justify-center border-2 border-primary/20">
          <Briefcase className="h-10 w-10 text-primary/60" />
          <Search className="h-6 w-6 text-primary absolute -bottom-1 -right-1 bg-card rounded-full p-1" />
        </div>
      </div>
      
      <h2 className="text-xl font-semibold text-foreground mb-2">
        {locale === 'fr' ? 'Trouvez votre prochain job !' : 'Find your next job!'}
      </h2>
      <p className="text-muted-foreground max-w-xs mb-6">
        {activeTab === 'applied' && (
          locale === 'fr'
            ? "Vous n'avez pas encore postule a des offres."
            : "You haven't applied to any jobs yet."
        )}
        {activeTab === 'booked' && (
          locale === 'fr'
            ? 'Aucune mission reservee pour le moment.'
            : 'No booked jobs at the moment.'
        )}
        {activeTab === 'completed' && (
          locale === 'fr'
            ? 'Vos missions terminees apparaitront ici.'
            : 'Your completed jobs will appear here.'
        )}
      </p>
      
      <Link href="/jobs">
        <Button>
          {locale === 'fr' ? 'Parcourir les offres' : 'Browse jobs'}
          <ChevronRight className="ml-2 h-4 w-4" />
        </Button>
      </Link>
    </div>
  )

  const renderApplicationCard = (application: Application) => (
    <Link key={application.id} href={`/jobs/${application.job?.id}`}>
      <Card className="hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="flex justify-between items-start mb-2">
            <h3 className="font-semibold text-foreground">{application.job?.title}</h3>
            {getStatusBadge(application.status)}
          </div>
          <div className="flex items-center gap-1 text-sm text-muted-foreground mb-2">
            <Building2 className="h-4 w-4" />
            <span>{application.job?.company?.company_name}</span>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <MapPin className="h-4 w-4" />
              <span>{application.job?.city}</span>
            </div>
            <div className="flex items-center gap-1">
              <Calendar className="h-4 w-4" />
              <span>{formatDate(application.job?.start_date, locale)}</span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-border flex justify-between items-center">
            <span className="font-semibold text-primary">
              {formatCurrency(application.job?.hourly_rate || 0)}/h
            </span>
            <span className="text-xs text-muted-foreground">
              {locale === 'fr' ? 'Postule le' : 'Applied on'} {formatDate(application.created_at, locale)}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  )

  const renderMissionCard = (mission: Mission) => (
    <Link key={mission.id} href={`/missions/${mission.id}`}>
      <Card className="hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="flex justify-between items-start mb-2">
            <h3 className="font-semibold text-foreground">{mission.job?.title}</h3>
            {getStatusBadge(mission.status)}
          </div>
          <div className="flex items-center gap-1 text-sm text-muted-foreground mb-2">
            <Building2 className="h-4 w-4" />
            <span>{mission.job?.company?.company_name}</span>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <MapPin className="h-4 w-4" />
              <span>{mission.job?.city}</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              <span>{mission.scheduled_start_time?.slice(0, 5)} - {mission.scheduled_end_time?.slice(0, 5)}</span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-border flex justify-between items-center">
            <span className="font-semibold text-primary">
              {formatCurrency(mission.job?.hourly_rate || 0)}/h
            </span>
            <span className="text-sm font-medium text-foreground">
              {formatDate(mission.scheduled_date, locale)}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  )

  return (
    <AppShell>
      <div className="px-4 py-6">
        <h1 className="text-2xl font-bold text-foreground italic mb-6">
          {locale === 'fr' ? 'Mes Jobs' : 'My Jobs'}
        </h1>

        {/* Tabs */}
        <div className="flex border-b border-border mb-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex-1 py-3 text-sm font-medium transition-all relative',
                activeTab === tab.id
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {locale === 'fr' ? tab.label : tab.labelEn}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {activeTab === 'applied' && (
              pendingApplications.length > 0 ? (
                <div className="space-y-3">
                  {pendingApplications.map(renderApplicationCard)}
                </div>
              ) : renderEmptyState()
            )}
            
            {activeTab === 'booked' && (
              bookedMissions.length > 0 ? (
                <div className="space-y-3">
                  {bookedMissions.map(renderMissionCard)}
                </div>
              ) : renderEmptyState()
            )}
            
            {activeTab === 'completed' && (
              completedMissions.length > 0 ? (
                <div className="space-y-3">
                  {completedMissions.map(renderMissionCard)}
                </div>
              ) : renderEmptyState()
            )}
          </>
        )}
      </div>
    </AppShell>
  )
}
