'use client'

import * as React from 'react'
import { AppShell } from '@/components/layout/app-shell'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/i18n'
import { Briefcase, Search, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

type TabType = 'applied' | 'booked' | 'completed'

export default function MyJobsPage() {
  const { locale } = useTranslation()
  const [activeTab, setActiveTab] = React.useState<TabType>('applied')

  const tabs: { id: TabType; label: string; labelEn: string }[] = [
    { id: 'applied', label: 'Candidatures', labelEn: 'Applied' },
    { id: 'booked', label: 'Reservees', labelEn: 'Booked' },
    { id: 'completed', label: 'Terminees', labelEn: 'Completed' },
  ]

  // Empty state for all tabs
  const hasJobs = false

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

        {!hasJobs ? (
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
                  ? 'Vous n\'avez pas encore postule a des offres.'
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
        ) : (
          <div className="space-y-3">
            {/* Jobs will be displayed here based on activeTab */}
          </div>
        )}
      </div>
    </AppShell>
  )
}
