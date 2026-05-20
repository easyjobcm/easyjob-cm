'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { fr } from './fr'
import { en } from './en'
import type { TranslationKeys } from './fr'
import type { Locale } from '@/lib/types'

const translations: Record<Locale, TranslationKeys> = { fr, en }

interface I18nContextType {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: TranslationKeys
}

const I18nContext = createContext<I18nContextType | undefined>(undefined)

function detectBrowserLocale(): Locale {
  if (typeof window === 'undefined') return 'fr'
  
  const browserLang = navigator.language.split('-')[0]
  return browserLang === 'en' ? 'en' : 'fr'
}

function getStoredLocale(): Locale | null {
  if (typeof window === 'undefined') return null
  
  const stored = localStorage.getItem('easyjob_locale')
  if (stored === 'fr' || stored === 'en') return stored
  return null
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('fr')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // On mount, check stored locale or detect from browser
    const stored = getStoredLocale()
    const detected = stored || detectBrowserLocale()
    setLocaleState(detected)
    setMounted(true)
  }, [])

  const setLocale = (newLocale: Locale) => {
    setLocaleState(newLocale)
    localStorage.setItem('easyjob_locale', newLocale)
    document.documentElement.lang = newLocale
  }

  useEffect(() => {
    if (mounted) {
      document.documentElement.lang = locale
    }
  }, [locale, mounted])

  const value: I18nContextType = {
    locale,
    setLocale,
    t: translations[locale],
  }

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider')
  }
  return context
}

// Helper hook for just translations
export function useTranslations() {
  return useI18n().t
}
