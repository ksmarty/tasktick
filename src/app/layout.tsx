import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import './globals.css';
import { Providers } from './providers';
import { ACCENT_COLORS } from '@/lib/types';

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
    // `default` keeps the status bar legible against our light chrome; both
    // appearances are handled by the theme tokens in globals.css.
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

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // `viewport-fit=cover` is what lets the app paint under the Dynamic Island and
  // the home indicator; globals.css then insets content with env(safe-area-*).
  viewportFit: 'cover',
  // Locking zoom keeps the installed app feeling native. The 16px minimum input
  // font-size (globals.css) is what prevents iOS from zooming on focus.
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f2f2f7' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
};

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
  const accent = accentCookie && (ACCENT_COLORS as readonly string[]).includes(accentCookie) ? accentCookie : 'blue';

  return (
    <html
      lang="en"
      data-accent={accent}
      className={themeCookie === 'dark' ? 'dark' : undefined}
      suppressHydrationWarning
    >
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
      <body className="bg-bg text-label antialiased">
        <Providers initialTheme={themeCookie} initialAccent={accent}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
