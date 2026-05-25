"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { 
  Plus, 
  Briefcase, 
  Users, 
  Clock, 
  MapPin,
  Calendar,
  MoreVertical,
  Eye,
  Edit,
  Trash2,
  CheckCircle
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useToast } from "@/hooks/use-toast"

interface Job {
  id: string
  title: string
  description: string
  city: string
  start_date: string
  start_time: string
  end_time: string
  hourly_rate: number
  positions_available: number
  positions_filled: number
  status: string
  urgency: string
  created_at: string
  _count?: {
    applications: number
  }
}

export default function CompanyJobsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [jobs, setJobs] = useState<Job[]>([])
  const [activeTab, setActiveTab] = useState("active")
  const [deleteJobId, setDeleteJobId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    // Show success toast if job was just created
    if (searchParams.get('created') === 'true') {
      toast({
        title: "Offre creee",
        description: "Votre offre a ete soumise pour moderation.",
      })
    }
    loadJobs()
  }, [searchParams])

  const loadJobs = async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      router.push('/login?redirect=/company/jobs')
      return
    }

    // Get company profile
    const { data: company } = await supabase
      .from('company_profiles')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (!company) {
      router.push('/onboarding/company')
      return
    }

    // Get jobs with application counts
    const { data: jobsData } = await supabase
      .from('jobs')
      .select(`
        *,
        job_applications(count)
      `)
      .eq('company_id', company.id)
      .order('created_at', { ascending: false })

    if (jobsData) {
      // Transform data to include application count
      const transformedJobs = jobsData.map(job => ({
        ...job,
        _count: {
          applications: job.job_applications?.[0]?.count || 0
        }
      }))
      setJobs(transformedJobs)
    }
    
    setLoading(false)
  }

  const handleDeleteJob = async () => {
    if (!deleteJobId) return
    
    setDeleting(true)
    const supabase = createClient()
    
    const { error } = await supabase
      .from('jobs')
      .delete()
      .eq('id', deleteJobId)

    if (error) {
      toast({
        title: "Erreur",
        description: "Impossible de supprimer l'offre.",
        variant: "destructive"
      })
    } else {
      toast({
        title: "Offre supprimee",
        description: "L'offre a ete supprimee avec succes."
      })
      loadJobs()
    }
    
    setDeleteJobId(null)
    setDeleting(false)
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    })
  }

  const formatTime = (time: string) => {
    return time?.slice(0, 5) || ''
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'published':
        return <Badge className="bg-green-100 text-green-700">Publiee</Badge>
      case 'pending_review':
      case 'pending_moderation':
        return <Badge className="bg-yellow-100 text-yellow-700">En moderation</Badge>
      case 'draft':
        return <Badge variant="secondary">Brouillon</Badge>
      case 'filled':
        return <Badge className="bg-blue-100 text-blue-700">Pourvue</Badge>
      case 'expired':
        return <Badge className="bg-gray-100 text-gray-700">Expiree</Badge>
      case 'rejected':
        return <Badge className="bg-red-100 text-red-700">Rejetee</Badge>
      case 'cancelled':
        return <Badge className="bg-red-100 text-red-700">Annulee</Badge>
      default:
        return <Badge variant="secondary">{status}</Badge>
    }
  }

  const filteredJobs = jobs.filter(job => {
    if (activeTab === 'active') {
      return ['published', 'pending_review', 'pending_moderation'].includes(job.status)
    } else if (activeTab === 'draft') {
      return job.status === 'draft'
    } else {
      return ['filled', 'expired', 'cancelled', 'rejected'].includes(job.status)
    }
  })

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-4 space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-10 w-32" />
        </div>
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Mes Offres</h1>
            <p className="text-sm text-muted-foreground">{jobs.length} offre(s) au total</p>
          </div>
          <Button asChild>
            <Link href="/company/jobs/new">
              <Plus className="h-4 w-4 mr-2" />
              Nouvelle offre
            </Link>
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="p-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="active">
              Actives ({jobs.filter(j => ['published', 'pending_review', 'pending_moderation'].includes(j.status)).length})
            </TabsTrigger>
            <TabsTrigger value="draft">
              Brouillons ({jobs.filter(j => j.status === 'draft').length})
            </TabsTrigger>
            <TabsTrigger value="closed">
              Terminees ({jobs.filter(j => ['filled', 'expired', 'cancelled', 'rejected'].includes(j.status)).length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className="mt-4 space-y-3">
            {filteredJobs.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <Briefcase className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="font-semibold mb-2">
                    {activeTab === 'active' && "Aucune offre active"}
                    {activeTab === 'draft' && "Aucun brouillon"}
                    {activeTab === 'closed' && "Aucune offre terminee"}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    {activeTab === 'active' && "Publiez une nouvelle offre pour trouver des candidats"}
                    {activeTab === 'draft' && "Vos brouillons d'offres apparaitront ici"}
                    {activeTab === 'closed' && "Les offres terminees apparaitront ici"}
                  </p>
                  {activeTab === 'active' && (
                    <Button asChild>
                      <Link href="/company/jobs/new">
                        <Plus className="h-4 w-4 mr-2" />
                        Creer une offre
                      </Link>
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              filteredJobs.map((job) => (
                <Card key={job.id} className="overflow-hidden">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h3 className="font-semibold truncate">{job.title}</h3>
                          {getStatusBadge(job.status)}
                          {job.urgency === 'high' || job.urgency === 'urgent' || job.urgency === 'critical' ? (
                            <Badge variant="destructive" className="text-xs">Urgent</Badge>
                          ) : null}
                        </div>
                        
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground mt-2">
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {job.city}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5" />
                            {formatDate(job.start_date)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            {formatTime(job.start_time)} - {formatTime(job.end_time)}
                          </span>
                        </div>

                        <div className="flex items-center gap-4 mt-3">
                          <div className="flex items-center gap-1.5 text-sm">
                            <Users className="h-4 w-4 text-violet-600" />
                            <span className="font-medium">{job._count?.applications || 0}</span>
                            <span className="text-muted-foreground">candidature(s)</span>
                          </div>
                          <div className="text-sm">
                            <span className="font-medium">{job.positions_filled}</span>
                            <span className="text-muted-foreground">/{job.positions_available} poste(s)</span>
                          </div>
                          <div className="text-sm font-medium text-violet-600">
                            {job.hourly_rate.toLocaleString()} XAF/h
                          </div>
                        </div>
                      </div>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="shrink-0">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={`/company/jobs/${job.id}`}>
                              <Eye className="h-4 w-4 mr-2" />
                              Voir les candidatures
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href={`/company/jobs/${job.id}/edit`}>
                              <Edit className="h-4 w-4 mr-2" />
                              Modifier
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            className="text-red-600"
                            onClick={() => setDeleteJobId(job.id)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Supprimer
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteJobId} onOpenChange={() => setDeleteJobId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette offre ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irreversible. Toutes les candidatures associees seront egalement supprimees.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteJob}
              className="bg-red-600 hover:bg-red-700"
              disabled={deleting}
            >
              {deleting ? "Suppression..." : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
