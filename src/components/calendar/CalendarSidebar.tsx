'use client';

/**
 * The calendars panel: one row per calendar with a visibility switch.
 *
 * Visibility is a per-user preference stored on the calendar itself, so the
 * switch PATCHes `/api/calendars/[id]` and the *query* is what changes — the
 * client never filters another calendar's events out of a payload it already
 * received, which is what keeps "what is on screen" equal to "what was asked
 * for". The colour dot is resolved with the calendar's `colorOverride`.
 *
 * A row is `[dot] [name button] [switch]`: the name is its own button (so
 * "pin the view to this calendar" and "show this calendar" are two
 * independently focusable controls rather than one row with a hidden second
 * action), and the switch carries its own accessible name. The old
 * `ListItemButton`/`secondaryAction` pair did the same thing with two nested
 * focus targets, which is exactly the shape MUI's list item made awkward.
 *
 * It is not mounted by the calendar screen (the shell's sidebar and the filter
 * chip cover the same ground), but it is part of the feature's public surface
 * and is kept on the same primitives as the rest of it.
 *
 * The colour dot is painted from `accentHex`, which is a runtime accent lookup
 * and therefore the one thing here that has to be an inline `style`.
 */
import { CheckIcon } from '@svg-animated-icons/react/check';
import { PlusIcon } from '@svg-animated-icons/react/plus';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { accentHex, resolveCalendarColor } from '@/lib/colors';
import { cn } from '@/lib/utils';
import type { Calendar } from '@/lib/types';
import type { CalendarFilter } from './types';

export interface CalendarSidebarProps {
  calendars: Calendar[];
  /** Effective visibility per calendar id (local override wins until saved). */
  visibility: Record<string, boolean>;
  onToggleVisibility: (calendar: Calendar, visible: boolean) => void;
  /** Pins the view to one calendar (`?calendar=`). */
  onFocusCalendar: (calendar: Calendar) => void;
  filter: CalendarFilter | null;
  onClearFilter: () => void;
  onCreateEvent: () => void;
}

export function CalendarSidebar({
  calendars,
  visibility,
  onToggleVisibility,
  onFocusCalendar,
  filter,
  onClearFilter,
  onCreateEvent,
}: CalendarSidebarProps) {
  return (
    <div className="flex flex-col gap-stack py-card">
      <section className="flex flex-col">
        <h2 className="px-gutter pb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          Calendars
        </h2>

        <ul className="flex flex-col">
          {calendars.map((calendar) => {
            const color = resolveCalendarColor(calendar.color, calendar.colorOverride);
            const visible = visibility[calendar.id] ?? calendar.isVisible;
            const focused = filter?.id === calendar.id;

            return (
              <li key={calendar.id} className="flex min-h-11 items-center gap-3 px-gutter">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: accentHex(color) }}
                />

                <button
                  type="button"
                  onClick={() => (focused ? onClearFilter() : onFocusCalendar(calendar))}
                  aria-pressed={focused}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md py-2 text-left text-sm"
                >
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate',
                      focused ? 'font-semibold text-primary' : 'text-foreground',
                    )}
                  >
                    {calendar.name}
                  </span>
                  {focused ? <CheckIcon aria-hidden className="size-4 shrink-0 text-primary" /> : null}
                </button>

                <Switch
                  aria-label={`Show ${calendar.name}`}
                  checked={visible}
                  onCheckedChange={(checked) => onToggleVisibility(calendar, checked)}
                />
              </li>
            );
          })}
        </ul>

        {calendars.length === 0 ? (
          <p className="px-gutter py-1 text-sm text-muted-foreground">No calendars yet.</p>
        ) : null}
      </section>

      <div className="px-gutter">
        <Button type="button" className="w-full" onClick={onCreateEvent}>
          <PlusIcon className="size-4" />
          New event
        </Button>
      </div>
    </div>
  );
}
