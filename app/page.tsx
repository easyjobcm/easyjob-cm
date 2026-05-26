'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/i18n'
import { Briefcase, Users, Shield, ChevronRight } from 'lucide-react'
import Image from 'next/image'

export default function WelcomePage() {
  const router = useRouter()
  const { t, locale, setLocale } = useTranslation()

  const features = [
    {
      icon: Briefcase,
      title: locale === 'fr' ? 'Missions flexibles' : 'Flexible jobs',
      description: locale === 'fr' 
        ? 'Trouvez des missions adaptees a votre emploi du temps' 
        : 'Find jobs that fit your schedule',
    },
    {
      icon: Users,
      title: locale === 'fr' ? 'Entreprises verifiees' : 'Verified companies',
      description: locale === 'fr'
        ? 'Travaillez avec des employeurs de confiance'
        : 'Work with trusted employers',
    },
    {
      icon: Shield,
      title: locale === 'fr' ? 'Paiements securises' : 'Secure payments',
      description: locale === 'fr'
        ? 'Recevez vos paiements via Mobile Money'
        : 'Get paid via Mobile Money',
    },
  ]

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Decorative background */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute top-1/3 -left-20 h-60 w-60 rounded-full bg-accent/30 blur-3xl" />
        <div className="absolute bottom-20 right-10 h-40 w-40 rounded-full bg-primary/10 blur-2xl" />
      </div>

      {/* Language toggle */}
      <div className="relative z-10 flex justify-end p-4">
        <button
          onClick={() => setLocale(locale === 'fr' ? 'en' : 'fr')}
          className="flex items-center gap-2 rounded-full bg-card/50 px-3 py-1.5 text-sm font-medium backdrop-blur-sm border border-border/50 transition-all hover:bg-card"
        >
          {locale === 'fr' ? 'FR' : 'EN'}
        </button>
      </div>

      {/* Hero section */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 pb-8">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center">
          <div className="relative mb-4 animate-float">
            <div className="relative w-28 h-28 animate-pulse-glow">
              <Image
                src="/images/easyjob-logo.png"
                alt="EasyJob CM"
                fill
                className="object-contain"
                priority
              />
            </div>
          </div>
          <h1 className="text-3xl font-bold bg-gradient-primary bg-clip-text text-primary">
            EasyJob
          </h1>
          <p className="text-muted-foreground text-sm">{locale === 'fr' ? 'Cameroun' : 'Cameroon'}  </p>
        </div>

        {/* Tagline */}
        <div className="mb-10 text-center">
          <h2 className="mb-2 text-xl font-semibold text-foreground">
            {locale === 'fr' 
              ? 'Votre prochaine mission vous attend' 
              : 'Your next job awaits'}
          </h2>
          <p className="text-muted-foreground max-w-xs">
            {locale === 'fr'
              ? 'Connectez-vous avec des entreprises locales et trouvez des opportunites flexibles'
              : 'Connect with local businesses and find flexible opportunities'}
          </p>
        </div>

        {/* Features */}
        <div className="mb-10 w-full max-w-sm space-y-3">
          {features.map((feature, index) => (
            <div
              key={index}
              className="glass-card flex items-start gap-3 rounded-2xl p-4 transition-all hover:scale-[1.02]"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                <feature.icon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-medium text-foreground">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </div>
            </div>
          ))}
        </div>

        {/* CTAs */}
        <div className="w-full max-w-sm space-y-3">
          <Button
            onClick={() => router.push('/auth/signup')}
            className="w-full"
            size="lg"
          >
            {t('auth.getStarted')}
            <ChevronRight className="ml-2 h-4 w-4" />
          </Button>
          
          <Button
            onClick={() => router.push('/auth/login')}
            variant="outline"
            className="w-full"
            size="lg"
          >
            {t('auth.login')}
          </Button>
        </div>

        {/* Terms */}
        <p className="mt-6 text-center text-xs text-muted-foreground max-w-xs">
          {locale === 'fr' ? (
            <>
              En continuant, vous acceptez nos{' '}
              <Link href="/legal/terms" className="text-primary underline">
                Conditions d&apos;utilisation
              </Link>{' '}
              et notre{' '}
              <Link href="/legal/privacy" className="text-primary underline">
                Politique de confidentialite
              </Link>
            </>
          ) : (
            <>
              By continuing, you agree to our{' '}
              <Link href="/legal/terms" className="text-primary underline">
                Terms of Service
              </Link>{' '}
              and{' '}
              <Link href="/legal/privacy" className="text-primary underline">
                Privacy Policy
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
