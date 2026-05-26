'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { LoadingSpinner } from '@/components/ui/loading'
import { useI18n } from '@/lib/i18n'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
  Users,
  Briefcase,
  Building2,
  TrendingUp,
  Clock,
  CheckCircle,
  XCircle,
  Eye,
  ChevronRight,
  Shield,
  AlertTriangle,
  BarChart3,
  Settings,
  Bell
} from 'lucide-react'

interface AdminDashboardClientProps {
  user: {
    id?: string
  }
  pendingJobs: Array<{
    id: string
    title: string
    description: string
    city: string
    start_date: string
    start_time: string
    end_time: string
    hourly_rate: number
    currency?: string
    urgency?: string
    company?: {
      company_name?: string
    }
  }>
  stats: {
    totalUsers: number
    totalCandidates: number
    totalCompanies: number
    totalJobs: number
    pendingJobs: number
    activeJobs: number
    totalApplications: number
  }
}

export function AdminDashboardClient({ user: _user, pendingJobs, stats }: AdminDashboardClientProps) {
  const router = useRouter()
  const { locale } = useI18n()
  const [selectedJob, setSelectedJob] = React.useState<AdminDashboardClientProps['pendingJobs'][number] | null>(null)
  const [moderating, setModerating] = React.useState(false)

  const handleModerate = async (jobId: string, action: 'approve' | 'reject') => {
    setModerating(true)
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}/moderate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })

      if (res.ok) {
        setSelectedJob(null)
        router.refresh()
      }
    } catch (error) {
      console.error('Moderation error:', error)
    } finally {
      setModerating(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="font-bold text-foreground">Admin Dashboard</h1>
              <p className="text-xs text-muted-foreground">EasyJob CM</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="icon">
              <Bell className="w-5 h-5" />
            </Button>
            <Button variant="ghost" size="icon">
              <Settings className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>

      <div className="px-4 py-6 space-y-6">
        {/* Stats Overview */}
        <div className="grid grid-cols-2 gap-3">
          <Card className="bg-gradient-to-br from-primary/10 to-primary/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-5 h-5 text-primary" />
              </div>
              <p className="text-2xl font-bold text-foreground">{stats.totalUsers}</p>
              <p className="text-xs text-muted-foreground">
                {locale === 'fr' ? 'Utilisateurs' : 'Users'}
              </p>
              <div className="flex gap-2 mt-2 text-xs">
                <span className="text-muted-foreground">{stats.totalCandidates} candidats</span>
                <span className="text-muted-foreground">{stats.totalCompanies} entreprises</span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-success/10 to-success/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Briefcase className="w-5 h-5 text-success" />
              </div>
              <p className="text-2xl font-bold text-foreground">{stats.totalJobs}</p>
              <p className="text-xs text-muted-foreground">
                {locale === 'fr' ? 'Offres totales' : 'Total jobs'}
              </p>
              <div className="flex gap-2 mt-2 text-xs">
                <span className="text-success">{stats.activeJobs} actives</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-5 h-5 text-muted-foreground" />
              </div>
              <p className="text-2xl font-bold text-foreground">{stats.totalApplications}</p>
              <p className="text-xs text-muted-foreground">
                {locale === 'fr' ? 'Candidatures' : 'Applications'}
              </p>
            </CardContent>
          </Card>

          <Card className={stats.pendingJobs > 0 ? 'border-warning/50 bg-warning/5' : ''}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-5 h-5 text-warning" />
              </div>
              <p className="text-2xl font-bold text-foreground">{stats.pendingJobs}</p>
              <p className="text-xs text-muted-foreground">
                {locale === 'fr' ? 'En attente' : 'Pending review'}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-3 gap-3">
          <Link href="/admin/users">
            <Card className="hover:shadow-md transition-all cursor-pointer h-full">
              <CardContent className="p-4 flex flex-col items-center text-center">
                <Users className="w-6 h-6 text-primary mb-2" />
                <p className="text-xs font-medium text-foreground">
                  {locale === 'fr' ? 'Utilisateurs' : 'Users'}
                </p>
              </CardContent>
            </Card>
          </Link>

          <Link href="/admin/jobs">
            <Card className="hover:shadow-md transition-all cursor-pointer h-full">
              <CardContent className="p-4 flex flex-col items-center text-center">
                <Briefcase className="w-6 h-6 text-success mb-2" />
                <p className="text-xs font-medium text-foreground">
                  {locale === 'fr' ? 'Offres' : 'Jobs'}
                </p>
              </CardContent>
            </Card>
          </Link>

          <Link href="/admin/analytics">
            <Card className="hover:shadow-md transition-all cursor-pointer h-full">
              <CardContent className="p-4 flex flex-col items-center text-center">
                <BarChart3 className="w-6 h-6 text-accent mb-2" />
                <p className="text-xs font-medium text-foreground">
                  {locale === 'fr' ? 'Analytics' : 'Analytics'}
                </p>
              </CardContent>
            </Card>
          </Link>
        </div>

        {/* Pending Jobs for Moderation */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-foreground">
              {locale === 'fr' ? 'Offres a moderer' : 'Jobs to moderate'}
              {stats.pendingJobs > 0 && (
                <Badge variant="warning" className="ml-2">{stats.pendingJobs}</Badge>
              )}
            </h2>
            <Link 
              href="/admin/jobs?status=pending"
              className="text-sm text-primary font-medium"
            >
              {locale === 'fr' ? 'Tout voir' : 'See all'}
            </Link>
          </div>

          {pendingJobs.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <CheckCircle className="w-12 h-12 text-success mx-auto mb-3" />
                <p className="text-muted-foreground">
                  {locale === 'fr' 
                    ? 'Aucune offre en attente de moderation'
                    : 'No jobs pending moderation'}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {pendingJobs.slice(0, 5).map((job) => (
                <Card key={job.id} className="hover:shadow-md transition-all">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="warning">
                            {locale === 'fr' ? 'En attente' : 'Pending'}
                          </Badge>
                          {job.urgency !== 'normal' && (
                            <Badge variant="destructive">
                              <AlertTriangle className="w-3 h-3 mr-1" />
                              Urgent
                            </Badge>
                          )}
                        </div>
                        <h3 className="font-medium text-foreground truncate">
                          {job.title}
                        </h3>
                        <p className="text-sm text-muted-foreground truncate">
                          {job.company?.company_name}
                        </p>
                      </div>
                      <p className="text-sm font-medium text-primary whitespace-nowrap">
                        {formatCurrency(job.hourly_rate, job.currency)}/h
                      </p>
                    </div>

                    <div className="flex items-center gap-2 mt-3">
                      <Button 
                        variant="outline" 
                        size="sm"
                        className="flex-1"
                        onClick={() => setSelectedJob(job)}
                      >
                        <Eye className="w-4 h-4 mr-1" />
                        {locale === 'fr' ? 'Voir' : 'View'}
                      </Button>
                      <Button 
                        variant="success" 
                        size="sm"
                        className="flex-1"
                        onClick={() => handleModerate(job.id, 'approve')}
                      >
                        <CheckCircle className="w-4 h-4 mr-1" />
                        {locale === 'fr' ? 'Approuver' : 'Approve'}
                      </Button>
                      <Button 
                        variant="destructive" 
                        size="sm"
                        onClick={() => handleModerate(job.id, 'reject')}
                      >
                        <XCircle className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Job Preview Modal */}
      <Modal
        isOpen={!!selectedJob}
        onClose={() => setSelectedJob(null)}
        title={selectedJob?.title || ''}
      >
        {selectedJob && (
          <div className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Entreprise</p>
              <p className="font-medium">{selectedJob.company?.company_name}</p>
            </div>
            
            <div>
              <p className="text-sm text-muted-foreground mb-1">Description</p>
              <p className="text-sm">{selectedJob.description}</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Date</p>
                <p className="font-medium">{formatDate(selectedJob.start_date, locale)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Horaires</p>
                <p className="font-medium">
                  {selectedJob.start_time?.slice(0, 5)} - {selectedJob.end_time?.slice(0, 5)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Lieu</p>
                <p className="font-medium">{selectedJob.city}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Salaire</p>
                <p className="font-medium text-primary">
                  {formatCurrency(selectedJob.hourly_rate, selectedJob.currency)}/h
                </p>
              </div>
            </div>

            <div className="flex gap-3 pt-4 border-t">
              <Button 
                variant="outline"
                className="flex-1"
                onClick={() => setSelectedJob(null)}
              >
                {locale === 'fr' ? 'Fermer' : 'Close'}
              </Button>
              <Button 
                variant="destructive"
                onClick={() => handleModerate(selectedJob.id, 'reject')}
                disabled={moderating}
              >
                <XCircle className="w-4 h-4 mr-2" />
                {locale === 'fr' ? 'Rejeter' : 'Reject'}
              </Button>
              <Button 
                onClick={() => handleModerate(selectedJob.id, 'approve')}
                disabled={moderating}
              >
                {moderating ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    {locale === 'fr' ? 'Approuver' : 'Approve'}
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
