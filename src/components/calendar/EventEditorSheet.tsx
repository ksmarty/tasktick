'use client';

/**
 * The event editor.
 *
 * One sheet for create and edit, because the two differ only in where the draft
 * comes from: a tapped slot or an existing event. The draft is deliberately
 * *floating days + wall-clock times* (`DateOnly` / `HH:mm`) until the moment it
 * is sent, so a DST boundary between the two can never quietly shift a 09:00
 * meeting to 08:00 — `lib/dates` resolves the pair once, on save.
 *
 * Validation happens here as well as on the server: telling the user inline that
 * the end is before the start is friendlier than a 422 in a toast.
 */
import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Check, Trash2 } from 'lucide-react';
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
import { cn } from '@/lib/cn';
import { invalidate, useResource } from '@/lib/store';
import type { Calendar, CalendarEvent, DateOnly, TimeOnly } from '@/lib/types';
import { Button, ConfirmDialog, DateField, Select, Sheet, Skeleton, Switch, TextArea, TextField, TimeField, useToast } from '@/components/ui';
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
  calendars: Calendar[];
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
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? 'Edit event' : 'New event'}
      snapPoints={[0.6, 0.95]}
    >
      {!ready ? (
        error ? (
          <p role="alert" className="py-4 text-footnote text-danger">
            {error}
          </p>
        ) : (
          <div className="space-y-3 py-2" aria-busy={isInitialLoading}>
            <Skeleton variant="rect" className="h-12" />
            <Skeleton variant="rect" className="h-32" />
            <Skeleton variant="rect" className="h-24" />
          </div>
        )
      ) : (
        <EventForm
          // Re-initialised per target, so reopening the sheet on another day
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
    </Sheet>
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
  calendars: Calendar[],
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
  calendars: Calendar[];
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

  // Inline rather than a server round trip: a 422 in a toast makes the user hunt
  // for which of the four date/time fields was wrong.
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
      toast({ title: 'Could not save the event', description: errorMessage(error), variant: 'error' });
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
      toast({ title: 'Could not delete the event', description: errorMessage(error), variant: 'error' });
    }
  }

  const repeatDescription = describeRRule(repeatRule);

  return (
    <div className="space-y-4 pb-2">
      <div className="grouped p-3">
        <TextArea
          value={draft.title}
          onChange={(input) => patch({ title: input.target.value })}
          placeholder="Title"
          rows={1}
          autoGrow
          aria-label="Title"
        />
      </div>

      <section
        aria-label="Calendar"
        role="radiogroup"
        onKeyDown={onCalendarKeyDown}
        className="grouped divide-y divide-separator"
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
              className="flex min-h-11 w-full items-center gap-3 px-4 text-left pressable-row"
            >
              <span
                aria-hidden
                className="size-3 shrink-0 rounded-full"
                style={{ backgroundColor: accentHex(resolveCalendarColor(calendar.color, calendar.colorOverride)) }}
              />
              <span className={cn('min-w-0 flex-1 truncate text-body', selected ? 'font-semibold text-tint' : 'text-label')}>
                {calendar.name}
              </span>
              {selected ? <Check className="size-5 shrink-0 text-tint" aria-hidden /> : null}
            </button>
          );
        })}
      </section>

      <div className="grouped divide-y divide-separator">
        <div className="flex min-h-11 items-center gap-3 px-4 py-2.5">
          <span className="text-body text-label">All-day</span>
          <Switch
            checked={draft.allDay}
            onCheckedChange={(checked) => patch({ allDay: checked })}
            aria-label="All-day event"
            className="ml-auto"
          />
        </div>

        <div className="space-y-3 px-4 py-3">
          <div className="grid grid-cols-2 gap-2">
            <DateField
              value={draft.startDate}
              onChange={(date) => {
                // Keep the span: moving the start moves the end with it.
                const delta = dayDelta(draft.startDate, date);
                patch({ startDate: date, endDate: addDaysToDateOnly(draft.endDate, delta, prefs.zone) });
              }}
              weekStartsOn={prefs.weekStartsOn}
              today={today}
              label="Starts"
            />
            {!draft.allDay ? (
              <TimeField
                value={draft.startTime}
                onChange={(time) => patch({ startTime: time })}
                minuteStep={15}
                format={prefs.timeFormat}
                label="Start time"
              />
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <DateField
              value={draft.endDate}
              onChange={(date) => patch({ endDate: date })}
              min={draft.startDate}
              weekStartsOn={prefs.weekStartsOn}
              today={today}
              label="Ends"
            />
            {!draft.allDay ? (
              <TimeField
                value={draft.endTime}
                onChange={(time) => patch({ endTime: time })}
                minuteStep={15}
                format={prefs.timeFormat}
                label="End time"
              />
            ) : null}
          </div>

          {rangeError ? (
            <p role="alert" className="px-1 text-footnote text-danger">
              {rangeError}
            </p>
          ) : null}
        </div>
      </div>

      <div className="grouped space-y-3 p-3">
        <TextField
          label="Location"
          value={draft.location}
          onChange={(input) => patch({ location: input.target.value })}
          placeholder="Add a place"
        />
        <TextArea
          label="Notes"
          value={draft.notes}
          onChange={(input) => patch({ notes: input.target.value })}
          placeholder="Add notes"
          rows={2}
          maxLength={50_000}
        />
      </div>

      <div className="grouped space-y-2 p-3">
        <Select
          label="Repeat"
          value={draft.repeatId}
          onChange={(value) => patch({ repeatId: value })}
          options={REPEAT_PRESETS.map((preset) => ({ value: preset.id, label: preset.label }))}
        />
        {repeatDescription ? <p className="px-1 text-footnote text-secondary">{repeatDescription}</p> : null}
      </div>

      <div className="grouped space-y-2 p-3">
        <h3 className="px-1 text-footnote text-secondary">Reminders</h3>
        <div className="flex flex-wrap gap-2 px-1">
          {REMINDER_OPTIONS.map((option) => {
            const selected = draft.reminders.includes(option.minutes);
            return (
              <button
                key={option.minutes}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  patch({
                    reminders: selected
                      ? draft.reminders.filter((minutes) => minutes !== option.minutes)
                      : [...draft.reminders, option.minutes],
                  })
                }
                className={cn(
                  'flex h-9 items-center rounded-full px-3 text-subhead pressable',
                  selected ? 'bg-tint text-tint-contrast' : 'bg-fill-tertiary text-label',
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {event ? (
        <div className="grouped">
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="flex min-h-11 w-full items-center justify-center gap-2 px-4 text-body text-danger pressable-row"
          >
            <Trash2 className="size-5" aria-hidden />
            Delete event
          </button>
        </div>
      ) : null}

      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-separator bg-sheet px-4 py-3">
        <Button variant="gray" fullWidth onClick={onClose}>
          Cancel
        </Button>
        <Button fullWidth onClick={save} loading={saving} disabled={Boolean(rangeError) || !draft.calendarId}>
          {event ? 'Save' : 'Add'}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this event?"
        message="This cannot be undone. Recurring events are deleted in full."
        confirmLabel="Delete"
        destructive
        onConfirm={remove}
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
