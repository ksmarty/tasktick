'use client';

/**
 * The read-only detail sheet for one task or one calendar event.
 *
 * A tap on a row used to go straight into the editor, which made the editor the
 * only way to *read* an item: every screen that wanted to show "what is this"
 * had to open a form. This is the missing middle step — a bottom sheet that
 * shows the item's own details and carries the one action that leaves it, an
 * **Edit** button wired to the editor the caller already owns.
 *
 * ## Reusable by design
 *
 * It takes a `Task` or a `CalendarItem`, an `onEdit` callback, and the resolved
 * list or calendar name. The tasks and Today screens pass the task editor; the
 * calendar screen passes the event editor or its task editor. That is
 * deliberate — the alternative was a second copy of the sheet on the calendar,
 * and the two would drift.
 *
 * ## Showing everything, without empty rows
 *
 * The task branch receives the full `Task`, and the event branch's
 * `CalendarItem` is a deliberately thin projection, so the event branch also
 * reads `GET /api/events/:id` for the fields the projection drops — description,
 * attendees, organizer, categories, recurrence and reminders. That read is
 * supplementary: the sheet renders the item's own fields immediately, and adds
 * the rest when they land (a failed read simply omits them). Every row is
 * conditional on having a value, so nothing prints `Location: —` five times.
 *
 * ## Read-only items
 *
 * An item from a subscribed `ical` feed or a read-only `caldav` collection is a
 * mirror: nothing is ever written back, so its Edit action is **removed**, not
 * disabled. The projected `CalendarItem` already carries that as `readonly`
 * (from the calendar record's `readOnly`), so no calendar lookup is needed; an
 * explicit `readOnly` prop from the caller wins. A task from the task list
 * carries no flag and stays editable — a mirrored item is the only thing that
 * loses the action. The absence is not explained by a note: the sheet shows the
 * item and, when it can be edited, the action; a read-only item simply has no
 * action.
 *
 * ## The GodUI Drawer
 *
 * The overlay is the GodUI `Drawer`, the app's bottom-sheet primitive (see
 * `components/godui/drawer.tsx`). It owns the whole overlay contract —
 * `role="dialog"`, `aria-modal`, Escape, the scrim, the body scroll lock and
 * flick-to-dismiss — so nothing is hand-rolled here. The vendored panel's own
 * `p-5` is neutralised (`p-0`), as in `DayDetailSheet`, so the insets come from
 * the layout tokens and the safe-area expression rather than a vendored number.
 *
 * ## Row shape
 *
 * Every field is an icon, a muted label and a value against the trailing edge.
 * The title is the drawer's own heading. A task shows its due date/time, start,
 * status, list, priority, recurrence, reminders, estimate, spent time, tags,
 * notes, link/place and subtasks; an event shows its full date range, time (or
 * an explicit "All day"), calendar, location, link/place, recurrence, status,
 * availability, organizer, reminders, attendees, categories and description. A
 * field with nothing in it is omitted rather than shown blank.
 *
 * ## Link and place previews
 *
 * A stored URL is shown as its readable host + path, not the raw string, and a
 * Google/Apple Maps link is parsed locally (`@/lib/links`) into the place name
 * and coordinates the long form carries. The anchor is always the plain
 * `https://` URL: on iOS that is a universal link, which the OS routes to the
 * installed maps app and to the web otherwise, and it works the same on Android
 * and desktop. A short `maps.app.goo.gl` link carries no readable data — the id
 * is a redirect — so it still renders and opens, but with no parsed place beside
 * it. A field with nothing to show is omitted entirely.
 *
 * ## Description links
 *
 * An event's `description` is free text and often carries a URL. It is split by
 * `@/lib/linkify` and the URLs render as anchors — a real tap target with a
 * tinted background rather than dead underlined text. Only `http(s)` and a bare
 * `www.` host are matched, and the href is built from the matched scheme, so a
 * `javascript:` value can never become a link.
 */
