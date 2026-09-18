'use client';

/**
 * The event editor.
 *
 * One dialog for create and edit, because the two differ only in where the draft
 * comes from: a tapped slot or an existing event. The draft is deliberately
 * *floating days + wall-clock times* (`DateOnly` / `HH:mm`) until the moment it
 * is sent, so a DST boundary between the two can never quietly shift a 09:00
 * meeting to 08:00 — `lib/dates` resolves the pair once, on save.
 *
 * Validation happens here as well as on the server: telling the user inline that
 * the end is before the start is friendlier than a 422 in a toast.
 *
 * ## The overlay
 *
 * The sheet is a shadcn `Dialog` — full-screen on a phone, a centred card from
 * `sm` up — so focus management, the scroll lock and Escape are Radix's rather
 * than a hand-rolled trap, and the hand-rolled trap the Material version would
 * have needed is absent instead of layered underneath. The phone-shaped class
 * list is `SHEET_DIALOG_CLASS` from the settings area rather than a second copy
 * of the same six overrides: it is the shared statement of "a full-height,
 * square-cornered sheet under `sm`, a centred card above it", and stating it
 * twice is exactly the drift the spacing scale exists to prevent.
 *
 * ## The date and time fields
 *
 * The start and end dates are the shadcn `Calendar` (react-day-picker) inside a
 * `Popover`; the floating day (`YYYY-MM-DD`, no timezone) is converted to and
 * from the `Date` the picker speaks with Luxon **at the edge only**, so a day
 * never gets compared against an instant. The times are native
 * `<input type="time">` controls that store `HH:mm`: a native picker renders in
 * the user's own 12h/24h convention and emits `HH:mm` either way, so the
 * `timeFormat` setting has nothing to do here.
 *
 * Everything else about dates is still `lib/dates`: this file never converts an
 * instant, never expands a recurrence and never touches EXDATE — the server
 * sends the expanded occurrences on `GET /api/calendar/items`, and
 * `combineDateAndTime` is the one place a floating day and a wall-clock time
 * become epoch milliseconds, on save.
 *
 * ## Feedback
 *
 * Transient results go through the app's `useToast()` shim rather than an inline
 * snackbar: the banner has to outlive the dialog that raised it (a successful
 * save closes the dialog immediately), and the shim is the app's one toast
 * surface. Failures that need the user's attention *inside* the form — a load
 * error, a bad range — are inline, next to the field that caused them.
 */
import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { DateTime } from 'luxon';
import { CalendarIcon } from '@svg-animated-icons/react/calendar';
import { CheckIcon } from '@svg-animated-icons/react/check';
import { LoopIcon } from '@svg-animated-icons/react/loop';
import { TrashIcon } from '@svg-animated-icons/react/trash';
import { useToast } from '@/components/app/Toast';
import { HoldConfirmButton } from '@/components/godui/hold-confirm-button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { SHEET_DIALOG_CLASS } from '@/components/settings/styles';
import { api, errorMessage } from '@/lib/api-client';
import { accentHex, resolveCalendarColor } from '@/lib/colors';
import {
  addDaysToDateOnly,
  combineDateAndTime,
  timeIn,
  toDateOnly,
  todayIn,
} from '@/lib/dates';
import { REPEAT_PRESETS, buildRRule, describeRRule, matchPreset, weekdayOfDate } from '@/lib/rrule';
import { invalidate, useResource } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { Calendar as CalendarRecord, CalendarEvent, DateOnly, TimeOnly } from '@/lib/types';
import { minuteToTime } from './geometry';
import type { CalendarFilter, CalendarPrefs } from './types';

/** Prefill for a new event, expressed the way the grid thinks. */
export interface EventDefaults {
  date: DateOnly;
  startMinute: number;
  endMinute: number;
  calendarId: string | null;
}

export interface EventEditorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Event to edit, or `null` to create one. */
  eventId: string | null;
  defaults: EventDefaults;
  calendars: CalendarRecord[];
  prefs: CalendarPrefs;
  /** Called after a write lands, so the screen can refetch the range. */
  onChanged: () => void;
  /** Seeds the calendar picker when the view is filtered to one calendar. */
  filter?: CalendarFilter | null;
}

