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
 * ## Material
 *
 * The sheet is a `Dialog` — full-screen on a phone, a centred card on a desktop
 * — so focus management, the scroll lock and Escape are Material's rather than a
 * hand-rolled trap. The start/end fields are `@mui/x-date-pickers`'
 * `DatePicker`/`TimePicker`, which is what the library is installed for; the
 * hand-rolled fields are gone. They need a `LocalizationProvider` with the Luxon
 * adapter (`luxon` is already a direct dependency, so no new package), and each
 * picker is handed the user's zone so the value it shows is the wall-clock value
 * the API speaks. The pickers only *display and edit* those floating values —
 * `lib/dates` remains the one place a date and a time become an instant.
 */
import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { DateTime } from 'luxon';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import Check from '@mui/icons-material/Check';
import DeleteOutlined from '@mui/icons-material/DeleteOutlined';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterLuxon } from '@mui/x-date-pickers/AdapterLuxon';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { TimePicker } from '@mui/x-date-pickers/TimePicker';
import { accentHex, resolveCalendarColor } from '@/lib/colors';
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
import type { Calendar, CalendarEvent, DateOnly, TimeOnly } from '@/lib/types';
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
  /**
   * Reports the result of a write. The screen has somewhere to show it after
   * this dialog has closed; when it is omitted the editor shows its own message.
   */
  onNotice?: (notice: { message: string; severity: 'success' | 'error' }) => void;
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

/** A floating `HH:mm` on an arbitrary (but valid) day, for the time picker. */
function timeToDateTime(time: TimeOnly, zone: string): DateTime {
  const [hour, minute] = time.split(':').map(Number);
  const value = DateTime.fromObject({ hour, minute }, { zone });
  return value.isValid ? value : DateTime.fromObject({ hour, minute }, { zone: 'utc' });
}