import { BellIcon } from '@svg-animated-icons/react/bell';
import { CalendarIcon } from '@svg-animated-icons/react/calendar';
import { CheckIcon } from '@svg-animated-icons/react/check';
import { ClockIcon } from '@svg-animated-icons/react/clock';
import { DotIcon } from '@svg-animated-icons/react/dot';
import { GlobeIcon } from '@svg-animated-icons/react/globe';
import { InfoCircledIcon } from '@svg-animated-icons/react/info-circled';
import { LightningBoltIcon } from '@svg-animated-icons/react/lightning-bolt';
import { Link1Icon } from '@svg-animated-icons/react/link-1';
import { LoopIcon } from '@svg-animated-icons/react/loop';
import { Pencil1Icon } from '@svg-animated-icons/react/pencil-1';
import { PeopleIcon } from '@svg-animated-icons/react/people';
import { PersonIcon } from '@svg-animated-icons/react/person';
import { TimerIcon } from '@svg-animated-icons/react/timer';
import { Folder, MapPin, Tag as TagIcon } from 'lucide-react';
import { Drawer } from '@/components/godui/drawer';
import { Button } from '@/components/ui/button';
import { accentHex } from '@/lib/colors';
import { formatDateTime, formatTime, humanDuration, relativeDayLabel, toDateOnly } from '@/lib/dates';
import { linkify } from '@/lib/linkify';
import { isHttpUrl, linkPreview } from '@/lib/links';
import { describeRRule } from '@/lib/rrule';
import { useResource } from '@/lib/store';
import type { AccentColor, Attendee, CalendarEvent, CalendarItem, Reminder, Task } from '@/lib/types';
import { cn } from '@/lib/utils';
import { priorityColor, priorityLabel } from './priority';
import { describeReminders } from './ReminderPicker';
import { dueLabel, type DueTone } from './TaskMeta';

/** The due date's tone, matching the row's own label. */
const DUE_TONE_CLASS: Record<DueTone, string> = {
  danger: 'text-destructive',
  tint: 'text-primary',
  secondary: 'text-foreground',
};

export interface ItemDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A task to show. Mutually exclusive with `event`. */
  task?: Task | null;
  /** An event to show. Mutually exclusive with `task`. */
  event?: CalendarItem | null;
  /** The task's list name, resolved by the caller. */
  listName?: string | null;
  /** The task's list colour, for the list dot. */
  listColor?: AccentColor | null;
  /** The event's calendar name, resolved by the caller. */
  calendarName?: string | null;
  /**
   * True when the item's calendar never writes back: a subscribed `ical` feed
   * or a read-only `caldav` collection. Defaults to the event projection's own
   * `readonly`; the task list leaves it unset so a task stays editable.
   */
  readOnly?: boolean;
  zone: string;
  timeFormat: '12h' | '24h';
  /** Opens the item's editor. The caller chooses which editor that is. */
  onEdit: () => void;
}

/** One icon + label + trailing value. */
function Field({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span aria-hidden className="inline-flex shrink-0 text-lg text-muted-foreground">
        {icon}
      </span>
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="ml-auto min-w-0 truncate text-right text-foreground">{children}</span>
    </div>
  );
}

/**
 * A stored URL: a readable label that is a real link, plus the place parsed out
 * of a maps link. Renders nothing when the value is not a usable http(s) link.
 *
 * The place name leads when the link carries one ("Eiffel Tower"), otherwise the
 * readable host + path does. Coordinates sit on their own muted line — a second
 * line, not a second row, so the sheet stays a detail sheet and not a link dump.
 */
function LinkField({ url }: { url: string }) {
  const preview = linkPreview(url);
  if (!preview) return null;

  const { href, display, place } = preview;
  const coordinates =
    place && place.latitude !== null && place.longitude !== null
      ? `${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}`
      : null;
  // A short maps link parses to a provider but no place, so it stays a plain
  // "Link": claiming a Place we could not read would be a lie.
  const isPlace = Boolean(place && (place.name || coordinates));

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3 text-sm">
        <span aria-hidden className="inline-flex shrink-0 text-lg text-muted-foreground">
          {isPlace ? <MapPin className="size-4" /> : <Link1Icon className="size-4" />}
        </span>
        <span className="shrink-0 text-muted-foreground">{isPlace ? 'Place' : 'Link'}</span>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto min-w-0 truncate text-right text-foreground underline-offset-2 hover:underline"
        >
          {display}
        </a>
      </div>
      {coordinates ? <p className="pl-7 text-xs text-muted-foreground tabular-nums">{coordinates}</p> : null}
    </div>
  );
}

