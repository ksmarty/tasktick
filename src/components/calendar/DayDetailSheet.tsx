'use client';

/**
 * The day detail sheet: everything happening on one day.
 *
 * This is what a tap on a month cell opens, and it is the only place a crowded
 * day is shown in full — hence the explicit "New event" action, so the sheet is
 * also the quickest way to add something to that day.
 *
 * ## The GodUI Drawer
 *
 * The overlay is the GodUI `Drawer`, the app's bottom-sheet primitive (see
 * `components/godui/drawer.tsx` and the component mapping in
 * `GODUI-CONVENTIONS.md`). It replaces MUI's centred `Dialog` and, like it, owns
 * the whole overlay contract rather than having a second implementation layered
 * underneath: `role="dialog"`, `aria-modal`, Escape, the scrim, the body scroll
 * lock and flick-to-dismiss are the drawer's own, so the hand-rolled trap the
 * Material version would have needed is absent instead of duplicated. The
 * drawer's panel owns the padding (`p-0` neutralises it, as the vendored panel's
 * `p-5` would otherwise win over a layout token) so every inset below comes from
 * `p-card` and the safe-area expression.
 *
 * The drawer renders the day as its own heading; the relative-day line follows
 * it as the first line of the body, so the two pieces of context arrive before
 * the list either way. Every row keeps its own accessible name (time, title,
 * kind) because a colour dot and a right-aligned time do not survive as a linear
 * reading order.
 */
import { CheckIcon } from '@svg-animated-icons/react/check';
import { CheckboxIcon } from '@svg-animated-icons/react/checkbox';
import { CalendarIcon } from '@svg-animated-icons/react/calendar';
import { PlusIcon } from '@svg-animated-icons/react/plus';
import { useAppearance } from '@/app/providers';
import { Drawer } from '@/components/godui/drawer';
import { Button } from '@/components/ui/button';
import { accentHex, resolveCalendarColor } from '@/lib/colors';
import { formatTime, fromDateOnly, relativeDayLabel } from '@/lib/dates';
import { cn } from '@/lib/utils';
import type { CalendarItem, DateOnly } from '@/lib/types';
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
  /** The resolved appearance, so an accent token maps to the right hex. */
  const dark = useAppearance().resolvedTheme === 'dark';
  const title = fromDateOnly(date, prefs.zone).toFormat('cccc d LLLL');
  const description = relativeDayLabel(date, prefs.zone);

  return (
    <Drawer open={open} onOpenChange={onOpenChange} side="bottom" title={title} className="p-0 px-card">
      <div className="flex flex-col gap-stack pb-[max(1rem,env(safe-area-inset-bottom,0px))]">
        <p className="text-sm text-muted-foreground">{description}</p>

        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-gutter py-8 text-center">
            <CalendarIcon aria-hidden className="size-8 text-3xl text-muted-foreground" disableHover />
            <p className="text-sm font-semibold text-foreground">Nothing scheduled</p>
            <p className="text-sm text-muted-foreground">
              This day is clear. Add an event, or drag one here from another day.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col">
            {items.map((item) => {
              const calendar = item.calendarId ? calendars.get(item.calendarId) : undefined;
              const color = resolveCalendarColor(calendar?.color ?? null, calendar?.colorOverride ?? null);
              const hex = accentHex(color, dark);
              const isTask = item.kind === 'task';
              const time = item.isAllDay
                ? 'All day'
                : `${formatTime(item.startMs, prefs)} – ${formatTime(item.endMs, prefs)}`;

              return (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={() => onOpenItem(item)}
                    className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-md px-row py-2 text-left hover:bg-accent"
                  >
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: hex }}
                    />

                    <span className="flex min-w-0 flex-1 flex-col">
                      <span
                        className={cn(
                          'block truncate text-sm',
                          item.completed ? 'text-muted-foreground line-through' : 'text-foreground',
                        )}
                      >
                        {isTask ? (
                          <span
                            aria-hidden
                            className={cn(
                              'mr-1 inline-flex align-[-0.15em]',
                              item.completed ? 'text-primary' : 'text-muted-foreground',
                            )}
                          >
                            <CheckboxIcon className="size-3.5 text-sm" disableHover />
                          </span>
                        ) : null}
                        {item.title}
                      </span>
                      {item.location ? (
                        <span className="block truncate text-xs text-muted-foreground">{item.location}</span>
                      ) : null}
                    </span>

                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{time}</span>

                    {item.completed ? (
                      <CheckIcon aria-hidden className="size-4 shrink-0 text-primary" disableHover />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <Button
          type="button"
          className="w-full"
          onClick={() => onCreateAt(date, DEFAULT_EVENT_START_MINUTE)}
        >
          <PlusIcon className="size-4 text-base" disableHover />
          New event
        </Button>
      </div>
    </Drawer>
  );
}
