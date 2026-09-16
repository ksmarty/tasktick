'use client';

/**
 * The calendars panel: one row per calendar with a visibility switch.
 *
 * Visibility is a per-user preference stored on the calendar itself, so the
 * switch PATCHes `/api/calendars/[id]` and the *query* is what changes — the
 * client never filters another calendar's events out of a payload it already
 * received, which is what keeps "what is on screen" equal to "what was asked
 * for". The colour dot is resolved with the calendar's `colorOverride`.
 */
import { Check, Plus } from 'lucide-react';
import { accentHex, resolveCalendarColor } from '@/lib/colors';
import { cn } from '@/lib/cn';
import type { Calendar } from '@/lib/types';
import { Button, Switch } from '@/components/ui';
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
    <div className="space-y-4 py-2">
      <div className="mx-4">
        <h2 className="pb-2 text-footnote font-medium uppercase tracking-wide text-secondary">Calendars</h2>
        <ul className="grouped">
          {calendars.map((calendar) => {
            const color = resolveCalendarColor(calendar.color, calendar.colorOverride);
            const visible = visibility[calendar.id] ?? calendar.isVisible;
            const focused = filter?.id === calendar.id;

            return (
              <li key={calendar.id} className="hairline-b flex min-h-11 items-center gap-3 px-4 last:border-b-0">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: accentHex(color) }}
                />
                <button
                  type="button"
                  onClick={() => (focused ? onClearFilter() : onFocusCalendar(calendar))}
                  aria-pressed={focused}
                  className={cn(
                    'min-w-0 flex-1 truncate py-2 text-left text-body pressable-row',
                    focused && 'font-semibold text-tint',
                  )}
                >
                  {calendar.name}
                </button>
                {focused ? <Check className="size-4 shrink-0 text-tint" aria-hidden /> : null}
                <Switch
                  size="sm"
                  checked={visible}
                  onCheckedChange={(next) => onToggleVisibility(calendar, next)}
                  aria-label={`Show ${calendar.name}`}
                  className="ml-auto"
                />
              </li>
            );
          })}
        </ul>
        {calendars.length === 0 ? (
          <p className="px-1 py-2 text-footnote text-tertiary">No calendars yet.</p>
        ) : null}
      </div>

      <div className="mx-4">
        <Button variant="tinted" fullWidth icon={Plus} onClick={onCreateEvent}>
          New event
        </Button>
      </div>
    </div>
  );
}