/** The wire shape of `POST /api/events`, matching `createEventSchema`. */
interface EventWriteBody {
  calendarId: string;
  summary: string;
  description: string | null;
  location: string | null;
  isAllDay: boolean;
  timezone: string;
  rrule: string | null;
  reminders: number[] | null;
  startMs?: number;
  endMs?: number;
  startDate?: DateOnly;
  endDate?: DateOnly;
  startTime?: TimeOnly;
  endTime?: TimeOnly;
}

const REMINDER_OPTIONS: { minutes: number; label: string }[] = [
  { minutes: 0, label: 'At time' },
  { minutes: 5, label: '5 min' },
  { minutes: 10, label: '10 min' },
  { minutes: 15, label: '15 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 1440, label: '1 day' },
];

/** The bordered surface a group of fields sits in. */
const FIELD_GROUP_CLASS = 'flex flex-col gap-stack rounded-xl border border-border p-card';

/**
 * A floating `DateOnly` as a `DateTime` in the user's zone.
 *
 * The picker reads the calendar fields back out of it, so this is a display
 * carrier, never a conversion to an instant: nothing here is ever compared with
 * `Date.now()` or written to the API.
 */
function toDateTime(date: DateOnly, zone: string): DateTime {
  const value = DateTime.fromISO(date, { zone });
  return value.isValid ? value : DateTime.fromISO(date, { zone: 'utc' });
}

export function EventEditorSheet({
  open,
  onOpenChange,
  eventId,
  defaults,
  calendars,
  prefs,
  onChanged,
  filter = null,
}: EventEditorSheetProps) {
  const { data: existing, error, isInitialLoading } = useResource<CalendarEvent>(
    eventId ? `/api/events/${eventId}` : null,
    undefined,
    { enabled: open && Boolean(eventId) },
  );

  const isEdit = Boolean(eventId);
  const ready = !isEdit || Boolean(existing);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(SHEET_DIALOG_CLASS, 'max-h-dvh overflow-y-auto')}
        aria-labelledby="event-editor-title"
      >
        <DialogHeader>
          <DialogTitle id="event-editor-title">{isEdit ? 'Edit event' : 'New event'}</DialogTitle>
        </DialogHeader>

        {!ready ? (
          error ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : (
            <div className="flex flex-col gap-3" aria-busy={isInitialLoading}>
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-32 w-full rounded-lg" />
              <Skeleton className="h-24 w-full rounded-lg" />
            </div>
          )
        ) : (
          <EventForm
            // Re-initialised per target, so reopening the dialog on another day
            // never inherits the previous draft.
            key={`${eventId ?? 'new'}-${defaults.date}-${defaults.startMinute}`}
            event={existing ?? null}
            defaults={defaults}
            calendars={calendars}
            prefs={prefs}
            filter={filter}
            onClose={() => onOpenChange(false)}
            onChanged={onChanged}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface Draft {
  title: string;
  calendarId: string;
  allDay: boolean;
  startDate: DateOnly;
  /** The *inclusive* last day, which is what a human picks in a date picker. */
  endDate: DateOnly;
  startTime: TimeOnly;
  endTime: TimeOnly;
  location: string;
  notes: string;
  repeatId: string;
  reminders: number[];
}

function buildDraft(
  event: CalendarEvent | null,
  defaults: EventDefaults,
  calendars: CalendarRecord[],
  filter: CalendarFilter | null,
  zone: string,
  today: DateOnly,
): Draft {
  if (!event) {
    return {
      title: '',
      calendarId: filter?.id ?? defaults.calendarId ?? calendars.find((c) => c.isDefault)?.id ?? calendars[0]?.id ?? '',
      allDay: false,
      startDate: defaults.date,
      endDate: defaults.date,
      startTime: minuteToTime(defaults.startMinute),
      endTime: minuteToTime(defaults.endMinute),
      location: '',
      notes: '',
      repeatId: 'none',
      reminders: [],
    };
  }

  const startDate = event.startDate ?? (event.startMs ? toDateOnly(event.startMs, zone) : today);
  const endDate = event.isAllDay
    ? event.endDate
      ? addDaysToDateOnly(event.endDate, -1, zone)
      : startDate
    : (event.endDate ?? (event.endMs ? toDateOnly(event.endMs, zone) : startDate));

  return {
    title: event.summary ?? '',
    calendarId: event.calendarId,
    allDay: event.isAllDay,
    startDate,
    endDate,
    startTime: event.startMs ? timeIn(event.startMs, zone) : '09:00',
    endTime: event.endMs ? timeIn(event.endMs, zone) : '10:00',
    location: event.location ?? '',
    notes: event.description ?? '',
    repeatId: matchPreset(event.rrule, weekdayOfDate(startDate)),
    reminders: event.reminders ?? [],
  };
}

function EventForm({
  event,
  defaults,
  calendars,
  prefs,
  filter,
  onClose,
  onChanged,
}: {
  event: CalendarEvent | null;
  defaults: EventDefaults;
  calendars: CalendarRecord[];
  prefs: CalendarPrefs;
  filter: CalendarFilter | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const today = todayIn(prefs.zone);
  const [draft, setDraft] = useState(() => buildDraft(event, defaults, calendars, filter, prefs.zone, today));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const calendarRefs = useRef(new Map<string, HTMLButtonElement>());

  const patch = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }));

  /** Standard radiogroup behaviour: arrows move the selection and the focus. */
  function onCalendarKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const delta =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? -1
          : 0;
    if (delta === 0 || calendars.length === 0) return;

    event.preventDefault();
    const index = calendars.findIndex((calendar) => calendar.id === draft.calendarId);
    const next = calendars[(((index < 0 ? 0 : index) + delta) % calendars.length + calendars.length) % calendars.length];
    patch({ calendarId: next.id });
    calendarRefs.current.get(next.id)?.focus();
  }

  const repeatRule = useMemo(() => {
    const preset = REPEAT_PRESETS.find((candidate) => candidate.id === draft.repeatId);
    if (!preset) return null;
    const spec = preset.build({ dueDay: weekdayOfDate(draft.startDate), dueDate: draft.startDate });
    return spec ? buildRRule(spec) : null;
  }, [draft.repeatId, draft.startDate]);

  const startMs = draft.allDay ? null : combineDateAndTime(draft.startDate, draft.startTime, prefs.zone);
  const endMs = draft.allDay ? null : combineDateAndTime(draft.endDate, draft.endTime, prefs.zone);

  // Inline rather than a server round trip: a 422 in a message makes the user
  // hunt for which of the four date/time fields was wrong.
  const rangeError = draft.allDay
    ? draft.endDate < draft.startDate
      ? 'The end date cannot be before the start date.'
      : null
    : startMs !== null && endMs !== null && endMs <= startMs
      ? 'The end must be after the start.'
      : null;

  function buildBody(): EventWriteBody {
    const body: EventWriteBody = {
      calendarId: draft.calendarId,
      summary: draft.title.trim() || '(No title)',
      description: draft.notes.trim() || null,
      location: draft.location.trim() || null,
      isAllDay: draft.allDay,
      timezone: prefs.zone,
      rrule: repeatRule,
      reminders: draft.reminders.length > 0 ? [...draft.reminders].sort((a, b) => a - b) : null,
    };

    if (draft.allDay) {
      // RFC 5545: DTEND for a DATE-valued event is exclusive, so a one-day
      // event sends endDate = startDate + 1.
      body.startDate = draft.startDate;
      body.endDate = addDaysToDateOnly(draft.endDate, 1, prefs.zone);
    } else if (startMs !== null && endMs !== null) {
      body.startMs = startMs;
      body.endMs = endMs;
      body.startDate = draft.startDate;
      body.endDate = toDateOnly(endMs, prefs.zone);
      body.startTime = draft.startTime;
      body.endTime = draft.endTime;
    }

    return body;
  }

  async function save() {
    if (rangeError) return;
    setSaving(true);
    try {
      const body = buildBody();
      if (event) await api.patch<CalendarEvent>(`/api/events/${event.id}`, body);
      else await api.post<CalendarEvent>('/api/events', body);

      invalidate('/api/calendar/items');
      invalidate('/api/events');
      onChanged();
      toast({ title: event ? 'Event updated' : 'Event created', variant: 'success' });
      onClose();
    } catch (error) {
      toast({
        title: 'Could not save the event',
        description: errorMessage(error),
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!event) return;
    try {
      await api.delete(`/api/events/${event.id}`);
      invalidate('/api/calendar/items');
      invalidate('/api/events');
      onChanged();
      toast({ title: 'Event deleted', variant: 'success' });
      setConfirmDelete(false);
      onClose();
    } catch (error) {
      toast({
        title: 'Could not delete the event',
        description: errorMessage(error),
        variant: 'error',
      });
    }
  }

  const repeatDescription = describeRRule(repeatRule);
  /* react-day-picker wants the literal weekday union; the setting is 0 or 1. */
  const weekStartsOn = prefs.weekStartsOn as 0 | 1;

  return (
    <>
      <div className="flex flex-col gap-card">
        <Input
          aria-label="Title"
          placeholder="Title"
          value={draft.title}
          onChange={(input) => patch({ title: input.target.value })}
          className="text-base"
        />

        {/*
          The calendar the event belongs to. A radiogroup rather than a select,
          because the choice is a colour-dotted list of a handful of options and
          picking one is one tap — the arrow keys still move the selection.
        */}
        <div
          aria-label="Calendar"
          role="radiogroup"
          onKeyDown={onCalendarKeyDown}
          className="overflow-hidden rounded-xl border border-border"
        >
          {calendars.map((calendar) => {
            const selected = calendar.id === draft.calendarId;
            return (
              <button
                key={calendar.id}
                ref={(node) => {
                  if (node) calendarRefs.current.set(calendar.id, node);
                  else calendarRefs.current.delete(calendar.id);
                }}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => patch({ calendarId: calendar.id })}
                className="flex min-h-11 w-full cursor-pointer items-center gap-3 px-row py-2 text-left"
              >
                <span
                  aria-hidden
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: accentHex(resolveCalendarColor(calendar.color, calendar.colorOverride)) }}
                />
                <span className={cn('min-w-0 flex-1 truncate text-sm', selected && 'font-semibold')}>
                  {calendar.name}
                </span>
                {selected ? <CheckIcon aria-hidden className="size-4 shrink-0 text-primary" /> : null}
              </button>
            );
          })}
        </div>

        <section aria-label="When" className={FIELD_GROUP_CLASS}>
          <div className="flex items-center gap-3">
            <Label htmlFor="event-all-day" className="flex-1">
              All-day
            </Label>
            <Switch
              id="event-all-day"
              aria-label="All-day event"
              checked={draft.allDay}
              onCheckedChange={(checked) => patch({ allDay: checked })}
            />
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-3">
            <DateField
              id="event-start-date"
              label="Starts"
              value={draft.startDate}
              zone={prefs.zone}
              weekStartsOn={weekStartsOn}
              onChange={(date) => {
                // Keep the span: moving the start moves the end with it.
                const delta = dayDelta(draft.startDate, date);
                patch({ startDate: date, endDate: addDaysToDateOnly(draft.endDate, delta, prefs.zone) });
              }}
            />
            {!draft.allDay ? (
              <TimeField
                id="event-start-time"
                label="Start time"
                value={draft.startTime}
                onChange={(time) => patch({ startTime: time })}
              />
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <DateField
              id="event-end-date"
              label="Ends"
              value={draft.endDate}
              zone={prefs.zone}
              weekStartsOn={weekStartsOn}
              minDate={draft.startDate}
              onChange={(date) => patch({ endDate: date })}
            />
            {!draft.allDay ? (
              <TimeField
                id="event-end-time"
                label="End time"
                value={draft.endTime}
                onChange={(time) => patch({ endTime: time })}
              />
            ) : null}
          </div>

          {rangeError ? (
            <p role="alert" className="text-xs text-destructive">
              {rangeError}
            </p>
          ) : null}
        </section>

        <section aria-label="Details" className={FIELD_GROUP_CLASS}>
          <Input
            aria-label="Location"
            placeholder="Add a place"
            value={draft.location}
            onChange={(input) => patch({ location: input.target.value })}
          />
          <Textarea
            aria-label="Notes"
            placeholder="Add notes"
            rows={2}
            maxLength={50_000}
            value={draft.notes}
            onChange={(input) => patch({ notes: input.target.value })}
            className="resize-none"
          />
        </section>

        <section aria-label="Repeat" className="flex flex-col gap-2 rounded-xl border border-border p-card">
          <Label htmlFor="event-repeat">
            <LoopIcon aria-hidden className="size-4 text-base" />
            Repeat
          </Label>
          <Select value={draft.repeatId} onValueChange={(value) => patch({ repeatId: value })}>
            <SelectTrigger id="event-repeat" className="w-full">
              <SelectValue placeholder="Never" />
            </SelectTrigger>
            <SelectContent position="popper">
              {REPEAT_PRESETS.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {repeatDescription ? <p className="text-xs text-muted-foreground">{repeatDescription}</p> : null}
        </section>

        <section aria-label="Reminders" className="flex flex-col gap-2 rounded-xl border border-border p-card">
          <h3 className="text-sm font-medium text-foreground">Reminders</h3>
          {/*
            Toggle buttons rather than chips with a delete cross: `aria-pressed`
            is what these are, and a pressing state a screen reader can read is
            worth more than the chip shape.
          */}
          <div className="flex flex-wrap gap-2">
            {REMINDER_OPTIONS.map((option) => {
              const selected = draft.reminders.includes(option.minutes);
              return (
                <Button
                  key={option.minutes}
                  type="button"
                  size="sm"
                  variant={selected ? 'default' : 'outline'}
                  aria-pressed={selected}
                  className="rounded-full"
                  onClick={() =>
                    patch({
                      reminders: selected
                        ? draft.reminders.filter((minutes) => minutes !== option.minutes)
                        : [...draft.reminders, option.minutes],
                    })
                  }
                >
                  {option.label}
                </Button>
              );
            })}
          </div>
        </section>

        {event ? (
          <div className="overflow-hidden rounded-xl border border-border">
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 px-row py-2 text-sm text-destructive"
            >
              <TrashIcon aria-hidden className="size-4 text-base" disableHover />
              Delete event
            </button>
          </div>
        ) : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          className="flex-1"
          aria-busy={saving || undefined}
          disabled={saving || Boolean(rangeError) || !draft.calendarId}
          onClick={() => void save()}
        >
          {event ? 'Save' : 'Add'}
        </Button>
      </DialogFooter>

      {/*
        Deleting is the one irreversible action here — a recurring event is
        deleted in full — so the confirm dialog asks for a hold rather than a tap.
        That is the app's destructive pattern (`HoldConfirmButton`) and it makes a
        mis-touch on a phone, where the dialog sits under the thumb, harmless.
      */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent showCloseButton={false} className="gap-0 p-0">
          <div className="flex flex-col gap-stack p-card">
            <DialogTitle>Delete this event?</DialogTitle>
            <DialogDescription>This cannot be undone. Recurring events are deleted in full.</DialogDescription>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <HoldConfirmButton variant="destructive" onConfirm={() => void remove()}>
                Delete
              </HoldConfirmButton>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * A floating day, picked from the shadcn `Calendar` in a `Popover`.
 *
 * The value never leaves floating form: the `Date` the picker speaks is built
 * from the day's calendar fields in the user's zone and read straight back, so
 * no instant is ever stored or compared.
 */
function DateField({
  id,
  label,
  value,
  zone,
  weekStartsOn,
  minDate,
  onChange,
}: {
  id: string;
  label: string;
  value: DateOnly;
  zone: string;
  weekStartsOn: 0 | 1;
  /** Earliest pickable day, inclusive; omitted on the start field. */
  minDate?: DateOnly;
  onChange: (date: DateOnly) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = toDateTime(value, zone).toJSDate();

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button id={id} type="button" variant="outline" className="w-full justify-start font-normal">
            <CalendarIcon className="size-4 text-base" disableHover />
            <span className="truncate">{toDateTime(value, zone).toFormat('ccc d LLL yyyy')}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            autoFocus
            weekStartsOn={weekStartsOn}
            /* The picker opens on the field's own month, not today's. */
            defaultMonth={selected}
            selected={selected}
            disabled={minDate ? { before: toDateTime(minDate, zone).toJSDate() } : undefined}
            onSelect={(day) => {
              if (!day) return;
              const next = DateTime.fromJSDate(day, { zone }).toISODate();
              if (next) onChange(next);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** A wall-clock `HH:mm`, from a native time input. */
function TimeField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: TimeOnly;
  onChange: (time: TimeOnly) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="time"
        /* 900s = the quarter-hour granularity the old time picker stepped by. */
        step={900}
        value={value}
        onChange={(input) => {
          // A cleared field must not write an empty time; the draft keeps the
          // last good value instead.
          if (input.target.value) onChange(input.target.value);
        }}
      />
    </div>
  );
}

/** Whole days between two floating dates, without a timezone in sight. */
function dayDelta(from: DateOnly, to: DateOnly): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}
