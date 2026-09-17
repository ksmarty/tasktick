'use client';

import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Z, usePageScrollOffset } from './internal';

/** Height of the collapsing large-title block (iOS `.large` is 52pt). */
const LARGE_TITLE_BLOCK = '3.25rem';
/** Scroll offset at which the large title hands over to the inline one. */
const COLLAPSE_AT_PX = 8;

export interface NavBarProps extends Omit<ComponentPropsWithoutRef<'header'>, 'title'> {
  title?: ReactNode;
  /**
   * iOS large-title mode: the big title sits under the compact bar and
   * collapses — fading into the small inline title — as the page scrolls.
   */
  largeTitle?: boolean;
  /** Custom leading slot (replaces the back button). */
  leading?: ReactNode;
  /** Trailing slot: an `IconButton`, a `Button`, anything. */
  trailing?: ReactNode;
  /** Renders the iOS back chevron + label on the leading edge. */
  back?: boolean;
  /** Back target; when omitted the back control is a button calling `onBack`. */
  backHref?: string;
  onBack?: () => void;
  /** Visible back label. Defaults to "Back". */
  backLabel?: string;
  /** Hairline under the bar. */
  border?: boolean;
  /** Render the same-height spacer that keeps page content clear of the bar. Default true. */
  spacer?: boolean;
}

const BACK_CLASSES =
  '-ml-1 inline-flex min-h-11 items-center gap-0.5 rounded-ios pr-1 pl-0.5 text-body text-tint pressable';

/**
 * The translucent top bar. The compact bar row is exactly `h-header` tall —
 * safe-area inset plus the 44pt nav height — so it clears the Dynamic Island
 * on a notched phone and collapses to 44pt elsewhere.
 *
 * The spacer (rendered next to the fixed bar, in normal flow) reserves the
 * bar's height, so views can drop `<NavBar />` at the top of their scroll
 * container and start writing content immediately.
 */
export function NavBar({
  title,
  largeTitle = false,
  leading,
  trailing,
  back = false,
  backHref,
  onBack,
  backLabel = 'Back',
  border = false,
  spacer = true,
  className,
  children,
  ...rest
}: NavBarProps) {
  // Called unconditionally: hooks may not sit behind `largeTitle`.
  const scrollOffset = usePageScrollOffset();
  const collapsed = largeTitle && scrollOffset > COLLAPSE_AT_PX;
  const headerHeight = 'calc(env(safe-area-inset-top, 0px) + var(--nav-h))';

  const backControl = backHref ? (
    <Link href={backHref} className={BACK_CLASSES}>
      <ChevronLeft className="size-5 shrink-0" strokeWidth={2.5} aria-hidden />
      {backLabel}
    </Link>
  ) : (
    <button type="button" onClick={onBack} className={BACK_CLASSES}>
      <ChevronLeft className="size-5 shrink-0" strokeWidth={2.5} aria-hidden />
      {backLabel}
    </button>
  );

  return (
    <>
      {/*
       * `sticky`, not `fixed`.
       *
       * The shell is a two-column frame on desktop, with the sidebar occupying
       * the left. A `fixed` bar is positioned against the viewport, so it would
       * stretch across the sidebar and bury the brand and the first sidebar
       * rows underneath it. Sticky is scoped to the scrolling column instead, so
       * the bar belongs to the content it titles — and on mobile, where that
       * column is the whole screen, the two are visually identical.
       *
       * `glass-chrome` is used rather than `glass` because this sits above
       * scrolling content: more blur, less tint, so text passing underneath
       * stays legible as colour rather than mush.
       */}
      <header
        className={cn('glass-chrome sticky top-0 isolate', border && 'hairline-b', className)}
        style={{ zIndex: Z.chrome }}
        {...rest}
      >
        {/*
         * ONE row for a large-title bar: back control, title and actions share a
         * single line, with the title shrinking as the page scrolls instead of a
         * second block collapsing out of the way.
         *
         * The previous two-row treatment (a compact strip on top of a 52px
         * title block) cost about 96px of a phone's height before any content
         * started, and left the actions floating in the strip above the title
         * rather than beside it. Collapsing the title's SIZE rather than its
         * presence keeps the same effect with half the vertical cost.
         */}
        <div className={cn('flex flex-col pt-safe', !largeTitle && 'h-header')}>
          <div
            className={cn(
              'flex items-center justify-between gap-3 px-3',
              largeTitle ? 'pb-1.5' : 'h-11',
            )}
          >
            <div className="flex min-w-0 flex-1 items-center gap-1">
              {back ? backControl : leading}
              <h1
                className={cn(
                  'truncate font-bold text-label transition-[font-size] duration-200 ease-ios',
                  largeTitle ? (collapsed ? 'text-headline' : 'text-title-1') : 'text-headline',
                )}
              >
                {title}
              </h1>
            </div>

            {/*
             * Actions are round, floating controls rather than bare glyphs,
             * matching the header buttons in the reference.
             */}
            <div className="flex min-w-0 shrink-0 items-center gap-2">{trailing}</div>
          </div>
          {children}
        </div>
      </header>

      {/*
       * No spacer.
       *
       * `sticky` keeps the bar in normal flow, so it already occupies its own
       * height; a spacer on top of that would insert a gap the size of the
       * header. The `spacer` prop is retained so existing callers keep
       * compiling, but it is now inert by design.
       */}
    </>
  );
}