/**
 * A description, with its URLs as real anchors.
 *
 * The prose stays one `whitespace-pre-wrap` paragraph; only the matched URLs
 * become anchors. The anchor is an inline box with its own padding and a tinted
 * background — visually distinct, and a comfortable tap target rather than a
 * bare line of underlined text. Vertical padding on an inline box grows the hit
 * area without disturbing the paragraph's line rhythm, and `break-words` keeps a
 * long URL from pushing the sheet wide while leaving a URL that fits intact.
 */
function LinkifiedDescription({ text }: { text: string }) {
  return (
    <p className="text-sm whitespace-pre-wrap text-foreground">
      {linkify(text).map((segment, index) =>
        segment.kind === 'link' ? (
          <a
            key={index}
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer"
            className="box-decoration-clone rounded-md bg-primary/10 px-1 py-1.5 font-medium text-primary break-words underline underline-offset-2 hover:bg-primary/15"
          >
            {segment.value}
          </a>
        ) : (
          <span key={index}>{segment.value}</span>
        ),
      )}
    </p>
  );
}

/** A labelled block below the field rows, for prose and lists. */
function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/** A task's start, as a relative day plus clock time, or null when it has none. */
function taskStartLabel(task: Task, zone: string, timeFormat: '12h' | '24h'): string | null {
  if (task.startAtMs !== null) {
    return `${relativeDayLabel(toDateOnly(task.startAtMs, zone), zone)} ${formatTime(task.startAtMs, {
      zone,
      timeFormat,
      weekStartsOn: 0,
    })}`;
  }
  if (task.startDate) return relativeDayLabel(task.startDate, zone);
  return null;
}

/** "Completed" / "Won't do", or null while the task is still a plain todo. */
function taskStatusLabel(status: Task['status']): string | null {
  if (status === 'completed') return 'Completed';
  if (status === 'wont_do') return "Won't do";
  return null;
}

/**
 * A recurrence rule in words. `mode` is a task's own repeat mode; a completion
 * rule is spelled out so "every day" is not misread as a schedule.
 */
function recurrenceText(rule: string | null | undefined, mode?: Task['recurrenceMode']): string | null {
  const text = describeRRule(rule);
  if (!text) return null;
  return mode === 'completion' ? `${text} (after completion)` : text;
}

/** A task's reminders on one line: offsets as words, absolute ones as a time. */
function reminderText(reminders: Reminder[], zone: string, timeFormat: '12h' | '24h'): string {
  return reminders
    .map((reminder) =>
      reminder.offsetMinutes !== null
        ? describeReminders([reminder.offsetMinutes])
        : formatDateTime(reminder.fireAtMs, { zone, timeFormat, weekStartsOn: 0 }),
    )
    .join(', ');
}

/** `PARTSTAT` from an iCalendar attendee, in words. */
const ATTENDEE_STATUS_LABEL: Record<string, string> = {
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  TENTATIVE: 'Tentative',
  'NEEDS-ACTION': 'No response',
};

function attendeeStatusLabel(status: string | undefined): string | null {
  if (!status) return null;
  return ATTENDEE_STATUS_LABEL[status.toUpperCase()] ?? status;
}

function attendeeLabel(attendee: Attendee): string {
  return attendee.name?.trim() || attendee.email;
}

