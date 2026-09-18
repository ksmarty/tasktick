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
 * It is presentational and knows nothing about where it is mounted: it takes a
 * `Task` or a `CalendarItem`, an `onEdit` callback, and the resolved list or
 * calendar name. The tasks and Today screens pass the task editor; the calendar
 * screen can pass the event editor or its task editor without this file
 * changing. That is deliberate — the alternative was a second copy of the sheet
 * on the calendar, and the two would drift.
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
 * The title is the drawer's own heading. A task shows its due date/time, list,
 * priority, tags, notes and subtasks; an event shows its time range, calendar
 * and location. A field with nothing in it is omitted rather than shown blank.
 */
import { CalendarIcon } from '@svg-animated-icons/react/calendar';
import { CheckIcon } from '@svg-animated-icons/react/check';
import { ClockIcon } from '@svg-animated-icons/react/clock';
import { DotIcon } from '@svg-animated-icons/react/dot';
import { LightningBoltIcon } from '@svg-animated-icons/react/lightning-bolt';
import { Pencil1Icon } from '@svg-animated-icons/react/pencil-1';
import { Folder, MapPin } from 'lucide-react';
import { Drawer } from '@/components/godui/drawer';
import { Button } from '@/components/ui/button';
import { accentHex } from '@/lib/colors';
import { formatTime, relativeDayLabel, toDateOnly } from '@/lib/dates';
import type { AccentColor, CalendarItem, Task } from '@/lib/types';
import { cn } from '@/lib/utils';
import { priorityColor, priorityLabel } from './priority';
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

/** A labelled block below the field rows, for prose and lists. */
function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </div>
  );
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

  return (
    <>
      <Field icon={<ClockIcon />} label="Due">
        {due ? <span className={DUE_TONE_CLASS[due.tone]}>{due.label}</span> : 'No date'}
      </Field>

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
  calendarName,
  zone,
  timeFormat,
}: {
  event: CalendarItem;
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
  const date = relativeDayLabel(toDateOnly(event.startMs, zone), zone);
  const time = event.isAllDay
    ? 'All day'
    : `${formatTime(event.startMs, { zone, timeFormat, weekStartsOn: 0 })} – ${formatTime(event.endMs, {
        zone,
        timeFormat,
        weekStartsOn: 0,
      })}`;

  return (
    <>
      <Field icon={<CalendarIcon className="text-base" disableHover />} label="Date">
        {date}
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

      {event.location ? (
        <Field icon={<MapPin className="size-4" />} label="Location">
          {event.location}
        </Field>
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
  zone,
  timeFormat,
  onEdit,
}: ItemDetailSheetProps) {
  const item = task ?? event ?? null;
  const title = item?.title ?? '';

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
              calendarName={calendarName}
              zone={zone}
              timeFormat={timeFormat}
            />
          ) : null}

          <Button type="button" className="mt-1 w-full" onClick={onEdit}>
            <Pencil1Icon className="size-4 text-base" disableHover />
            Edit
          </Button>
        </div>
      ) : null}
    </Drawer>
  );
}
