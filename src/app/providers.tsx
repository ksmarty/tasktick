'use client';

/**
 * Client providers for the whole app.
 *
 * Kept deliberately thin. The theme is applied by resolving cookies on the
 * server and mirrored to localStorage here so the preference survives a logout
 * and the next cold start still knows the appearance.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ServiceWorkerRegistrar } from '@/components/pwa/ServiceWorkerRegistrar';
import { OfflineBanner } from '@/components/pwa/OfflineBanner';
import { ToastProvider } from '@/components/ui';
import type { AccentColor } from '@/lib/types';

type ThemePreference = 'light' | 'dark' | 'system';

interface AppearanceContextValue {
  theme: ThemePreference;
  accent: AccentColor;
  /** Resolved appearance after applying the system preference. */
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: ThemePreference) => void;
  setAccent: (accent: AccentColor) => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function writeCookie(name: string, value: string) {
  // A year, path-wide, SameSite=Lax: this is a display preference, not a secret,
  // and it must be readable by the server on the very next request.
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; SameSite=Lax`;
}

export function Providers({
  children,
  initialTheme = 'system',
  initialAccent = 'blue',
}: {
  children: React.ReactNode;
  initialTheme?: string;
  initialAccent?: string;
}) {
  const [theme, setThemeState] = useState<ThemePreference>(
    initialTheme === 'light' || initialTheme === 'dark' ? initialTheme : 'system',
  );
  const [accent, setAccentState] = useState<AccentColor>(initialAccent as AccentColor);
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    setSystemDark(systemPrefersDark());

    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    mql.addEventListener('change', listener);

    // Reflect whatever the pre-paint inline script already decided, so the React
    // state and the DOM cannot disagree about the current appearance.
    try {
      const storedTheme = localStorage.getItem('tasktick-theme');
      if (storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'system') setThemeState(storedTheme);
      const storedAccent = localStorage.getItem('tasktick-accent');
      if (storedAccent) setAccentState(storedAccent as AccentColor);
    } catch {
      /* localStorage is unavailable in private mode; the cookie still works. */
    }

    return () => mql.removeEventListener('change', listener);
  }, []);

  const resolvedTheme: 'light' | 'dark' = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
  }, [resolvedTheme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-accent', accent);
  }, [accent]);

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next);
    try {
      localStorage.setItem('tasktick-theme', next);
    } catch {
      /* ignore */
    }
    writeCookie('tasktick-theme', next);
  }, []);

  const setAccent = useCallback((next: AccentColor) => {
    setAccentState(next);
    try {
      localStorage.setItem('tasktick-accent', next);
    } catch {
      /* ignore */
    }
    writeCookie('tasktick-accent', next);
  }, []);

  const value = useMemo(
    () => ({ theme, accent, resolvedTheme, setTheme, setAccent }),
    [theme, accent, resolvedTheme, setTheme, setAccent],
  );

  return (
    <AppearanceContext.Provider value={value}>
      <ToastProvider>
        <ServiceWorkerRegistrar />
        <OfflineBanner />
        {children}
      </ToastProvider>
    </AppearanceContext.Provider>
  );
}

export function useAppearance(): AppearanceContextValue {
  const context = useContext(AppearanceContext);
  if (!context) throw new Error('useAppearance must be used inside <Providers>');
  return context;
}
