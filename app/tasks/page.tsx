'use client'

import * as React from 'react'
import { AppShell } from '@/components/layout/app-shell'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/i18n'
import { ClipboardList, Calendar, ChevronRight } from 'lucide-react'
import Link from 'next/link'

export default function TasksPage() {
  const { locale } = useTranslation()

  // Empty state for now
  const hasTasks = false

  return (
    <AppShell>
      <div className="px-4 py-6">
        <h1 className="text-2xl font-bold text-foreground mb-6">
          {locale === 'fr' ? 'Taches' : 'Tasks'}
        </h1>

        {!hasTasks ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="relative mb-6">
              <div className="h-24 w-24 rounded-3xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
                <ClipboardList className="h-12 w-12 text-primary" />
              </div>
              <div className="absolute -bottom-2 -right-2 h-10 w-10 rounded-xl bg-card border-2 border-background flex items-center justify-center">
                <Calendar className="h-5 w-5 text-muted-foreground" />
              </div>
            </div>
            
            <h2 className="text-xl font-semibold text-foreground mb-2">
              {locale === 'fr' ? 'Vous etes pret !' : "You're all set!"}
            </h2>
            <p className="text-muted-foreground max-w-xs mb-6">
              {locale === 'fr'
                ? 'Aucune tache en attente. Explorez les offres pour trouver votre prochaine mission.'
                : 'No pending tasks. Explore jobs to find your next opportunity.'}
            </p>
            
            <Link href="/jobs">
              <Button>
                {locale === 'fr' ? 'Decouvrir les offres' : 'Discover jobs'}
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Tasks will be displayed here */}
          </div>
        )}
      </div>
    </AppShell>
  )
}
