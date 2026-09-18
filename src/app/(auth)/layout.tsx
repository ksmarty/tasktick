import { SafeAreaFrame } from '@/components/app/SafeAreaFrame';
import { DecorativeBackground } from '@/components/godui/decorative-background';

/**
 * Chrome-less layout for the signed-out screens.
 *
 * Centres a narrow card and insets for the Dynamic Island and home indicator, so
 * the sign-in form is usable on an iPhone in landscape as well as portrait.
 *
 * These screens render *before* the app shell exists, so this layout owns its own
 * full-height frame: `SafeAreaFrame` is that frame, and it insets on all four
 * edges from `env(safe-area-inset-*)`, which resolve to `0px` off-device. It was
 * a two-inset Material frame when this layout was written; the app area has
 * since rewritten it as a plain all-four-inset element, which is exactly what
 * these routes need, so the layout now composes it instead of repeating it.
 *
 * The frame supplies the insets; the `px-gutter` token is on the inner element.
 * They are deliberately not on one element: that would have to express
 * "safe area + token" as a single `calc()` arbitrary value, which is exactly the
 * kind of invented spacing the layout scale exists to remove.
 *
 * The card is a plain element rather than `ui/card`: that component hard-codes
 * `py-6`, and a named spacing utility (`p-card`) is emitted *before* the numeric
 * scale in Tailwind's output, so `py-6` would win the merge and leave the card
 * padded 1rem horizontally and 1.5rem vertically — the exact drift the token
 * exists to prevent. Its surface classes are the same ones `Card` uses.
 *
 * Deliberately no entrance animation: a transforming wrapper would become the
 * containing block for the app-global fixed PWA banners, and a client-only
 * animation library import here would break the server render of the route. The
 * decorative wash is a plain absolutely-positioned layer for the same reason.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaFrame className="relative flex flex-col items-center justify-center bg-background">
      <DecorativeBackground
        style={{
          // The registry's baked default is a light-mode-only indigo wash. This
          // is the same shape drawn from the Celestial Sapphire tokens, so it
          // follows the appearance the app is actually in.
          backgroundImage:
            'radial-gradient(125% 125% at 50% 10%, var(--background) 40%, var(--rainbow-1) 100%)',
        }}
      />
      <div className="relative z-10 w-full max-w-sm px-gutter py-10">
        <div className="rounded-xl border bg-card p-card text-card-foreground shadow-lg">
          {children}
        </div>
      </div>
    </SafeAreaFrame>
  );
}
