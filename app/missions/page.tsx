"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { 
  Calendar,
  Clock,
  MapPin,
  Briefcase,
  ChevronRight,
  CalendarCheck
} from "lucide-react"
import { BottomNav } from "@/components/layout/bottom-nav"

interface Mission {
  id: string
  status: string
  scheduled_date: string
  scheduled_start_time: string
  scheduled_end_time: string
  job: {
    title: string
    hourly_rate: number
    city: string
    company: {
      company_name: string
    }
  }
}

export default function MissionsListPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [missions, setMissions] = useState<Mission[]>([])
  const [activeTab, setActiveTab] = useState("upcoming")

  useEffect(() => {
    loadMissions()
  }, [])

  const loadMissions = async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      router.push('/login?redirect=/missions')
      return
    }

    // Get candidate profile
    const { data: profile } = await supabase
      .from('candidate_profiles')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (!profile) {
      router.push('/onboarding/candidate')
      return
    }

    // Get missions
    const { data: missionsData } = await supabase
      .from('missions')
      .select(`
        *,
        job:jobs(
          title,
          hourly_rate,
          city,
          company:company_profiles(company_name)
        )
      `)
      .eq('candidate_id', profile.id)
      .order('scheduled_date', { ascending: true })

    if (missionsData) {
      setMissions(missionsData as Mission[])
    }
    
    setLoading(false)
  }

  const formatDate = (date: string) => {
    const d = new Date(date)
    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    if (d.toDateString() === today.toDateString()) {
      return "Aujourd'hui"
    }
    if (d.toDateString() === tomorrow.toDateString()) {
      return "Demain"
    }
    return d.toLocaleDateString('fr-FR', {
      weekday: 'short',
      day: 'numeric',
      month: 'short'
    })
  }

  const formatTime = (time: string) => {
    return time?.slice(0, 5) || ''
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge className="bg-yellow-100 text-yellow-700">En attente</Badge>
      case 'confirmed':
        return <Badge className="bg-blue-100 text-blue-700">Confirme</Badge>
      case 'in_progress':
        return <Badge className="bg-green-100 text-green-700">En cours</Badge>
      case 'completed':
        return <Badge className="bg-green-100 text-green-700">Termine</Badge>
      case 'cancelled':
        return <Badge className="bg-red-100 text-red-700">Annule</Badge>
      case 'no_show':
        return <Badge className="bg-red-100 text-red-700">Absent</Badge>
      default:
        return <Badge variant="secondary">{status}</Badge>
    }
  }

  const today = new Date().toISOString().split('T')[0]
  
  const filteredMissions = missions.filter(mission => {
    const missionDate = mission.scheduled_date
    
    if (activeTab === 'upcoming') {
      return missionDate >= today && ['pending', 'confirmed'].includes(mission.status)
    } else if (activeTab === 'today') {
      return missionDate === today
    } else {
      return missionDate < today || ['completed', 'cancelled', 'no_show'].includes(mission.status)
    }
  })

  const todayMissions = missions.filter(m => m.scheduled_date === today)
  const upcomingMissions = missions.filter(m => m.scheduled_date >= today && ['pending', 'confirmed'].includes(m.status))

  if (loading) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <div className="p-4 space-y-4">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <BottomNav />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Header */}
      <div className="bg-card border-b p-4">
        <h1 className="text-xl font-bold">Mes Missions</h1>
        <p className="text-sm text-muted-foreground">
          {upcomingMissions.length} mission(s) a venir
        </p>
      </div>

      {/* Today's Mission Alert */}
      {todayMissions.length > 0 && (
        <div className="p-4 bg-violet-50 border-b border-violet-200">
          <div className="flex items-center gap-2 text-violet-700 font-medium mb-2">
            <CalendarCheck className="h-5 w-5" />
            Missions du jour
          </div>
          {todayMissions.map(mission => (
            <Link key={mission.id} href={`/missions/${mission.id}`}>
              <Card className="bg-white mb-2">
                <CardContent className="p-3 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm">{mission.job?.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatTime(mission.scheduled_start_time)} - {formatTime(mission.scheduled_end_time)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(mission.status)}
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="p-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="upcoming">
              A venir ({upcomingMissions.length})
            </TabsTrigger>
            <TabsTrigger value="today">
              Aujourd&apos;hui ({todayMissions.length})
            </TabsTrigger>
            <TabsTrigger value="past">
              Passees
            </TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className="mt-4 space-y-3">
            {filteredMissions.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <Briefcase className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="font-semibold mb-2">
                    {activeTab === 'upcoming' && "Aucune mission a venir"}
                    {activeTab === 'today' && "Aucune mission aujourd'hui"}
                    {activeTab === 'past' && "Aucune mission passee"}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    {activeTab === 'upcoming' && "Postulez a des offres pour obtenir des missions"}
                  </p>
                  {activeTab === 'upcoming' && (
                    <Button asChild>
                      <Link href="/jobs">
                        Voir les offres
                      </Link>
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              filteredMissions.map((mission) => (
                <Link key={mission.id} href={`/missions/${mission.id}`}>
                  <Card className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="font-semibold">{mission.job?.title}</span>
                            {getStatusBadge(mission.status)}
                          </div>
                          <div className="text-sm text-muted-foreground mb-2">
                            {mission.job?.company?.company_name}
                          </div>
                          
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3.5 w-3.5" />
                              {formatDate(mission.scheduled_date)}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3.5 w-3.5" />
                              {formatTime(mission.scheduled_start_time)} - {formatTime(mission.scheduled_end_time)}
                            </span>
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3.5 w-3.5" />
                              {mission.job?.city}
                            </span>
                          </div>
                        </div>
                        
                        <div className="text-right">
                          <div className="font-bold text-violet-600">
                            {mission.job?.hourly_rate?.toLocaleString()} XAF
                          </div>
                          <div className="text-xs text-muted-foreground">/heure</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>

      <BottomNav />
    </div>
  )
}
