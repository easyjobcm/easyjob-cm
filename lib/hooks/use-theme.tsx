"use client";

import * as React from "react";

type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  mounted: boolean;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "easyjob-theme";

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
  root.style.colorScheme = theme;
}

function readInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Lazy initializer: reads localStorage / system preference once on mount.
  // readInitialTheme() already guards typeof window === "undefined" for SSR.
  const [theme, setThemeState] = React.useState<Theme>(readInitialTheme);

  // `mounted` stays false during SSR and the first hydration render (matching
  // server output). It flips to true after the first client-side effect, so
  // theme-dependent UI only renders the real value after hydration.
  const [mounted, setMounted] = React.useState(false);

  // Sync the DOM whenever the theme value changes (external system update).
  React.useEffect(() => {
    applyTheme(theme);
    // Mark as mounted after the first DOM sync — safe to call setState here
    // because we are already inside an effect (no cascading render from SSR).
    if (!mounted) setMounted(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  const setTheme = React.useCallback((next: Theme) => {
    setThemeState(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore quota / private mode
    }
  }, []);

  const toggleTheme = React.useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  const value = React.useMemo(
    () => ({ theme, mounted, toggleTheme, setTheme }),
    [theme, mounted, toggleTheme, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return ctx;
}
