'use client'

import * as React from 'react'
import Link from 'next/link'
import { AppShell } from '@/components/layout/app-shell'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'
import { formatCurrency, formatDate, formatTime } from '@/lib/utils'
import {
  User,
  Briefcase,
  TrendingUp,
  Star,
  Clock,
  MapPin,
  ChevronRight,
  Bell,
  Calendar,
  CheckCircle2,
  AlertCircle,
  ArrowRight
} from 'lucide-react'

interface DashboardClientProps {
  user: any
  profile: any
  applications: any[]
  stats: {
    totalApplications: number
    selectedCount: number
    completedMissions: number
    reliabilityScore: number
  }
}

export function DashboardClient({ user, profile, applications, stats }: DashboardClientProps) {
  const { t, locale } = useI18n()

  const getGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return locale === 'fr' ? 'Bonjour' : 'Good morning'
    if (hour < 18) return locale === 'fr' ? 'Bon apres-midi' : 'Good afternoon'
    return locale === 'fr' ? 'Bonsoir' : 'Good evening'
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="secondary">{locale === 'fr' ? 'En attente' : 'Pending'}</Badge>
      case 'shortlisted':
        return <Badge variant="warning">{locale === 'fr' ? 'Preselectionne' : 'Shortlisted'}</Badge>
      case 'selected':
        return <Badge variant="success">{locale === 'fr' ? 'Selectionne' : 'Selected'}</Badge>
      case 'rejected':
        return <Badge variant="destructive">{locale === 'fr' ? 'Non retenu' : 'Not selected'}</Badge>
      default:
        return <Badge variant="secondary">{status}</Badge>
    }
  }

  return (
    <AppShell>
      <div className="px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {getGreeting()}, {profile.first_name || user.phone}!
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              {locale === 'fr' ? 'Voici votre tableau de bord' : 'Here is your dashboard'}
            </p>
          </div>
          <Link href="/notifications">
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-primary rounded-full" />
            </Button>
          </Link>
        </div>

        {/* Sandbox notice */}
        {profile.is_sandbox && (
          <Card className="border-warning/30 bg-warning/5">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium text-foreground">
                    {locale === 'fr' ? 'Mode Sandbox actif' : 'Sandbox mode active'}
                  </p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {locale === 'fr' 
                      ? `Completez ${3 - profile.sandbox_missions_completed} missions sandbox pour acceder aux vraies offres.`
                      : `Complete ${3 - profile.sandbox_missions_completed} sandbox missions to access real jobs.`}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-3">
          <Card className="bg-gradient-to-br from-primary/10 to-primary/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-2 rounded-lg bg-primary/20">
                  <Briefcase className="w-4 h-4 text-primary" />
                </div>
              </div>
              <p className="text-2xl font-bold text-foreground">{stats.completedMissions}</p>
              <p className="text-xs text-muted-foreground">
                {locale === 'fr' ? 'Missions terminees' : 'Completed missions'}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-success/10 to-success/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-2 rounded-lg bg-success/20">
                  <Star className="w-4 h-4 text-success" />
                </div>
              </div>
              <p className="text-2xl font-bold text-foreground">
                {stats.reliabilityScore.toFixed(1)}
              </p>
              <p className="text-xs text-muted-foreground">
                {locale === 'fr' ? 'Score fiabilite' : 'Reliability score'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-2 rounded-lg bg-muted">
                  <TrendingUp className="w-4 h-4 text-muted-foreground" />
                </div>
              </div>
              <p className="text-2xl font-bold text-foreground">{stats.totalApplications}</p>
              <p className="text-xs text-muted-foreground">
                {locale === 'fr' ? 'Candidatures' : 'Applications'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-2 rounded-lg bg-muted">
                  <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
                </div>
              </div>
              <p className="text-2xl font-bold text-foreground">{stats.selectedCount}</p>
              <p className="text-xs text-muted-foreground">
                {locale === 'fr' ? 'Selections' : 'Selected'}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-3">
            {locale === 'fr' ? 'Actions rapides' : 'Quick actions'}
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <Link href="/jobs">
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Briefcase className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-foreground text-sm">
                      {locale === 'fr' ? 'Chercher un job' : 'Find a job'}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>

            <Link href="/profile">
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-secondary">
                    <User className="w-5 h-5 text-secondary-foreground" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-foreground text-sm">
                      {locale === 'fr' ? 'Mon profil' : 'My profile'}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          </div>
        </div>

        {/* Recent Applications */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-foreground">
              {locale === 'fr' ? 'Candidatures recentes' : 'Recent applications'}
            </h2>
            <Link 
              href="/dashboard/applications"
              className="text-sm text-primary font-medium flex items-center gap-1"
            >
              {locale === 'fr' ? 'Tout voir' : 'See all'}
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          {applications.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Briefcase className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">
                  {locale === 'fr' 
                    ? 'Aucune candidature pour le moment'
                    : 'No applications yet'}
                </p>
                <Link href="/jobs">
                  <Button className="mt-4">
                    {locale === 'fr' ? 'Trouver un job' : 'Find a job'}
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {applications.map((app) => (
                <Link key={app.id} href={`/jobs/${app.job?.id}`}>
                  <Card className="hover:shadow-md transition-all">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            {getStatusBadge(app.status)}
                          </div>
                          <h3 className="font-medium text-foreground truncate">
                            {app.job?.title}
                          </h3>
                          <p className="text-sm text-muted-foreground truncate">
                            {app.job?.company?.company_name}
                          </p>
                        </div>
                        <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
                      </div>

                      <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" />
                          {formatDate(app.job?.start_date, locale)}
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {formatTime(app.job?.start_time)}
                        </div>
                        <div className="flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5" />
                          {app.job?.city}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
