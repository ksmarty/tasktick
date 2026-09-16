import { SafeAreaFrame } from '@/components/app/SafeAreaFrame';

/**
 * Chrome-less layout for the signed-out screens.
 *
 * Centres a narrow column and pads for the Dynamic Island and home indicator, so
 * the sign-in form is usable on an iPhone in landscape as well as portrait.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaFrame className="app-backdrop flex min-h-dvh flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm animate-ios-in">{children}</div>
    </SafeAreaFrame>
  );
}
