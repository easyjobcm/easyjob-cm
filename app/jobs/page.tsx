'use client'

import * as React from 'react'
import { AppShell } from '@/components/layout/app-shell'
import { Header } from '@/components/layout/header'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTranslation } from '@/lib/i18n'
import { 
  Search, 
  MapPin, 
  Clock, 
  Banknote, 
  Filter, 
  ChevronRight,
  Building2,
  Calendar
} from 'lucide-react'
import { cn } from '@/lib/utils'
import Link from 'next/link'

// Mock data for demonstration
const mockJobs = [
  {
    id: '1',
    title: 'Serveur/Serveuse Restaurant',
    company: 'Le Gourmet',
    location: 'Douala, Bonanjo',
    hourlyRate: 1500,
    currency: 'XAF',
    type: 'shift',
    category: 'Restauration',
    date: '2026-05-22',
    startTime: '18:00',
    endTime: '23:00',
    urgent: true,
  },
  {
    id: '2',
    title: 'Agent de Securite',
    company: 'SecurPlus Cameroun',
    location: 'Yaounde, Bastos',
    hourlyRate: 1200,
    currency: 'XAF',
    type: 'contract',
    category: 'Securite',
    startDate: '2026-06-01',
    endDate: '2026-08-31',
    hoursPerWeek: 40,
  },
  {
    id: '3',
    title: 'Livreur Moto',
    company: 'FastDeliver',
    location: 'Douala, Akwa',
    hourlyRate: 1800,
    currency: 'XAF',
    type: 'shift',
    category: 'Logistique',
    date: '2026-05-21',
    startTime: '08:00',
    endTime: '14:00',
  },
  {
    id: '4',
    title: 'Hotesse d\'accueil',
    company: 'EventPro CM',
    location: 'Yaounde, Centre',
    hourlyRate: 1400,
    currency: 'XAF',
    type: 'shift',
    category: 'Evenementiel',
    date: '2026-05-25',
    startTime: '09:00',
    endTime: '18:00',
  },
]

const categories = [
  { id: 'all', label: 'Tous', labelEn: 'All' },
  { id: 'restauration', label: 'Restauration', labelEn: 'Restaurant' },
  { id: 'securite', label: 'Securite', labelEn: 'Security' },
  { id: 'logistique', label: 'Logistique', labelEn: 'Logistics' },
  { id: 'evenementiel', label: 'Evenementiel', labelEn: 'Events' },
  { id: 'commerce', label: 'Commerce', labelEn: 'Retail' },
]

export default function JobsPage() {
  const { t, locale } = useTranslation()
  const [searchQuery, setSearchQuery] = React.useState('')
  const [selectedCategory, setSelectedCategory] = React.useState('all')

  const filteredJobs = mockJobs.filter(job => {
    const matchesSearch = job.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.company.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = selectedCategory === 'all' || 
      job.category.toLowerCase() === selectedCategory
    return matchesSearch && matchesCategory
  })

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fr-CM').format(amount)
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    })
  }

  return (
    <AppShell>
      {/* Header with search */}
      <div className="sticky top-0 z-20 bg-background/80 backdrop-blur-xl border-b border-border/50">
        <div className="px-4 py-4">
          <h1 className="text-2xl font-bold text-foreground mb-4">
            {t('jobs.title')}
          </h1>
          
          {/* Search bar */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t('jobs.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button variant="outline" size="icon" className="shrink-0">
              <Filter className="h-4 w-4" />
              <span className="sr-only">Filtrer</span>
            </Button>
          </div>
        </div>

        {/* Categories */}
        <div className="flex gap-2 overflow-x-auto px-4 pb-3 scrollbar-hide">
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id)}
              className={cn(
                'shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-all',
                selectedCategory === category.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              )}
            >
              {locale === 'fr' ? category.label : category.labelEn}
            </button>
          ))}
        </div>
      </div>

      {/* Job listings */}
      <div className="px-4 py-4 space-y-3">
        {filteredJobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <Search className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="font-semibold text-foreground mb-1">
              {locale === 'fr' ? 'Aucune offre trouvee' : 'No jobs found'}
            </h3>
            <p className="text-sm text-muted-foreground max-w-xs">
              {locale === 'fr' 
                ? 'Essayez de modifier vos criteres de recherche'
                : 'Try adjusting your search criteria'}
            </p>
          </div>
        ) : (
          filteredJobs.map((job) => (
            <Link key={job.id} href={`/jobs/${job.id}`}>
              <Card className="overflow-hidden transition-all hover:shadow-md active:scale-[0.98]">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {job.urgent && (
                          <Badge variant="destructive" className="text-[10px]">
                            {locale === 'fr' ? 'URGENT' : 'URGENT'}
                          </Badge>
                        )}
                        <Badge variant="secondary" className="text-[10px]">
                          {job.type === 'shift' 
                            ? (locale === 'fr' ? 'Mission' : 'Shift')
                            : (locale === 'fr' ? 'Contrat' : 'Contract')}
                        </Badge>
                      </div>
                      
                      <h3 className="font-semibold text-foreground truncate">
                        {job.title}
                      </h3>
                      
                      <div className="flex items-center gap-1.5 mt-1 text-sm text-muted-foreground">
                        <Building2 className="h-3.5 w-3.5" />
                        <span className="truncate">{job.company}</span>
                      </div>
                      
                      <div className="flex items-center gap-1.5 mt-1 text-sm text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5" />
                        <span className="truncate">{job.location}</span>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="font-bold text-primary">
                        {formatCurrency(job.hourlyRate)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {job.currency}/h
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        <span>
                          {job.type === 'shift' 
                            ? formatDate(job.date!)
                            : `${formatDate(job.startDate!)} - ${formatDate(job.endDate!)}`}
                        </span>
                      </div>
                      {job.type === 'shift' && (
                        <div className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          <span>{job.startTime} - {job.endTime}</span>
                        </div>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))
        )}
      </div>
    </AppShell>
  )
}
