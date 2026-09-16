'use client';

/**
 * Agenda: an endless list of upcoming days and what is on them.
 *
 * "Endless" without a scroll hack: reaching the sentinel at the bottom asks the
 * screen for a longer range, and the screen widens the *requested* range, so the
 * extra days arrive from the same single `/api/calendar/items` query the other
 * views use. The server caps a range at 400 days, which is what `hasMore` tracks.
 */
import { useEffect, useMemo, useRef } from 'react';
import { CalendarDays } from 'lucide-react';
import { accentHex } from '@/lib/colors';
import { formatTime, fromDateOnly, relativeDayLabel } from '@/lib/dates';
import { cn } from '@/lib/cn';
import type { CalendarItem, DateOnly } from '@/lib/types';
import type { CalendarItemsPayload } from '@/lib/view-types';
import { EmptyState, Spinner } from '@/components/ui';
import { itemColor } from './colors';
import type { CalendarLookup, CalendarPrefs, ItemOpenHandler } from './types';

export interface AgendaViewProps {
  days: DateOnly[];
  today: DateOnly;
  payload: CalendarItemsPayload;
  prefs: CalendarPrefs;
  calendars: CalendarLookup;
  onOpenItem: ItemOpenHandler;
  /** Opens the day detail sheet for a day header. */
  onOpenDay: (date: DateOnly) => void;
  /** Widens the requested range; called when the list is scrolled to the end. */
  onLoadMore: () => void;
  hasMore: boolean;
  isLoadingMore: boolean;
}

interface AgendaGroup {
  date: DateOnly;
  items: CalendarItem[];
}

export function AgendaView({
  days,
  today,
  payload,
  prefs,
  calendars,
  onOpenItem,
  onOpenDay,
  onLoadMore,
  hasMore,
  isLoadingMore,
}: AgendaViewProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  const groups = useMemo<AgendaGroup[]>(
    () => days.map((date) => ({ date, items: payload.days[date] ?? [] })).filter((group) => group.items.length > 0),
    [days, payload.days],
  );

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      { rootMargin: '300px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore]);

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="Nothing scheduled"
        description="Your upcoming days are clear. Events and scheduled tasks will show up here."
      />
    );
  }

  return (
    <div className="pb-8">
      {groups.map((group) => (
        <section key={group.date} aria-labelledby={`agenda-${group.date}`}>
          <h2
            id={`agenda-${group.date}`}
            className="material sticky z-20 flex items-baseline justify-between gap-2 px-4 py-1.5 text-footnote"
            style={{ top: 'var(--header-total)' }}
          >
            <button
              type="button"
              onClick={() => onOpenDay(group.date)}
              className={cn(
                'min-h-8 rounded-ios px-1 font-semibold uppercase tracking-wide pressable',
                group.date === today ? 'text-tint' : 'text-secondary',
              )}
            >
              {relativeDayLabel(group.date, prefs.zone)}
            </button>
            <span className="text-tertiary">{fromDateOnly(group.date, prefs.zone).toFormat('d LLL yyyy')}</span>
          </h2>

          <ul className="grouped mx-4">
            {group.items.map((item) => {
              const color = itemColor(item, calendars);
              const time = item.isAllDay ? 'All day' : formatTime(item.startMs, prefs);
              const isTask = item.kind === 'task';

              return (
                <li key={item.key} className="hairline-b last:border-b-0">
                  <button
                    type="button"
                    onClick={() => onOpenItem(item)}
                    className="flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left pressable-row"
                  >
                    <span
                      aria-hidden
                      className={cn('shrink-0 rounded-full', isTask ? 'size-2.5 border border-dashed' : 'size-2.5')}
                      style={isTask ? { borderColor: accentHex(color), backgroundColor: 'transparent' } : { backgroundColor: accentHex(color) }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate text-body', item.completed && 'text-secondary line-through')}>
                        {isTask ? (
                          <span aria-hidden className="mr-1">
                            {item.completed ? '☑' : '☐'}
                          </span>
                        ) : null}
                        {item.title}
                      </span>
                      {item.location ? (
                        <span className="mt-0.5 block truncate text-footnote text-secondary">{item.location}</span>
                      ) : null}
                    </span>
                    <span className="tnum shrink-0 text-footnote text-secondary">{time}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <div ref={sentinelRef} className="flex min-h-16 items-center justify-center py-4">
        {hasMore ? (
          isLoadingMore ? (
            <Spinner size={20} decorative />
          ) : (
            <span className="text-footnote text-tertiary">Scroll for more</span>
          )
        ) : (
          <span className="text-footnote text-tertiary">That is the end of the agenda.</span>
        )}
      </div>
    </div>
  );
}
