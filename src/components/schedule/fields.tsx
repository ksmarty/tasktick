'use client';

/**
 * The two fields every schedule in the app is made of: a day and a clock time.
 *
 * They live in one module because two editors use them — the event editor and
 * the task editor — and the task editor's copies had drifted into a different
 * shape: an unlabelled row of controls with the label drawn over the field, the
 * two times stacked under the date, and a hand-rolled clear cross per field. The
 * event editor's version is the one that reads well: a label above the field, the
 * day in words ("Fri Oct 30 2026") instead of a terse relative word, the whole
 * field a button that opens a real calendar, and one clear affordance per field.
 * Sharing the components is what makes "the same fields as the calendar" true
 * rather than a resemblance that decays the next time either side is touched.
 *
 * ## Floating days only
 *
 * A `DateOnly` never leaves this module as anything else. The `Date` the picker
 * speaks is built from the day's calendar fields in the user's zone and read
 * straight back, so no instant is ever stored, compared or sent — the caller
 * resolves the day and the time into an instant once, on save.
 *
 * ## The popover has to clear the sheet
 *
 * `PopoverContent` and the editors' `DialogContent` are both `z-50` and both
 * portalled to the body, so leaving the tie to mount order put the sheet's
 * sticky header over the picker's top row of days. One step above the sheet, and
 * `collisionPadding` so a picker that has to flip upward stops short of the
 * viewport edge instead of hanging off it.
 */
import { useState } from 'react';
import { DateTime } from 'luxon';
import { CalendarIcon } from '@svg-animated-icons/react/calendar';
import { Cross1Icon } from '@svg-animated-icons/react/cross-1';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TimeField as TimePicker } from '@/components/time/TimeField';
import type { DateOnly } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * A floating `DateOnly` as a `DateTime` in the user's zone.
 *
 * The picker reads the calendar fields back out of it, so this is a display
 * carrier, never a conversion to an instant: nothing here is ever compared with
 * `Date.now()` or written to the API. An unparseable value falls back to UTC
 * rather than to an invalid `DateTime`, which would render as "Invalid DateTime"
 * in the trigger.
 */
function toDateTime(date: DateOnly, zone: string): DateTime {
  const value = DateTime.fromISO(date, { zone });
  return value.isValid ? value : DateTime.fromISO(date, { zone: 'utc' });
}

/** One of the shortcuts above the calendar, e.g. "Tomorrow". */
export interface QuickDayPick {
  label: string;
  day: DateOnly;
}

/**
 * A floating day, picked from the shadcn `Calendar` in a `Popover`.
 *
 * `null` is a real value here: a task may have no due date at all, and the field
 * says so ("No date") instead of pretending to hold one. The picker still opens
 * on the current month when it is empty.
 *
 * `quickPicks` and `onClear` are the two things the task editor needs and the
 * event editor does not (an event always has a start, and "Tomorrow" matters
 * most for work you are scheduling rather than for a meeting you are recording).
 * They are props rather than a second component so that everything else — the
 * label, the button, the popover, the calendar, the date format — stays one
 * implementation.
 */
export function DateField({
  id,
  label,
  value,
  zone,
  weekStartsOn,
  minDate,
  quickPicks,
  onClear,
  disabled = false,
  onChange,
}: {
  id: string;
  label: string;
  value: DateOnly | null;
  zone: string;
  weekStartsOn: 0 | 1;
  /** Earliest pickable day, inclusive; omitted where any day will do. */
  minDate?: DateOnly;
  /** Shortcuts above the calendar. Omitted where the day is usually a new one. */
  quickPicks?: QuickDayPick[];
  /** Adds a Clear control inside the popover. Omitted where a day is required. */
  onClear?: () => void;
  disabled?: boolean;
  onChange: (date: DateOnly) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? toDateTime(value, zone) : null;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            className="w-full justify-start font-normal"
          >
            <CalendarIcon className="size-4 text-base" disableHover />
            {/*
              A day in words, not "Tomorrow". The relative word is right in a task
              list, where the row sits next to the day it belongs to; inside an
              editor it hides the one thing the field is for — which day is
              actually stored — the moment the day is close to today.
            */}
            <span className={cn('truncate', !selected && 'text-muted-foreground')}>
              {selected ? selected.toFormat('ccc LLL d yyyy') : 'No date'}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} collisionPadding={8} className="z-[60] w-auto p-0">
          {quickPicks?.length ? (
            <div className="flex gap-1 border-b border-border p-2">
              {quickPicks.map((pick) => (
                <Button
                  key={pick.label}
                  type="button"
                  variant={value === pick.day ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-pressed={value === pick.day}
                  className="flex-1"
                  onClick={() => {
                    onChange(pick.day);
                    setOpen(false);
                  }}
                >
                  {pick.label}
                </Button>
              ))}
            </div>
          ) : null}
          <Calendar
            mode="single"
            autoFocus
            weekStartsOn={weekStartsOn}
            /* The picker opens on the field's own month, not today's. */
            defaultMonth={selected?.toJSDate()}
            selected={selected?.toJSDate()}
            disabled={minDate ? { before: toDateTime(minDate, zone).toJSDate() } : undefined}
            onSelect={(day) => {
              if (!day) return;
              const next = DateTime.fromJSDate(day, { zone }).toISODate();
              if (next) onChange(next);
              setOpen(false);
            }}
          />
          {onClear ? (
            <div className="flex justify-end px-3 pb-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  onClear();
                  setOpen(false);
                }}
              >
                Clear
              </Button>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * A wall-clock `HH:mm`, from the shared five-minute picker.
 *
 * The picker's value contract is `HH:mm` and `''` for "no time yet", and its
 * placeholder is this field's label — a native time input ignores `placeholder`,
 * so an empty half would otherwise read as a bare "--:--", identical for both
 * halves of a range.
 *
 * `onClear` adds the small cross the task editor needs (a task can be due on a
 * day without a time); the event editor passes nothing, because an event's times
 * are not optional. `pr-6` reserves the cross's 20px plus a 4px gap, which is why
 * the picker never sits under it.
 */
export function TimeField({
  id,
  label,
  value,
  disabled = false,
  onClear,
  onChange,
}: {
  id?: string;
  label: string;
  /** `HH:mm`, or `''` when no time has been chosen yet. */
  value: string;
  disabled?: boolean;
  onClear?: () => void;
  onChange: (time: string) => void;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', onClear && 'relative')}>
      <Label htmlFor={id}>{label}</Label>
      <div className={cn('flex min-w-0 items-center', onClear && 'pr-6')}>
        <TimePicker
          id={id}
          ariaLabel={label}
          placeholder={label}
          value={value}
          disabled={disabled}
          onChange={onChange}
        />
      </div>
      {onClear && value !== '' ? (
        <button
          type="button"
          aria-label={`Clear ${label.toLowerCase()}`}
          onClick={onClear}
          className={cn(
            'absolute right-1 top-[1.875rem] inline-flex size-4 items-center justify-center rounded-full',
            'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            "after:absolute after:-inset-1 after:content-['']",
          )}
        >
          <Cross1Icon className="size-3" />
        </button>
      ) : null}
    </div>
  );
}
