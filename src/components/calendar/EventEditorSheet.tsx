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
 * have needed is absent instead of layered underneath. Those two shapes are the
 * two sets of utilities on `DialogContent` (the same pair the habits editor
 * uses), and the content column is laid out as a flex shell — title row, a body
 * that scrolls, a pinned footer — because that is what `DialogActions` did:
 * the one button the form exists for must not live under the fold on a phone.
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
import { useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { CalendarIcon } from '@svg-animated-icons/react/calendar';
import { Cross1Icon } from '@svg-animated-icons/react/cross-1';
import { LoopIcon } from '@svg-animated-icons/react/loop';
import { TrashIcon } from '@svg-animated-icons/react/trash';
import { useToast } from '@/components/app/Toast';
import { HoldConfirmButton } from '@/components/godui/hold-confirm-button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Dialog,
  DialogClose,
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
import { api, errorMessage } from '@/lib/api-client';
import {
  addDaysToDateOnly,
  combineDateAndTime,
  timeIn,
  toDateOnly,
  todayIn,
} from '@/lib/dates';
import { REPEAT_PRESETS, buildRRule, describeRRule, matchPreset, weekdayOfDate } from '@/lib/rrule';
import { invalidate, useResource } from '@/lib/store';
import type { Calendar as CalendarRecord, CalendarEvent, DateOnly, TimeOnly } from '@/lib/types';
import { CalendarCombobox } from './CalendarCombobox';
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
  /**
   * Seeds the calendar picker when the view is filtered to one calendar.
   *
   * `CalendarFilter` carries the calendar's base colour for the screens that
   * paint a chip from it (the sidebar, the event editor's filter); anything that
   * paints a calendar's own colour resolves it with `calendarColorHex`, which is
   * what honours a custom colour.
   */
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

/**
 * The bordered surface a group of fields sits in.
 *
 * `shrink-0` on every one of them is load-bearing: the body below is a flex
 * column inside a scroll container, and a flex item whose content is taller than
 * the space left shrinks to fit instead of scrolling — `overflow-hidden` on a
 * group even drops its automatic minimum size to zero, so the first groups
 * collapsed to their own border and their rows were clipped away.
 */
const FIELD_GROUP_CLASS = 'flex shrink-0 flex-col gap-stack rounded-xl border border-border p-card';

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
        /*
         * The shell: full-screen with square corners on a phone, a centred card
         * from `sm` up — the two shapes the Material dialog had. It is `p-0`
         * (the primitive's own `p-6`/`gap-4` would otherwise beat a layout
         * token) and `flex` rather than the primitive's `grid`, so the body can
         * take the free space and scroll while the title row and the actions
         * stay put: the actions are pinned, exactly as `DialogActions` was.
         * `max-h-[90dvh]` leaves a strip of scrim visible on a tall desktop, and
         * is a viewport measurement rather than a spacing value.
         */
        className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0 sm:max-w-lg"
        aria-labelledby="event-editor-title"
        /*
         * No autofocus on the title. Radix would focus the first focusable
         * control — the title input — so opening the editor to *read* or change
         * one field immediately put the caret in the title and, on iOS, raised
         * the keyboard. The tasks quick-add sheet owns the deliberately
         * synchronous focus it needs for the keyboard (see `QuickAddBar`); this
         * sheet does not, so it starts without stealing focus. Keyboard users
         * still reach the form on the first Tab. Same rule as
         * `TaskEditorSheet`.
         */
        onOpenAutoFocus={(event) => event.preventDefault()}
        /*
         * The close control is the dialog's own (`DialogClose`), not the
         * primitive's default, because that one is a bare 16px glyph in a 16px
         * box. See the button below for the measured target.
         */
        showCloseButton={false}
      >
        {/*
         * The close target. It is the same `DialogClose` — so it still closes,
         * still returns focus and still sits where the primitive's did — but in
         * a 44px box instead of a 16px one. The box is centred on the old
         * glyph's own centre (the primitive's `top-4 right-4` put that centre
         * 24px in from each edge; a 44px box therefore starts 2px in), so the
         * glyph does not move and only the target around it grows. The glyph
         * itself is unchanged at `size-4`.
         */}
        <DialogClose
          className="absolute top-0.5 right-0.5 flex size-11 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
        >
          <Cross1Icon aria-hidden className="size-4 text-base" disableHover />
          <span className="sr-only">Close</span>
        </DialogClose>
        <DialogHeader className="shrink-0 gap-0 border-b border-border px-card py-stack">
          <DialogTitle id="event-editor-title" className="text-lg font-semibold">
            {isEdit ? 'Edit event' : 'New event'}
          </DialogTitle>
        </DialogHeader>

        {!ready ? (
          <div
            className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-card py-card"
            aria-busy={isInitialLoading}
          >
            {error ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : (
              <>
                <Skeleton className="h-12 w-full shrink-0 rounded-lg" />
                <Skeleton className="h-32 w-full shrink-0 rounded-lg" />
                <Skeleton className="h-24 w-full shrink-0 rounded-lg" />
              </>
            )}
          </div>
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

  const patch = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }));

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
      {/*
        The scrolling body. Every direct child carries `shrink-0` (see
        `FIELD_GROUP_CLASS`): a flex column that scrolls must not squash the rows
        that do not fit, which is what the default `flex-shrink: 1` would do.
      */}
      <div className="flex min-h-0 flex-1 flex-col gap-card overflow-y-auto px-card py-card">
        <Input
          aria-label="Title"
          placeholder="Title"
          value={draft.title}
          onChange={(input) => patch({ title: input.target.value })}
          className="shrink-0 text-base"
        />

        {/*
          The calendar the event belongs to: a combobox — see
          `./CalendarCombobox`. It commits the same value the radiogroup it
          replaced did, a calendar id, but the list is filterable, so a calendar
          that is not one of the first few visible rows is still one typed word
          away.
        */}
        <CalendarCombobox
          value={draft.calendarId}
          calendars={calendars}
          onChange={(calendarId) => patch({ calendarId })}
          className="shrink-0"
        />

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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

        <section aria-label="Repeat" className={FIELD_GROUP_CLASS}>
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

        <section aria-label="Reminders" className={FIELD_GROUP_CLASS}>
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
          <div className="shrink-0 overflow-hidden rounded-xl border border-border">
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

      <DialogFooter className="shrink-0 border-t border-border px-card pt-stack pb-[max(0.25rem,env(safe-area-inset-bottom,0px))]">
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
    <div className="flex min-w-0 flex-col gap-1">
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

/**
 * A wall-clock `HH:mm`, from a native time input.
 *
 * The input is **bounded**, not full-width. A native time field is one short
 * value plus a picker glyph; stretched across the form (`w-full`, which is what
 * it was) it read as an over-long empty box with its glyph jammed against the
 * form's edge — and on a narrow phone the native control's own intrinsic width
 * could push past that edge. `w-40` is the same compact width the habits
 * editor's reminder field uses, it clears the control's ~138px content need with
 * room to spare, and the wrapper's `min-w-0` means the column can always shrink
 * it rather than letting a grid track overflow.
 */
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
    <div className="flex min-w-0 flex-col gap-1">
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
        className="w-40"
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
