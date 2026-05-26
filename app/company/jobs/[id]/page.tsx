"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { 
  ArrowLeft,
  MapPin,
  Calendar,
  Clock,
  Users,
  Star,
  CheckCircle,
  XCircle,
  MessageSquare,
  Phone,
  FileText
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"

interface Job {
  id: string
  title: string
  description: string
  city: string
  quartier: string
  start_date: string
  end_date: string
  start_time: string
  end_time: string
  hourly_rate: number
  positions_available: number
  positions_filled: number
  status: string
  required_skills: string[]
}

interface Application {
  id: string
  status: string
  match_score: number
  distance_km: number
  candidate_note: string
  created_at: string
  candidate: {
    id: string
    first_name: string
    last_name: string
    profile_photo_url: string
    city: string
    reliability_score: number
    completed_missions: number
    skills: { skill_name: string }[]
  }
}

export default function CompanyJobDetailPage() {
  const router = useRouter()
  const params = useParams()
  const { toast } = useToast()
  const jobId = params.id as string
  
  const [loading, setLoading] = useState(true)
  const [job, setJob] = useState<Job | null>(null)
  const [applications, setApplications] = useState<Application[]>([])
  const [activeTab, setActiveTab] = useState("pending")
  const [selectedApplication, setSelectedApplication] = useState<Application | null>(null)
  const [actionType, setActionType] = useState<'select' | 'reject' | null>(null)
  const [rejectionReason, setRejectionReason] = useState("")
  const [processing, setProcessing] = useState(false)

  useEffect(() => {
    loadData()
  }, [jobId])

  async function loadData() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      router.push('/login')
      return
    }

    // Get job details
    const { data: jobData } = await supabase
      .from('jobs')
      .select('*')
      .eq('id', jobId)
      .single()

    if (jobData) setJob(jobData)

    // Get applications with candidate info
    const { data: appsData } = await supabase
      .from('job_applications')
      .select(`
        *,
        candidate:candidate_profiles(
          id,
          first_name,
          last_name,
          profile_photo_url,
          city,
          reliability_score,
          completed_missions,
          skills:candidate_skills(skill_name)
        )
      `)
      .eq('job_id', jobId)
      .order('match_score', { ascending: false })

    if (appsData) setApplications(appsData as Application[])
    
    setLoading(false)
  }

  const handleSelectCandidate = async () => {
    if (!selectedApplication) return
    
    setProcessing(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) return

    // Update application status
    const { error } = await supabase
      .from('job_applications')
      .update({
        status: 'selected',
        selected_at: new Date().toISOString(),
        selected_by: user.id
      })
      .eq('id', selectedApplication.id)

    if (error) {
      toast({
        title: "Erreur",
        description: "Impossible de selectionner le candidat.",
        variant: "destructive"
      })
    } else {
      // Update positions filled
      await supabase
        .from('jobs')
        .update({
          positions_filled: (job?.positions_filled || 0) + 1
        })
        .eq('id', jobId)

      toast({
        title: "Candidat selectionne",
        description: "Le candidat a ete notifie de sa selection."
      })
      loadData()
    }
    
    setSelectedApplication(null)
    setActionType(null)
    setProcessing(false)
  }

  const handleRejectCandidate = async () => {
    if (!selectedApplication) return
    
    setProcessing(true)
    const supabase = createClient()

    const { error } = await supabase
      .from('job_applications')
      .update({
        status: 'rejected',
        rejection_reason: rejectionReason || null
      })
      .eq('id', selectedApplication.id)

    if (error) {
      toast({
        title: "Erreur",
        description: "Impossible de rejeter le candidat.",
        variant: "destructive"
      })
    } else {
      toast({
        title: "Candidature rejetee",
        description: "Le candidat a ete notifie."
      })
      loadData()
    }
    
    setSelectedApplication(null)
    setActionType(null)
    setRejectionReason("")
    setProcessing(false)
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    })
  }

  const formatTime = (time: string) => {
    return time?.slice(0, 5) || ''
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge className="bg-yellow-100 text-yellow-700">En attente</Badge>
      case 'shortlisted':
        return <Badge className="bg-blue-100 text-blue-700">Preselectionnee</Badge>
      case 'selected':
        return <Badge className="bg-green-100 text-green-700">Selectionnee</Badge>
      case 'rejected':
        return <Badge className="bg-red-100 text-red-700">Rejetee</Badge>
      default:
        return <Badge variant="secondary">{status}</Badge>
    }
  }

  const filteredApplications = applications.filter(app => {
    if (activeTab === 'pending') return app.status === 'pending'
    if (activeTab === 'shortlisted') return app.status === 'shortlisted'
    if (activeTab === 'selected') return app.status === 'selected'
    if (activeTab === 'rejected') return app.status === 'rejected'
    return true
  })

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-4 space-y-4">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  if (!job) {
    return (
      <div className="min-h-screen bg-background p-4">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        <div className="text-center mt-8">
          <p className="text-muted-foreground">Offre non trouvee</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b p-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="mb-3">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Retour
        </Button>
        
        <h1 className="text-xl font-bold">{job.title}</h1>
        
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground mt-2">
          <span className="flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" />
            {job.city}{job.quartier ? `, ${job.quartier}` : ''}
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
          <div className="flex items-center gap-1.5">
            <Users className="h-4 w-4 text-violet-600" />
            <span className="font-medium">{applications.length}</span>
            <span className="text-sm text-muted-foreground">candidature(s)</span>
          </div>
          <div className="text-sm">
            <span className="font-medium">{job.positions_filled}</span>
            <span className="text-muted-foreground">/{job.positions_available} poste(s) pourvu(s)</span>
          </div>
        </div>
      </div>

      {/* Applications */}
      <div className="p-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="pending" className="text-xs">
              En attente ({applications.filter(a => a.status === 'pending').length})
            </TabsTrigger>
            <TabsTrigger value="shortlisted" className="text-xs">
              Preselect. ({applications.filter(a => a.status === 'shortlisted').length})
            </TabsTrigger>
            <TabsTrigger value="selected" className="text-xs">
              Selectionnees ({applications.filter(a => a.status === 'selected').length})
            </TabsTrigger>
            <TabsTrigger value="rejected" className="text-xs">
              Rejetees ({applications.filter(a => a.status === 'rejected').length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className="mt-4 space-y-3">
            {filteredApplications.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center">
                  <Users className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">Aucune candidature dans cette categorie</p>
                </CardContent>
              </Card>
            ) : (
              filteredApplications.map((app) => (
                <Card key={app.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <Avatar className="h-12 w-12">
                        <AvatarImage src={app.candidate?.profile_photo_url} />
                        <AvatarFallback>
                          {app.candidate?.first_name?.[0]}{app.candidate?.last_name?.[0]}
                        </AvatarFallback>
                      </Avatar>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">
                            {app.candidate?.first_name} {app.candidate?.last_name}
                          </span>
                          {getStatusBadge(app.status)}
                          {app.match_score && (
                            <Badge variant="outline" className="text-xs">
                              {Math.round(app.match_score)}% match
                            </Badge>
                          )}
                        </div>
                        
                        <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {app.candidate?.city}
                            {app.distance_km && ` (${app.distance_km.toFixed(1)} km)`}
                          </span>
                          <span className="flex items-center gap-1">
                            <Star className="h-3 w-3 text-yellow-500" />
                            {(app.candidate?.reliability_score || 0).toFixed(1)}
                          </span>
                          <span>{app.candidate?.completed_missions || 0} missions</span>
                        </div>

                        {app.candidate?.skills && app.candidate.skills.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {app.candidate.skills.slice(0, 3).map((skill, i) => (
                              <Badge key={i} variant="secondary" className="text-xs">
                                {skill.skill_name}
                              </Badge>
                            ))}
                            {app.candidate.skills.length > 3 && (
                              <Badge variant="secondary" className="text-xs">
                                +{app.candidate.skills.length - 3}
                              </Badge>
                            )}
                          </div>
                        )}

                        {app.candidate_note && (
                          <p className="text-sm text-muted-foreground mt-2 italic">
                            &quot;{app.candidate_note}&quot;
                          </p>
                        )}

                        {app.status === 'pending' && (
                          <div className="flex items-center gap-2 mt-3">
                            <Button 
                              size="sm"
                              onClick={() => {
                                setSelectedApplication(app)
                                setActionType('select')
                              }}
                            >
                              <CheckCircle className="h-4 w-4 mr-1" />
                              Selectionner
                            </Button>
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => {
                                setSelectedApplication(app)
                                setActionType('reject')
                              }}
                            >
                              <XCircle className="h-4 w-4 mr-1" />
                              Rejeter
                            </Button>
                          </div>
                        )}

                        {app.status === 'selected' && (
                          <div className="flex items-center gap-2 mt-3">
                            <Button size="sm" variant="outline">
                              <Phone className="h-4 w-4 mr-1" />
                              Contacter
                            </Button>
                            <Button size="sm" variant="outline">
                              <FileText className="h-4 w-4 mr-1" />
                              Contrat
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Selection Dialog */}
      <Dialog open={actionType === 'select'} onOpenChange={() => setActionType(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmer la selection</DialogTitle>
            <DialogDescription>
              Voulez-vous selectionner {selectedApplication?.candidate?.first_name} {selectedApplication?.candidate?.last_name} pour ce poste ?
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              Le candidat recevra une notification et pourra signer le contrat electronique.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionType(null)}>
              Annuler
            </Button>
            <Button onClick={handleSelectCandidate} disabled={processing}>
              {processing ? "Traitement..." : "Confirmer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rejection Dialog */}
      <Dialog open={actionType === 'reject'} onOpenChange={() => setActionType(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rejeter la candidature</DialogTitle>
            <DialogDescription>
              Rejeter la candidature de {selectedApplication?.candidate?.first_name} {selectedApplication?.candidate?.last_name} ?
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Textarea
              placeholder="Raison du rejet (optionnel)"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionType(null)}>
              Annuler
            </Button>
            <Button variant="destructive" onClick={handleRejectCandidate} disabled={processing}>
              {processing ? "Traitement..." : "Rejeter"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