function TaskDetails({
  task,
  listName,
  listColor,
  zone,
  timeFormat,
}: {
  task: Task;
  listName: string | null;
  listColor: AccentColor | null;
  zone: string;
  timeFormat: '12h' | '24h';
}) {
  const due = dueLabel(task, zone, timeFormat);
  const tags = task.tags ?? [];
  const subtasks = task.subtasks ?? [];
  const reminders = task.reminders ?? [];
  const start = taskStartLabel(task, zone, timeFormat);
  const repeats = recurrenceText(task.recurrenceRule, task.recurrenceMode);
  const status = taskStatusLabel(task.status);

  return (
    <>
      <Field icon={<ClockIcon />} label="Due">
        {due ? <span className={DUE_TONE_CLASS[due.tone]}>{due.label}</span> : 'No date'}
      </Field>

      {start ? (
        <Field icon={<ClockIcon />} label="Starts">
          {start}
        </Field>
      ) : null}

      {status ? (
        <Field icon={<CheckIcon />} label="Status">
          {status}
        </Field>
      ) : null}

      {listName ? (
        <Field icon={<Folder className="size-4" />} label="List">
          <span className="inline-flex items-center gap-1.5">
            {listColor ? (
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: accentHex(listColor) }}
              />
            ) : null}
            {listName}
          </span>
        </Field>
      ) : null}

      <Field icon={<LightningBoltIcon className={cn('text-base', priorityColor(task.priority))} />} label="Priority">
        {priorityLabel(task.priority)}
      </Field>

      {repeats ? (
        <Field icon={<LoopIcon />} label="Repeats">
          {repeats}
        </Field>
      ) : null}

      {reminders.length ? (
        <Field icon={<BellIcon />} label="Reminders">
          {reminderText(reminders, zone, timeFormat)}
        </Field>
      ) : null}

      {task.estimateMinutes ? (
        <Field icon={<TimerIcon />} label="Estimate">
          {humanDuration(task.estimateMinutes)}
        </Field>
      ) : null}

      {task.spentMinutes > 0 ? (
        <Field icon={<TimerIcon />} label="Time spent">
          {humanDuration(task.spentMinutes)}
        </Field>
      ) : null}

      {task.url ? <LinkField url={task.url} /> : null}

      {tags.length ? (
        <Block label="Tags">
          <ul className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <li
                key={tag.id}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
              >
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: accentHex(tag.color) }}
                />
                {`#${tag.name}`}
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      {task.notes ? (
        <Block label="Notes">
          <p className="text-sm whitespace-pre-wrap text-foreground">{task.notes}</p>
        </Block>
      ) : null}

      {subtasks.length ? (
        <Block label="Subtasks">
          <ul className="flex flex-col gap-1.5">
            {subtasks.map((subtask) => {
              const done = subtask.status === 'completed';
              return (
                <li key={subtask.id} className="flex items-center gap-2 text-sm">
                  <span
                    aria-hidden
                    className={cn('inline-flex shrink-0', done ? 'text-primary' : 'text-muted-foreground/60')}
                  >
                    {done ? <CheckIcon className="text-sm" /> : <DotIcon className="text-sm" />}
                  </span>
                  <span className={cn('min-w-0 flex-1', done && 'text-muted-foreground line-through')}>
                    {subtask.title}
                  </span>
                </li>
              );
            })}
          </ul>
        </Block>
      ) : null}
    </>
  );
}

