'use client'

import * as React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Modal, ModalHeader, ModalContent, ModalFooter } from '@/components/ui/modal'
import { useTranslation } from '@/lib/i18n'
import { LoadingScreen, LoadingSpinner } from '@/components/ui/loading'
import { 
  MapPin, 
  Clock, 
  Calendar, 
  Building2, 
  Banknote,
  Info,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  ChevronRight
} from 'lucide-react'

// Mock job data
const mockJob = {
  id: '1',
  title: 'Serveur/Serveuse Restaurant',
  company: {
    name: 'Le Gourmet',
    verified: true,
    logo: null,
  },
  location: {
    address: 'Boulevard de la Liberte',
    city: 'Douala',
    area: 'Bonanjo',
    coordinates: { lat: 4.0511, lng: 9.7679 },
  },
  hourlyRate: 1500,
  currency: 'XAF',
  type: 'shift',
  category: 'Restauration',
  date: '2026-05-22',
  startTime: '18:00',
  endTime: '23:00',
  urgent: true,
  description: `Nous recherchons un(e) serveur/serveuse dynamique pour rejoindre notre equipe le temps d'une soiree speciale.

Vos missions :
- Accueillir les clients avec le sourire
- Prendre les commandes
- Servir les plats et boissons
- Assurer la proprete des tables

Important : Tenue soignee exigee (chemise noire, pantalon noir).`,
  requirements: [
    'Experience en service recommandee',
    'Bonne presentation',
    'Ponctualite',
    'Francais courant',
  ],
  benefits: [
    'Repas offert',
    'Pourboires partages',
    'Possibilite de missions regulieres',
  ],
}

export default function JobDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { locale } = useTranslation()
  const [loading, setLoading] = React.useState(false)
  const [showConfirmModal, setShowConfirmModal] = React.useState(false)
  const [applying, setApplying] = React.useState(false)

  const job = mockJob // In real app, fetch by params.id

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fr-CM').format(amount)
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    })
  }

  const calculateDuration = (start: string, end: string) => {
    const [startH, startM] = start.split(':').map(Number)
    const [endH, endM] = end.split(':').map(Number)
    const hours = endH - startH + (endM - startM) / 60
    return hours
  }

  const duration = calculateDuration(job.startTime, job.endTime)
  const totalPay = duration * job.hourlyRate

  const handleApply = async () => {
    setApplying(true)
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1500))
    setApplying(false)
    setShowConfirmModal(false)
    router.push('/my-jobs?tab=applied')
  }

  if (loading) {
    return <LoadingScreen message={locale === 'fr' ? 'Chargement...' : 'Loading...'} />
  }

  return (
    <div className="flex min-h-screen flex-col bg-background pb-24">
      {/* Header with gradient */}
      <div className="bg-gradient-primary text-white">
        <Header 
          title={job.title}
          showBack
          variant="primary"
        />
        
        <div className="px-4 pb-6">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold">
              {formatCurrency(job.hourlyRate)}
            </span>
            <span className="text-white/80">{job.currency}/h</span>
          </div>
          <p className="text-white/80 text-sm mt-1">{job.category}</p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-4 -mt-4">
        {/* Alert card */}
        <Card className="mb-4 border-primary/20 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-foreground">
                  {locale === 'fr' 
                    ? 'Postulez maintenant !'
                    : 'Apply now!'}
                </p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {locale === 'fr'
                    ? 'Verifiez les details avant de postuler.'
                    : 'Review the details before applying.'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Location */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">
            {locale === 'fr' ? 'Lieu' : 'Location'}
          </h2>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <MapPin className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium text-foreground">{job.company.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {job.location.address}, {job.location.area}
                  </p>
                  <p className="text-sm text-muted-foreground">{job.location.city}</p>
                </div>
                <button className="flex items-center gap-1 text-sm text-primary font-medium">
                  <ExternalLink className="h-4 w-4" />
                </button>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Schedule */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">
            {locale === 'fr' ? 'Details de la mission' : 'Job Details'}
          </h2>
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Calendar className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-foreground capitalize">
                      {formatDate(job.date)}
                    </p>
                    <p className="text-sm text-primary">
                      {locale === 'fr' ? 'Dans 2 jours' : 'In 2 days'}
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Clock className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-foreground">
                      {job.startTime} - {job.endTime}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {duration}h - {locale === 'fr' ? 'Soir' : 'Evening'}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Description */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">
            {locale === 'fr' ? 'Description' : 'Description'}
          </h2>
          <Card>
            <CardContent className="p-4">
              <p className="text-foreground whitespace-pre-line text-sm leading-relaxed">
                {job.description}
              </p>
            </CardContent>
          </Card>
        </section>

        {/* Requirements */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">
            {locale === 'fr' ? 'Exigences' : 'Requirements'}
          </h2>
          <Card>
            <CardContent className="p-4">
              <ul className="space-y-2">
                {job.requirements.map((req, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
                    <span className="text-foreground">{req}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>

        {/* Benefits */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">
            {locale === 'fr' ? 'Avantages' : 'Benefits'}
          </h2>
          <Card>
            <CardContent className="p-4">
              <ul className="space-y-2">
                {job.benefits.map((benefit, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm">
                    <span className="text-primary">•</span>
                    <span className="text-foreground">{benefit}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      </div>

      {/* Fixed bottom CTA */}
      <div className="fixed bottom-0 left-0 right-0 bg-background/80 backdrop-blur-xl border-t border-border p-4 safe-area-bottom">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm text-muted-foreground">
              {locale === 'fr' ? 'Remuneration totale' : 'Total pay'}
            </p>
            <p className="text-xl font-bold text-foreground">
              {formatCurrency(totalPay)} {job.currency}
            </p>
          </div>
          <Badge variant="success">
            {duration}h
          </Badge>
        </div>
        <Button 
          onClick={() => setShowConfirmModal(true)}
          className="w-full" 
          size="lg"
        >
          {locale === 'fr' ? 'Postuler' : 'Apply'}
          <ChevronRight className="ml-2 h-4 w-4" />
        </Button>
      </div>

      {/* Confirmation Modal */}
      <Modal open={showConfirmModal} onClose={() => setShowConfirmModal(false)}>
        <ModalHeader>
          {locale === 'fr' ? 'Confirmer votre candidature' : 'Confirm your application'}
        </ModalHeader>
        <ModalContent>
          <p className="text-muted-foreground mb-4">
            {locale === 'fr'
              ? 'Avant de postuler, assurez-vous de pouvoir vous presenter a cette mission.'
              : 'Before applying, make sure you can attend this job.'}
          </p>
          
          <Card className="bg-muted/50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">{job.title}</span>
                <Badge variant="outline">{job.company.name}</Badge>
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  {formatDate(job.date)}
                </div>
                <div className="flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  {job.startTime}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="mt-4 p-3 rounded-xl bg-warning/10 border border-warning/20">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
              <p className="text-sm text-foreground">
                {locale === 'fr'
                  ? 'Une absence non justifiee peut entrainer des penalites sur votre compte.'
                  : 'Unexcused absence may result in penalties on your account.'}
              </p>
            </div>
          </div>
        </ModalContent>
        <ModalFooter>
          <Button 
            variant="outline" 
            onClick={() => setShowConfirmModal(false)}
            className="flex-1"
          >
            {locale === 'fr' ? 'Annuler' : 'Cancel'}
          </Button>
          <Button 
            onClick={handleApply}
            disabled={applying}
            className="flex-1"
          >
            {applying ? <LoadingSpinner size="sm" /> : (
              locale === 'fr' ? 'Confirmer' : 'Confirm'
            )}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  )
}
