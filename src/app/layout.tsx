import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import './globals.css';
import { Providers } from './providers';
import { ACCENT_PREFERENCE } from '@/lib/types';

const APP_NAME = 'TaskTick';
const APP_DESCRIPTION =
  'A self-hosted task manager, calendar and habit tracker with bidirectional CalDAV sync.';

export const metadata: Metadata = {
  applicationName: APP_NAME,
  title: {
    default: APP_NAME,
    template: `%s · ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  manifest: '/manifest.webmanifest',
  // iOS ignores most of the manifest, so the standalone behaviour is declared here.
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    // `default` keeps the status bar legible against the light chrome; both
    // appearances are handled by the `theme-color` meta below.
    statusBarStyle: 'default',
  },
  formatDetection: { telephone: false, email: false, address: false },
  icons: {
    icon: [
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/favicon.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    // A single 180x180 opaque PNG: iOS applies its own mask, and a transparent
    // or pre-rounded icon renders with black corners on the Home Screen.
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  other: {
    // Enables the "Add to Home Screen" full-screen experience on older iOS.
    'apple-mobile-web-app-capable': 'yes',
    'mobile-web-app-capable': 'yes',
  },
};

/**
 * GodUI's Celestial Sapphire background, per appearance, for the OS-drawn band.
 *
 * These mirror `--background` in `globals.css` (`oklch(1 0 0)` light,
 * `oklch(0.145 0 0)` dark). They are duplicated as hex because `theme-color`
 * has to be correct in the very first HTML response — before any CSS is parsed,
 * and long before a script could read a custom property back out.
 *
 * The band behind the status bar and the Dynamic Island is painted by the OS
 * from this meta; it is not the page background, so giving `html` a background
 * does nothing for it. iOS honours a single `theme-color` and ignores the
 * `media` attribute, taking whichever tag it finds last — so exactly one value
 * is emitted, chosen for the appearance this request will actually use.
 * Emitting the light/dark pair is what painted the band black over a light app.
 */
const THEME_COLOR = {
  light: '#ffffff',
  dark: '#252525',
} as const;

export async function generateViewport(): Promise<Viewport> {
  const store = await cookies();
  const preference = store.get('tasktick-theme')?.value;

  return {
    width: 'device-width',
    initialScale: 1,
    // `viewport-fit=cover` is what lets the app paint under the Dynamic Island and
    // the home indicator; components inset themselves with env(safe-area-*).
    viewportFit: 'cover',
    // Locking zoom keeps the installed app feeling native. The 16px minimum input
    // font-size (globals.css) is what prevents iOS from zooming on focus.
    maximumScale: 1,
    userScalable: false,
    themeColor: THEME_COLOR[preference === 'dark' ? 'dark' : 'light'],
  };
}

/** Splash screens, keyed by the CSS media query that selects the device. */
const SPLASH_SCREENS: { file: string; media: string }[] = [
  { file: 'splash-1290x2796', media: '(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)' },
  { file: 'splash-1179x2556', media: '(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)' },
  { file: 'splash-1170x2532', media: '(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)' },
  { file: 'splash-1284x2778', media: '(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3)' },
  { file: 'splash-1125x2436', media: '(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)' },
  { file: 'splash-2048x2732', media: '(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2)' },
];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Read the appearance from cookies rather than the database: the root layout
  // renders for signed-out pages too, and a DB round trip here would make every
  // request pay for a preference only signed-in users have.
  const store = await cookies();
  const themeCookie = store.get('tasktick-theme')?.value ?? 'system';
  const accentCookie = store.get('tasktick-accent')?.value;
  // 'default' keeps the app monochrome unless the user picks a colour, so
  // enabling the accent does not change how it looks for anyone who never asked.
  const accent =
    accentCookie && (ACCENT_PREFERENCE as readonly string[]).includes(accentCookie) ? accentCookie : 'default';

  return (
    <html lang="en" data-accent={accent} suppressHydrationWarning>
      <head>
        {SPLASH_SCREENS.map((screen) => (
          <link
            key={screen.file}
            rel="apple-touch-startup-image"
            href={`/splash/${screen.file}.png`}
            media={screen.media}
          />
        ))}
        {/*
          Resolves the appearance before first paint so a dark-mode user never
          sees a white flash. Kept tiny and synchronous, and it must tolerate
          localStorage being unavailable (Safari private mode).

          This toggles the `dark` class that GodUI's tokens are keyed on
          (`@custom-variant dark (&:where(.dark, .dark *))` in globals.css).
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{
var s=localStorage.getItem('tasktick-theme')||${JSON.stringify(themeCookie)};
var d=s==='dark'||(s!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
document.documentElement.classList.toggle('dark',d);
var a=localStorage.getItem('tasktick-accent')||${JSON.stringify(accent)};
document.documentElement.setAttribute('data-accent',a);
}catch(e){}})();`,
          }}
        />
      </head>
      <body className="bg-background text-foreground antialiased">
        <Providers initialTheme={themeCookie} initialAccent={accent}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
