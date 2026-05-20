'use client'

import * as React from 'react'
import { AppShell } from '@/components/layout/app-shell'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useTranslation } from '@/lib/i18n'
import Link from 'next/link'
import { 
  Briefcase, 
  Users, 
  Clock, 
  TrendingUp, 
  Plus,
  ChevronRight,
  Calendar,
  MapPin,
  Eye
} from 'lucide-react'

// Mock data for demonstration
const mockStats = {
  activeJobs: 3,
  totalApplications: 47,
  pendingApplications: 12,
  completedMissions: 28,
}

const mockRecentJobs = [
  {
    id: '1',
    title: 'Serveur/Serveuse Restaurant',
    date: '2026-05-22',
    startTime: '18:00',
    applications: 8,
    status: 'active',
  },
  {
    id: '2',
    title: 'Agent de Securite',
    date: '2026-05-25',
    startTime: '08:00',
    applications: 15,
    status: 'active',
  },
  {
    id: '3',
    title: 'Hotesse d\'accueil',
    date: '2026-05-20',
    startTime: '09:00',
    applications: 24,
    status: 'completed',
  },
]

export default function CompanyDashboardPage() {
  const { locale } = useTranslation()

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', {
      day: 'numeric',
      month: 'short',
    })
  }

  const stats = [
    {
      title: locale === 'fr' ? 'Offres actives' : 'Active jobs',
      value: mockStats.activeJobs,
      icon: Briefcase,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
    },
    {
      title: locale === 'fr' ? 'Candidatures' : 'Applications',
      value: mockStats.pendingApplications,
      icon: Users,
      color: 'text-accent',
      bgColor: 'bg-accent/10',
      badge: mockStats.pendingApplications > 0 ? 'new' : null,
    },
    {
      title: locale === 'fr' ? 'En attente' : 'Pending',
      value: mockStats.pendingApplications,
      icon: Clock,
      color: 'text-warning',
      bgColor: 'bg-warning/10',
    },
    {
      title: locale === 'fr' ? 'Terminees' : 'Completed',
      value: mockStats.completedMissions,
      icon: TrendingUp,
      color: 'text-success',
      bgColor: 'bg-success/10',
    },
  ]

  return (
    <AppShell userRole="company">
      <div className="px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {locale === 'fr' ? 'Tableau de bord' : 'Dashboard'}
            </h1>
            <p className="text-muted-foreground text-sm">
              {locale === 'fr' ? 'Bienvenue, Le Gourmet' : 'Welcome, Le Gourmet'}
            </p>
          </div>
          <Link href="/company/jobs/new">
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              {locale === 'fr' ? 'Publier' : 'Post'}
            </Button>
          </Link>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          {stats.map((stat, index) => (
            <Card key={index} className="relative overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${stat.bgColor}`}>
                    <stat.icon className={`h-5 w-5 ${stat.color}`} />
                  </div>
                  {stat.badge && (
                    <Badge variant="destructive" className="text-[10px] h-5">
                      {stat.badge}
                    </Badge>
                  )}
                </div>
                <p className="text-2xl font-bold mt-3 text-foreground">{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.title}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Quick Actions */}
        <Card className="mb-6 bg-gradient-primary text-white">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">
                  {locale === 'fr' ? 'Besoin de personnel ?' : 'Need staff?'}
                </h3>
                <p className="text-sm text-white/80 mt-1">
                  {locale === 'fr' 
                    ? 'Publiez une offre en quelques minutes'
                    : 'Post a job in minutes'}
                </p>
              </div>
              <Link href="/company/jobs/new">
                <Button variant="secondary" size="sm">
                  {locale === 'fr' ? 'Publier une offre' : 'Post a job'}
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Recent Jobs */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-primary uppercase tracking-wider">
              {locale === 'fr' ? 'Offres recentes' : 'Recent jobs'}
            </h2>
            <Link href="/company/jobs" className="text-sm text-primary hover:underline">
              {locale === 'fr' ? 'Voir tout' : 'View all'}
            </Link>
          </div>
          
          <div className="space-y-3">
            {mockRecentJobs.map((job) => (
              <Link key={job.id} href={`/company/jobs/${job.id}`}>
                <Card className="hover:shadow-md transition-all">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-medium text-foreground truncate">
                            {job.title}
                          </h3>
                          <Badge 
                            variant={job.status === 'active' ? 'success' : 'secondary'}
                            className="text-[10px]"
                          >
                            {job.status === 'active' 
                              ? (locale === 'fr' ? 'Actif' : 'Active')
                              : (locale === 'fr' ? 'Termine' : 'Completed')}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5" />
                            {formatDate(job.date)}
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            {job.startTime}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Users className="h-4 w-4" />
                          <span>{job.applications}</span>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>

        {/* Pending Applications Alert */}
        {mockStats.pendingApplications > 0 && (
          <Card className="border-warning/50 bg-warning/5">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-warning/20">
                    <Clock className="h-5 w-5 text-warning" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">
                      {mockStats.pendingApplications} {locale === 'fr' ? 'candidatures en attente' : 'pending applications'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {locale === 'fr' 
                        ? 'Repondez rapidement pour trouver les meilleurs profils'
                        : 'Respond quickly to find the best profiles'}
                    </p>
                  </div>
                </div>
                <Link href="/company/applications">
                  <Button variant="outline" size="sm">
                    <Eye className="h-4 w-4 mr-1" />
                    {locale === 'fr' ? 'Voir' : 'View'}
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  )
}