export function EventEditorSheet({
  open,
  onOpenChange,
  eventId,
  defaults,
  calendars,
  prefs,
  onChanged,
  onNotice,
  filter = null,
}: EventEditorSheetProps) {
  const { data: existing, error, isInitialLoading } = useResource<CalendarEvent>(
    eventId ? `/api/events/${eventId}` : null,
    undefined,
    { enabled: open && Boolean(eventId) },
  );

  const isEdit = Boolean(eventId);
  const ready = !isEdit || Boolean(existing);
  // A phone gets the whole screen: the fields and the software keyboard need it.
  const fullScreen = useMediaQuery((theme) => theme.breakpoints.down('sm'));

  return (
    <LocalizationProvider dateAdapter={AdapterLuxon}>
      <Dialog
        open={open}
        onClose={() => onOpenChange(false)}
        fullScreen={fullScreen}
        fullWidth
        maxWidth="sm"
        aria-labelledby="event-editor-title"
      >
        <DialogTitle id="event-editor-title">{isEdit ? 'Edit event' : 'New event'}</DialogTitle>

        {!ready ? (
          <DialogContent>
            {error ? (
              <Typography role="alert" variant="body2" color="error">
                {error}
              </Typography>
            ) : (
              <Stack spacing={1.5} aria-busy={isInitialLoading} sx={{ py: 1 }}>
                <Skeleton variant="rounded" height={48} />
                <Skeleton variant="rounded" height={128} />
                <Skeleton variant="rounded" height={96} />
              </Stack>
            )}
          </DialogContent>
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
            onNotice={onNotice}
          />
        )}
      </Dialog>
    </LocalizationProvider>
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

/** A transient message, the way MUI's own feedback is shown. */
interface Notice {
  message: string;
  severity: 'success' | 'error';
}

function EventForm({
  event,
  defaults,
  calendars,
  prefs,
  filter,
  onClose,
  onChanged,
  onNotice,
}: {
  event: CalendarEvent | null;
  defaults: EventDefaults;
  calendars: Calendar[];
  prefs: CalendarPrefs;
  filter: CalendarFilter | null;
  onClose: () => void;
  onChanged: () => void;
  onNotice?: (notice: Notice) => void;
}) {
  const today = todayIn(prefs.zone);
  const [draft, setDraft] = useState(() => buildDraft(event, defaults, calendars, filter, prefs.zone, today));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const calendarRefs = useRef(new Map<string, HTMLElement>());

  /** The screen shows the message when it can outlive this dialog, else we do. */
  const notify = (next: Notice) => {
    if (onNotice) onNotice(next);
    else setNotice(next);
  };

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
      notify({ message: event ? 'Event updated' : 'Event created', severity: 'success' });
      onClose();
    } catch (error) {
      notify({ message: `Could not save the event. ${errorMessage(error)}`, severity: 'error' });
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
      notify({ message: 'Event deleted', severity: 'success' });
      setConfirmDelete(false);
      onClose();
    } catch (error) {
      notify({ message: `Could not delete the event. ${errorMessage(error)}`, severity: 'error' });
    }
  }

  const repeatDescription = describeRRule(repeatRule);

  return (
    <>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <TextField
          value={draft.title}
          onChange={(input) => patch({ title: input.target.value })}
          placeholder="Title"
          aria-label="Title"
          fullWidth
        />

        <Paper
          component="section"
          variant="outlined"
          aria-label="Calendar"
          role="radiogroup"
          onKeyDown={onCalendarKeyDown}
          sx={{ overflow: 'hidden' }}
        >
          <List disablePadding>
            {calendars.map((calendar) => {
              const selected = calendar.id === draft.calendarId;
              return (
                <ListItem key={calendar.id} disablePadding>
                  <ListItemButton
                    ref={(node: HTMLElement | null) => {
                      if (node) calendarRefs.current.set(calendar.id, node);
                      else calendarRefs.current.delete(calendar.id);
                    }}
                    role="radio"
                    aria-checked={selected}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => patch({ calendarId: calendar.id })}
                    sx={{ gap: 1.5, minHeight: 44 }}
                  >
                    <Box
                      aria-hidden
                      sx={{
                        width: 12,
                        height: 12,
                        flexShrink: 0,
                        borderRadius: '50%',
                        bgcolor: accentHex(resolveCalendarColor(calendar.color, calendar.colorOverride)),
                      }}
                    />
                    <Typography variant="body2" noWrap sx={{ minWidth: 0, flex: 1, fontWeight: selected ? 600 : 400 }}>
                      {calendar.name}
                    </Typography>
                    {selected ? <Check aria-hidden sx={{ fontSize: 20, color: 'primary.main' }} /> : null}
                  </ListItemButton>
                </ListItem>
              );
            })}
          </List>
        </Paper>

        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1 }}>
            <Typography variant="body2" sx={{ flex: 1 }}>
              All-day
            </Typography>
            <Switch
              checked={draft.allDay}
              onChange={(input) => patch({ allDay: input.target.checked })}
              slotProps={{ input: { 'aria-label': 'All-day event' } }}
            />
          </Box>

          <Stack spacing={1.5} sx={{ px: 2, pb: 2 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
              <DatePicker
                label="Starts"
                value={toDateTime(draft.startDate, prefs.zone)}
                timezone={prefs.zone}
                onChange={(value) => {
                  if (!value) return;
                  const date = value.toFormat('yyyy-MM-dd');
                  // Keep the span: moving the start moves the end with it.
                  const delta = dayDelta(draft.startDate, date);
                  patch({ startDate: date, endDate: addDaysToDateOnly(draft.endDate, delta, prefs.zone) });
                }}
                slotProps={{ textField: { size: 'small', fullWidth: true } }}
              />
              {!draft.allDay ? (
                <TimePicker
                  label="Start time"
                  value={timeToDateTime(draft.startTime, prefs.zone)}
                  timezone={prefs.zone}
                  ampm={prefs.timeFormat === '12h'}
                  minutesStep={15}
                  onChange={(value) => {
                    if (value) patch({ startTime: value.toFormat('HH:mm') });
                  }}
                  slotProps={{ textField: { size: 'small', fullWidth: true } }}
                />
              ) : null}
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
              <DatePicker
                label="Ends"
                value={toDateTime(draft.endDate, prefs.zone)}
                timezone={prefs.zone}
                minDate={toDateTime(draft.startDate, prefs.zone)}
                onChange={(value) => {
                  if (value) patch({ endDate: value.toFormat('yyyy-MM-dd') });
                }}
                slotProps={{ textField: { size: 'small', fullWidth: true } }}
              />
              {!draft.allDay ? (
                <TimePicker
                  label="End time"
                  value={timeToDateTime(draft.endTime, prefs.zone)}
                  timezone={prefs.zone}
                  ampm={prefs.timeFormat === '12h'}
                  minutesStep={15}
                  onChange={(value) => {
                    if (value) patch({ endTime: value.toFormat('HH:mm') });
                  }}
                  slotProps={{ textField: { size: 'small', fullWidth: true } }}
                />
              ) : null}
            </Box>

            {rangeError ? (
              <Typography role="alert" variant="caption" color="error">
                {rangeError}
              </Typography>
            ) : null}
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ display: 'grid', gap: 1.5, p: 2 }}>
          <TextField
            label="Location"
            value={draft.location}
            onChange={(input) => patch({ location: input.target.value })}
            placeholder="Add a place"
            fullWidth
          />
          <TextField
            label="Notes"
            value={draft.notes}
            onChange={(input) => patch({ notes: input.target.value })}
            placeholder="Add notes"
            multiline
            minRows={2}
            slotProps={{ htmlInput: { maxLength: 50_000 } }}
            fullWidth
          />
        </Paper>

        <Paper variant="outlined" sx={{ display: 'grid', gap: 1, p: 2 }}>
          <TextField
            select
            label="Repeat"
            value={draft.repeatId}
            onChange={(input) => patch({ repeatId: input.target.value })}
            fullWidth
          >
            {REPEAT_PRESETS.map((preset) => (
              <MenuItem key={preset.id} value={preset.id}>
                {preset.label}
              </MenuItem>
            ))}
          </TextField>
          {repeatDescription ? (
            <Typography variant="caption" color="text.secondary">
              {repeatDescription}
            </Typography>
          ) : null}
        </Paper>

        <Paper component="section" variant="outlined" sx={{ display: 'grid', gap: 1, p: 2 }}>
          <Typography variant="subtitle2" component="h3">
            Reminders
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {REMINDER_OPTIONS.map((option) => {
              const selected = draft.reminders.includes(option.minutes);
              return (
                <Chip
                  key={option.minutes}
                  label={option.label}
                  aria-pressed={selected}
                  color={selected ? 'primary' : 'default'}
                  variant={selected ? 'filled' : 'outlined'}
                  onClick={() =>
                    patch({
                      reminders: selected
                        ? draft.reminders.filter((minutes) => minutes !== option.minutes)
                        : [...draft.reminders, option.minutes],
                    })
                  }
                />
              );
            })}
          </Box>
        </Paper>

        {event ? (
          <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
            <ListItemButton onClick={() => setConfirmDelete(true)} sx={{ justifyContent: 'center', gap: 1, minHeight: 44 }}>
              <DeleteOutlined aria-hidden sx={{ fontSize: 20 }} />
              <Typography variant="body2" color="error">
                Delete event
              </Typography>
            </ListItemButton>
          </Paper>
        ) : null}
      </DialogContent>

      <DialogActions sx={{ px: 2, py: 1.5, gap: 1 }}>
        <Button variant="outlined" color="inherit" onClick={onClose} sx={{ flex: 1 }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={save}
          loading={saving}
          disabled={Boolean(rangeError) || !draft.calendarId}
          sx={{ flex: 1 }}
        >
          {event ? 'Save' : 'Add'}
        </Button>
      </DialogActions>

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} aria-labelledby="confirm-delete-title">
        <DialogTitle id="confirm-delete-title">Delete this event?</DialogTitle>
        <DialogContent>
          <DialogContentText>This cannot be undone. Recurring events are deleted in full.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={remove}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={5000}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={notice?.severity ?? 'error'} variant="filled" onClose={() => setNotice(null)}>
          {notice?.message}
        </Alert>
      </Snackbar>
    </>
  );
}

/** Whole days between two floating dates, without a timezone in sight. */
function dayDelta(from: DateOnly, to: DateOnly): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}