function EventDetails({
  event,
  detail,
  calendarName,
  zone,
  timeFormat,
}: {
  event: CalendarItem;
  /** The full record when the sheet could read it — the thin item omits it. */
  detail: CalendarEvent | null;
  calendarName: string | null;
  zone: string;
  timeFormat: '12h' | '24h';
}) {
  /*
   * The date as well as the time. The sheet used to show the clock range alone,
   * or "All day", which made an event on another day unreadable: 09:00 on a
   * Tuesday and 09:00 next month both read "09:00". The day is a relative label
   * ("Today", "Tomorrow", a weekday, otherwise an absolute date), the same
   * treatment the task due label gets.
   */
  const startDay = toDateOnly(event.startMs, zone);
  // DTEND is exclusive for an all-day event, so its last visible day is the day
  // before; a timed event ends on the day its end instant falls on.
  const endDay = event.isAllDay
    ? toDateOnly(Math.max(event.startMs, event.endMs - 1), zone)
    : toDateOnly(event.endMs, zone);
  const date = relativeDayLabel(toDateOnly(event.startMs, zone), zone);
  const dateRange = endDay === startDay ? date : `${date} – ${relativeDayLabel(endDay, zone)}`;
  const time = event.isAllDay
    ? 'All day'
    : `${formatTime(event.startMs, { zone, timeFormat, weekStartsOn: 0 })} – ${formatTime(event.endMs, {
        zone,
        timeFormat,
        weekStartsOn: 0,
      })}`;

  const recurrence = recurrenceText(detail?.rrule ?? null);
  const attendees = detail?.attendees ?? [];
  const categories = detail?.categories ?? [];
  const reminders = detail?.reminders ?? [];
  const organizer = detail?.organizer ?? null;
  const organizerLabel = organizer?.name?.trim() || organizer?.email || null;

  return (
    <>
      <Field icon={<CalendarIcon className="text-base" disableHover />} label="Date">
        {dateRange}
      </Field>

      <Field icon={<ClockIcon />} label="Time">
        <span className="tabular-nums">{time}</span>
      </Field>

      {calendarName ? (
        <Field icon={<CalendarIcon className="text-base" disableHover />} label="Calendar">
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: accentHex(event.color) }}
            />
            {calendarName}
          </span>
        </Field>
      ) : null}

      {event.location && !isHttpUrl(event.location) ? (
        <Field icon={<MapPin className="size-4" />} label="Location">
          {event.location}
        </Field>
      ) : null}

      {/*
       * A location can itself be a URL (Google Calendar invites routinely put a
       * maps link in LOCATION), so it is previewed as a link when it is one and
       * shown as plain text when it is a place name.
       */}
      {event.location && isHttpUrl(event.location) ? <LinkField url={event.location} /> : null}
      {event.url ? <LinkField url={event.url} /> : null}

      {recurrence ? (
        <Field icon={<LoopIcon />} label="Repeats">
          {recurrence}
        </Field>
      ) : event.isRecurringInstance ? (
        <Field icon={<LoopIcon />} label="Repeats">
          Recurring
        </Field>
      ) : null}

      {detail?.status === 'tentative' || detail?.status === 'cancelled' ? (
        <Field icon={<InfoCircledIcon />} label="Status">
          {detail.status === 'tentative' ? 'Tentative' : 'Cancelled'}
        </Field>
      ) : null}

      {detail?.transparency === 'transparent' ? (
        <Field icon={<GlobeIcon />} label="Availability">
          Free
        </Field>
      ) : null}

      {organizerLabel ? (
        <Field icon={<PersonIcon />} label="Organizer">
          {organizerLabel}
        </Field>
      ) : null}

      {reminders.length ? (
        <Field icon={<BellIcon />} label="Reminders">
          {describeReminders(reminders)}
        </Field>
      ) : null}

      {attendees.length ? (
        <Block label="Attendees">
          <ul className="flex flex-col gap-1.5">
            {attendees.map((attendee, index) => (
              <li key={`${attendee.email}:${index}`} className="flex items-center gap-2 text-sm">
                <PeopleIcon className="shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-foreground">{attendeeLabel(attendee)}</span>
                {attendeeStatusLabel(attendee.status) ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {attendeeStatusLabel(attendee.status)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      {categories.length ? (
        <Block label="Categories">
          <ul className="flex flex-wrap gap-1.5">
            {categories.map((category) => (
              <li
                key={category}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
              >
                <TagIcon className="size-3" aria-hidden />
                {category}
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      {detail?.description ? (
        <Block label="Description">
          <LinkifiedDescription text={detail.description} />
        </Block>
      ) : null}
    </>
  );
}

export function ItemDetailSheet({
  open,
  onOpenChange,
  task,
  event,
  listName = null,
  listColor = null,
  calendarName = null,
  readOnly,
  zone,
  timeFormat,
  onEdit,
}: ItemDetailSheetProps) {
  const item = task ?? event ?? null;
  const title = item?.title ?? '';

  /*
   * The full event record, for the fields the projected `CalendarItem` does not
   * carry — description, attendees, recurrence, reminders. It is supplementary:
   * the sheet already renders everything the item itself carries, so a slow or
   * failed read leaves those rows out rather than blocking the sheet.
   */
  const detail = useResource<CalendarEvent>(event?.id ? `/api/events/${event.id}` : null, undefined, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  /*
   * Read-only when the item's calendar never writes back: every `ical`
   * subscription and a read-only `caldav` collection. The projected
   * `CalendarItem` already carries that as `readonly` (projected from the
   * calendar record's `readOnly`), so no calendar lookup is needed; an explicit
   * `readOnly` from the caller wins. A task from the task list carries no flag
   * and stays editable — only a mirrored item loses its Edit action.
   */
  const isReadOnly = readOnly ?? (event ? Boolean(event.readonly) : false);

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      side="bottom"
      title={title}
      className="p-0 px-card"
    >
      {item ? (
        <div className="flex flex-col gap-stack pb-[max(0.25rem,env(safe-area-inset-bottom,0px))]">
          {task ? (
            <TaskDetails
              task={task}
              listName={listName}
              listColor={listColor}
              zone={zone}
              timeFormat={timeFormat}
            />
          ) : null}
          {event ? (
            <EventDetails
              event={event}
              detail={detail.data ?? null}
              calendarName={calendarName}
              zone={zone}
              timeFormat={timeFormat}
            />
          ) : null}

          {isReadOnly ? null : (
            <Button type="button" className="mt-1 w-full" onClick={onEdit}>
              <Pencil1Icon className="size-4 text-base" disableHover />
              Edit
            </Button>
          )}
        </div>
      ) : null}
    </Drawer>
  );
}
