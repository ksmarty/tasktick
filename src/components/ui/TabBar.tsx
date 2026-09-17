'use client';

import { useRef, useState, type ComponentPropsWithoutRef, type KeyboardEvent } from 'react';
import { Ellipsis, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Badge } from './Badge';
import { Sheet } from './Sheet';
import { Z } from './internal';
import { TAB_BAR_MAX_ITEMS, resolveTabBarItems } from './tab-bar-layout';

/** Width of one tab plus the gap, i.e. the distance the capsule travels. */
const TAB_STRIDE = 48;

export interface TabBarItem<T extends string = string> {
  value: T;
  /** Short label under the glyph. */
  label: string;
  icon: LucideIcon;
  /** Count pill (or short string) on the glyph. */
  badge?: number | string;
  disabled?: boolean;
}

export interface TabBarProps<T extends string = string> extends Omit<ComponentPropsWithoutRef<'nav'>, 'onChange'> {
  items: readonly TabBarItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the tab list. Defaults to "Sections". */
  label?: string;
  /** Visible tabs before a "More" tab appears. Default 5, the iOS maximum. */
  max?: number;
  /** Label of the overflow tab. Defaults to "More". */
  moreLabel?: string;
}

/**
 * The translucent bottom tab bar: exactly `h-tabbar` tall, so it sits above the
 * home indicator instead of under it.
 *
 * At most five items (see `resolveTabBarItems`); anything beyond that moves
 * behind a "More" tab that opens a sheet. Every tab is a real `role="tab"` in a
 * `role="tablist"` with roving `tabindex` and arrow-key navigation, and the
 * active item takes the accent tint.
 */
