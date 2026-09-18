import Link from 'next/link';
import { ArrowLeftIcon } from '@svg-animated-icons/react/arrow-left';
import { Button } from '@/components/ui/button';

/**
 * The back control for a settings sub-screen.
 *
 * Stated once rather than retyped on all four sub-screens, because the thing that
 * must not drift here is the accessible name: `aria-label="Back to Settings"` is
 * what a screen reader announces, and four hand-copied variants of it is four
 * chances to lose it. It is published into the shell's header through
 * `PageHeader`'s `leading` slot by the page that renders it.
 */
export function BackToSettings() {
  return (
    <Button variant="ghost" size="icon" asChild>
      <Link href="/settings" aria-label="Back to Settings">
        <ArrowLeftIcon />
      </Link>
    </Button>
  );
}
