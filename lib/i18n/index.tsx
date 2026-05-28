"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { fr } from "./fr";
import { en } from "./en";
import type { TranslationKeys } from "./fr";
import type { Locale } from "@/lib/types";

const translations: Record<Locale, TranslationKeys> = { fr, en };

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TranslationKeys;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

function detectBrowserLocale(): Locale {
  if (typeof window === "undefined") return "fr";

  const browserLang = navigator.language.split("-")[0];
  return browserLang === "en" ? "en" : "fr";
}

function getStoredLocale(): Locale | null {
  if (typeof window === "undefined") return null;

  const stored = localStorage.getItem("easyjob_locale");
  if (stored === "fr" || stored === "en") return stored;
  return null;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  // SSR + premier render client : toujours "fr" pour matcher <html lang="fr">.
  // La locale réelle (storage / navigator) est appliquée après le mount.
  const [locale, setLocaleState] = useState<Locale>("fr");

  useEffect(() => {
    const detected = getStoredLocale() || detectBrowserLocale();
    if (detected !== locale) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocaleState(detected);
    }
    // On ne veut exécuter ceci qu'au mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLocale = (newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem("easyjob_locale", newLocale);
    document.documentElement.lang = newLocale;
  };

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value: I18nContextType = {
    locale,
    setLocale,
    t: translations[locale],
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
}

// Helper hook for just translations
export function useTranslations() {
  return useI18n().t;
}

// Alias for useI18n - returns locale, setLocale, and t function
export function useTranslation() {
  const { locale, setLocale, t } = useI18n();
  return {
    locale,
    setLocale,
    t: (key: string) => {
      const keys = key.split(".");
      let value: unknown = t;
      for (const k of keys) {
        if (value && typeof value === "object" && k in value) {
          value = (value as Record<string, unknown>)[k];
          continue;
        }
        return key;
      }
      return typeof value === "string" ? value : key;
    },
  };
}