export function TabBar<T extends string>({
  items,
  value,
  onChange,
  label = 'Sections',
  max = TAB_BAR_MAX_ITEMS,
  moreLabel = 'More',
  className,
  ...rest
}: TabBarProps<T>) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const { visible, overflow, hasOverflow } = resolveTabBarItems(items, max);
  const moreActive = overflow.some((item) => item.value === value);
  const slotCount = visible.length + (hasOverflow ? 1 : 0);

  /** Index of the active slot, for the sliding capsule. -1 when nothing matches. */
  const activeIndex = hasOverflow && moreActive ? slotCount - 1 : visible.findIndex((item) => item.value === value);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (slotCount === 0) return;
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const start = focusedIndex >= 0 ? focusedIndex : visible.findIndex((item) => item.value === value);
    const next = (((start < 0 ? 0 : start) + delta) % slotCount + slotCount) % slotCount;
    setFocusedIndex(next);
    tabRefs.current[next]?.focus();
  }

  function tabIndexFor(index: number, active: boolean): number {
    if (focusedIndex >= 0) return focusedIndex === index ? 0 : -1;
    return active ? 0 : -1;
  }

  function renderBadge(badge: number | string | undefined) {
    if (badge === undefined || badge === 0) return null;
    if (typeof badge === 'number') {
      return (
        <Badge
          variant="danger"
          value={badge}
          className="absolute -top-1 left-1/2 min-w-4 -translate-x-1/2 px-1"
        />
      );
    }
    return (
      <Badge variant="danger" className="absolute -top-1 left-1/2 min-w-4 -translate-x-1/2 px-1">
        {badge}
      </Badge>
    );
  }

  function renderInlineBadge(badge: number | string | undefined) {
    if (badge === undefined || badge === 0) return null;
    return typeof badge === 'number' ? (
      <Badge variant="danger" value={badge} />
    ) : (
      <Badge variant="danger">{badge}</Badge>
    );
  }

  return (
    <>
      <nav
        /*
         * No positioning and no `flex-1`.
         *
         * This is a flex child of the shell's floating bottom band, which holds
         * the tab bar and the action button side by side. `flex-1` stretched four
         * icon-sized tabs across the whole width, which looked loose and pushed
         * the button hard against the screen edge; sizing to content keeps the
         * pair compact and centred.
         */
        className={cn('glass relative flex w-auto items-center gap-1 rounded-full p-1.5', className)}
        style={{ zIndex: Z.chrome }}
        {...rest}
      >
        {/*
         * The active capsule, as ONE element that slides.
         *
         * Previously each tab painted its own background, so the highlight
         * appeared on one and vanished from another — a blink rather than a
         * movement. A single capsule travelling between tabs is what makes the
         * bar feel connected to the tap, and fixed-width tabs keep its geometry
         * exact instead of needing the positions measured.
         */}
        <span
          aria-hidden
          className="pointer-events-none absolute left-1.5 top-1.5 size-11 rounded-full bg-tint-soft transition-transform duration-300 ease-ios-spring"
          style={{ transform: `translateX(${Math.max(0, activeIndex) * TAB_STRIDE}px)` }}
        />

        <div
          role="tablist"
          aria-label={label}
          onKeyDown={onKeyDown}
          className="relative flex items-center gap-1"
        >
          {visible.map((item, index) => {
            const active = item.value === value;
            const Icon = item.icon;
            return (
              <button
                key={item.value}
                ref={(node) => {
                  tabRefs.current[index] = node;
                }}
                type="button"
                role="tab"
                aria-selected={active}
                disabled={item.disabled}
                tabIndex={tabIndexFor(index, active)}
                onClick={() => onChange(item.value)}
                className={cn(
                  'relative flex size-11 items-center justify-center',
                  'select-none disabled:opacity-40',
                  active ? 'text-tint' : 'text-secondary',
                  !item.disabled && 'pressable',
                )}
              >
                {/* The active tab sits in its own filled capsule, which is how
                    the current section is marked without a colour change alone. */}
                <span className="flex size-11 items-center justify-center">
                  <span
                    className={cn(
                      "relative transition-transform duration-300 ease-ios-spring",
                      active && "scale-110",
                    )}
                  >
                    <Icon className="size-[22px]" strokeWidth={active ? 2.25 : 1.75} aria-hidden />
                    {renderBadge(item.badge)}
                  </span>
                </span>
                <span className="sr-only">{item.label}</span>
              </button>
            );
          })}

          {hasOverflow ? (
            <button
              ref={(node) => {
                tabRefs.current[slotCount - 1] = node;
              }}
              type="button"
              role="tab"
              aria-selected={moreActive}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              tabIndex={tabIndexFor(slotCount - 1, moreActive)}
              onClick={() => setMoreOpen(true)}
              className={cn(
                'relative flex size-11 items-center justify-center',
                'select-none pressable',
                moreActive ? 'text-tint' : 'text-secondary',
              )}
            >
              <span className="flex size-11 items-center justify-center">
                <Ellipsis className="size-[22px]" strokeWidth={moreActive ? 2.25 : 1.75} aria-hidden />
              </span>
              <span className="sr-only">{moreLabel}</span>
            </button>
          ) : null}
        </div>
      </nav>

      {hasOverflow ? (
        <Sheet open={moreOpen} onOpenChange={setMoreOpen} title={moreLabel} dismissible>
          <div className="pb-2">
            {overflow.map((item) => {
              const Icon = item.icon;
              const active = item.value === value;
              return (
                <button
                  key={item.value}
                  type="button"
                  disabled={item.disabled}
                  onClick={() => {
                    setMoreOpen(false);
                    onChange(item.value);
                  }}
                  className={cn(
                    'flex min-h-11 w-full items-center gap-3 rounded-ios px-3 text-left text-body',
                    'disabled:opacity-40',
                    active ? 'font-semibold text-tint' : 'text-label',
                  )}
                >
                  <Icon className="size-5 shrink-0 text-tint" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {renderInlineBadge(item.badge)}
                </button>
              );
            })}
          </div>
        </Sheet>
      ) : null}
    </>
  );
}
