'use client';

/**
 * Client providers for the whole app.
 *
 * Kept deliberately thin. The appearance is owned by MUI now: `useColorScheme`
 * resolves the preference, writes the palette class onto `<html>`, and persists
 * it, so there is no hand-rolled matchMedia listener or class toggle left here.
 * What remains app-specific is the `theme-color` meta (the OS paints the status
 * bar and Dynamic Island from it) and the accent preference.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from '@mui/material/styles';
import { ServiceWorkerRegistrar } from '@/components/pwa/ServiceWorkerRegistrar';
import { OfflineBanner } from '@/components/pwa/OfflineBanner';
import { ToastProvider } from '@/components/app/Toast';
import { THEME_COLOR } from '@/lib/theme-colors';
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
  const { mode, setMode, colorScheme } = useColorScheme();
  const [accent, setAccentState] = useState<AccentColor>(initialAccent as AccentColor);

  const theme: ThemePreference =
    mode === 'light' || mode === 'dark' ? mode : 'system';

  /*
   * `colorScheme` is the *resolved* appearance — MUI has already folded the
   * system preference in — which is what the OS-drawn band needs. The server
   * emits a single `theme-color` (see `generateViewport`) because iOS ignores
   * `media` on that tag and a light/dark pair collapses to whichever comes last,
   * which painted the status bar black over a light app. A single tag means the
   * client maintains it, and this is the effect that knows the real value.
   */
  const resolvedTheme: 'light' | 'dark' = colorScheme === 'dark' ? 'dark' : 'light';

  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = THEME_COLOR[resolvedTheme];
  }, [resolvedTheme]);

  // Mirrored into a cookie so the next request can render the right theme-color
  // and colour scheme server-side, before any script runs.
  useEffect(() => {
    writeCookie('tasktick-theme', theme);
  }, [theme]);

  useEffect(() => {
    // The cookie is the SSR source of truth; localStorage is the client one. They
    // can disagree if the cookie was cleared, so the client wins on mount.
    try {
      const stored = localStorage.getItem('tasktick-accent');
      if (stored) setAccentState(stored as AccentColor);
    } catch {
      /* localStorage is unavailable in private mode; the cookie still works. */
    }
  }, []);

  const setTheme = useCallback(
    (next: ThemePreference) => {
      // MUI persists the preference itself; the cookie is only for SSR.
      setMode(next);
      writeCookie('tasktick-theme', next);
    },
    [setMode],
  );

  const setAccent = useCallback((next: AccentColor) => {
    setAccentState(next);
    try {
      localStorage.setItem('tasktick-accent', next);
    } catch {
      /* localStorage is unavailable in private mode; the cookie still works. */
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
