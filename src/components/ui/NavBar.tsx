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
        <div
          className={cn('flex flex-col pt-safe', !largeTitle && 'h-header')}
          style={largeTitle ? { minHeight: headerHeight } : undefined}
        >
          <div className="flex h-11 items-center justify-between gap-2 px-2">
            <div className="flex min-w-0 items-center gap-1">{back ? backControl : leading}</div>

            {largeTitle ? (
              <span aria-hidden className={cn('truncate px-2 text-headline font-semibold text-label transition-opacity duration-200 ease-ios', collapsed ? 'opacity-100' : 'opacity-0')}>
                {title}
              </span>
            ) : (
              <h1 className="truncate px-2 text-headline font-semibold text-label">{title}</h1>
            )}

            <div className="flex min-w-0 items-center gap-1">{trailing}</div>
          </div>

          {largeTitle ? (
            <div
              className={cn(
                'overflow-hidden transition-[height,opacity] duration-200 ease-ios-out',
                collapsed ? 'h-0 opacity-0' : 'opacity-100',
              )}
              style={collapsed ? undefined : { height: LARGE_TITLE_BLOCK }}
            >
              <h1 className="truncate px-4 pb-2 text-large-title font-bold text-label">{title}</h1>
            </div>
          ) : null}

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
