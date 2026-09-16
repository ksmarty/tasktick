'use client';

/**
 * The day detail sheet: everything happening on one day.
 *
 * This is what a tap on a month cell (or its "+N more" row) opens, and it is the
 * only place a crowded day is shown in full — hence the explicit "New event"
 * action, so the sheet is also the quickest way to add something to that day.
 */
import { CalendarDays, Check, Plus } from 'lucide-react';
import { accentHex, resolveCalendarColor } from '@/lib/colors';
import { formatTime, fromDateOnly, relativeDayLabel } from '@/lib/dates';
import { cn } from '@/lib/cn';
import type { CalendarItem, DateOnly } from '@/lib/types';
import { Button, EmptyState, Sheet } from '@/components/ui';
import type { CalendarLookup, CalendarPrefs, ItemOpenHandler } from './types';

/** Default slot for the sheet's own "New event" action. */
export const DEFAULT_EVENT_START_MINUTE = 9 * 60;

export interface DayDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: DateOnly;
  items: CalendarItem[];
  calendars: CalendarLookup;
  prefs: CalendarPrefs;
  onOpenItem: ItemOpenHandler;
  onCreateAt: (date: DateOnly, startMinute: number) => void;
}

export function DayDetailSheet({
  open,
  onOpenChange,
  date,
  items,
  calendars,
  prefs,
  onOpenItem,
  onCreateAt,
}: DayDetailSheetProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={fromDateOnly(date, prefs.zone).toFormat('cccc d LLLL')}
      description={relativeDayLabel(date, prefs.zone)}
      snapPoints={[0.5, 0.9]}
    >
      {items.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="Nothing scheduled"
          description="This day is clear. Add an event, or drag one here from another day."
          action={
            <Button variant="tinted" icon={Plus} onClick={() => onCreateAt(date, DEFAULT_EVENT_START_MINUTE)}>
              New event
            </Button>
          }
        />
      ) : (
        <div className="space-y-4 pb-2">
          <ul className="grouped">
            {items.map((item) => {
              const calendar = item.calendarId ? calendars.get(item.calendarId) : undefined;
              const color = resolveCalendarColor(calendar?.color ?? null, calendar?.colorOverride ?? null);
              const time = item.isAllDay
                ? 'All day'
                : `${formatTime(item.startMs, prefs)} – ${formatTime(item.endMs, prefs)}`;

              return (
                <li key={item.key} className="hairline-b last:border-b-0">
                  <button
                    type="button"
                    onClick={() => onOpenItem(item)}
                    className="flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left pressable-row"
                  >
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: accentHex(color) }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate text-body', item.completed && 'text-secondary line-through')}>
                        {item.kind === 'task' ? (
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
                    {item.completed ? <Check className="size-4 shrink-0 text-success" aria-hidden /> : null}
                  </button>
                </li>
              );
            })}
          </ul>

          <Button
            variant="tinted"
            fullWidth
            icon={Plus}
            onClick={() => onCreateAt(date, DEFAULT_EVENT_START_MINUTE)}
          >
            New event
          </Button>
        </div>
      )}
    </Sheet>
  );
}
