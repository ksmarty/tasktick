'use client';

/**
 * The task editor — every field a task has, in a shadcn dialog (full-screen on a
 * phone, a centred panel from `sm` up).
 *
 * Saving is debounced (600ms after the last keystroke), flushed immediately when
 * the dialog closes, and available as an explicit **Save** button. The debounce
 * and the close-flush are the safety net — a change is never lost if the sheet is
 * dismissed — while the button is the deliberate action: it saves at once and
 * carries the saving/failure state. It is enabled even when the draft is
 * unmodified (a deliberate "file it away" is a legitimate gesture) and disabled
 * only while a write is in flight, which is what keeps a second tap from sending
 * a second PATCH. Save then **closes** the sheet, so the button is one action and
 * not two. "Closing never loses a change" still holds because Save calls the same
 * `flush` the close path calls: whatever the draft holds goes out before the
 * sheet is dismissed, and the 600ms debounce remains for the case where the user
 * just walks away. A save that *fails* is the one case that leaves the sheet up,
 * because the draft is then the only copy of the change and the inline alert has
 * to stay beside it. Picking a value inside a sub-drawer makes the editor
 * undismissible for the duration, which keeps Escape from closing both at once.
 *
 * ## The date and time fields
 *
 * The due date is a shadcn `Calendar` (react-day-picker) inside a `Popover`; the
 * floating day (`YYYY-MM-DD`, no timezone) is converted to and from the `Date`
 * the picker speaks with Luxon **at the edge only**, so a day never gets compared
 * against an instant. Three quick picks — Today, Tomorrow and Next week — sit
 * above the calendar and set the day through the same `edit()` the calendar's own
 * `onSelect` uses. (The request read "add today and tomorrow sections", and inside
 * the editor's date popover these shortcuts are what that means: the task list
 * already groups its own work by urgency and the Today screen already has Today
 * and Tomorrow sections, so list sections would have been a duplicate.)
 *
 * The due time is the shared five-minute picker (`TimeField`), which stores
 * `HH:mm` and labels its hour half from the user's own 12h/24h convention, so
 * the `timeFormat` setting has nothing to do here. It is two selects rather than
 * a native time input because Safari on iOS does not implement `step` on one:
 * the native minute wheel lists all sixty minutes there whatever the attribute
 * says, so the five-minute choices have to come from the control. The field's name is the hour half's real placeholder — a native time
 * input ignores `placeholder`, which is why the label used to be drawn over the
 * control instead.
 *
 * All three fields are `h-9` with the same type scale — 16px on a phone, 14px
 * from `md` up — but the schedule is two lines: the date, then the two times
 * side by side. Two selects per field do not fit the one line three native
 * controls used to share.
 *
 * ## The clear control, and the room it needs
 *
 * Each field carries its own clear control (see `ClearFieldButton`). The control
 * is 16px wide, absolutely placed 4px from the field's trailing edge, so it
 * occupies the last 20px of the field. The value therefore has to *stop* 20px
 * short of that edge or it runs underneath the button — which is what a long
 * value did: the date's value box reached 12.0px into the button's 16px, so the
 * truncation ellipsis and the tail of the label were painted under the cross.
 * The fix is trailing padding, not a moved button: the date button and the time
 * inputs carry `pr-6` (24px) — 20px for the control plus a 4px gap — so the
 * value's box now ends 4.0px clear of the control. Padding rather than a
 * reserved flex column because a time field is four thirteenths of a 390px row
 * (107.7px since the date column was widened and the time columns narrowed), and a column would take that 20px
 * out of the *value* anyway while also changing the button's hit area; `pr-6` is
 * on Tailwind's scale, so no value is invented. Measured at 390px with a long
 * label in the date field: the value's box ended at 123.7px against a button
 * starting at 111.7px (12.0px of overlap, `scrollWidth` 86 against a 75px box,
 * i.e. the ellipsis itself was hidden); with `pr-6` the box ends 4.0px clear of
 * the control. The same 24px trailing padding is on both time inputs, so a
 * 12-hour value cannot reach its cross either.
 *
 * ## Specifying a date, a start and an end
 *
 * The schedule row is a date, a start time and an end time. Duration is derived
 * from the range (`estimateMinutes` = end − start) rather than picked from a
 * preset list, so a task is scheduled the way an event is. The record has no
 * end-time column, so only the start (`dueDate`/`dueTime`) and the derived
 * `estimateMinutes` are written — the same field the editor's own "Estimated
 * time" stepper edits, so the two controls are always in step and nothing new is
 * invented on the wire. The end field is enabled once a start exists; a task with
 * an estimate but no date keeps that estimate and shows a blank range.
 *
 * ## One horizontal axis for every field's content
 *
 * The editor's body is `px-gutter` (16px), so every field's *box* starts at
 * 16.0px. What a reader's eye actually tracks is the content inside those boxes,
 * and a bordered shadcn control puts its content 13px in (1px border + 12px
 * `px-3`) while a plain row button puts it 12px in (`px-3`, no border). That 1px
 * is invisible on its own but it is not the whole story here: the date field's
 * button had its own `px-2`, so its glyph sat at 25.0px — 4px left of the row
 * icons at 28.0px — and the time inputs sat at 29.0px. Three axes.
 *
 * Measured at 390px (panel gutter at 16px), content-box left of every field:
 * title text 29.0, notes text 29.0, date glyph 25.0, date value 49.0, start time
 * text 145.7, end time text 266.3, and the Repeat/Reminder/Priority/List/Tags/
 * Estimated/Link/Pin rows 28.0, the Subtasks heading 28.0. So the rows were not
 * *inset*: they sat 1.0px left of the title's text and 3.0px right of the date
 * field's glyph — the first from the field's border, the second from the date
 * button's smaller padding. Both are removed: the date button and the time
 * inputs now use `pl-3` (content at 29.0, date glyph 29.0, date value 53.0) and
 * every row below carries a 1px transparent border beside its `px-3`, which
 * lifts its content from 28.0 to 29.0. One axis, 29.0px, for all of them.
 *
 * The date keeps that axis: its glyph starts at 29.0px and its label at 49.0px
 * (`gap-1` where there used to be 8px of gap). The two time halves below it are
 * selects, so they carry the trigger's own chrome and are not placed on the text
 * axis by padding at all.
 *
 * The transparent border is the whole trick: an input draws its 1px frame inside
 * the box, a button does not, so the rows would otherwise be a pixel out. A
 * transparent border is layout-identical to the input's visible one and costs no
 * token value (`border` + `border-transparent` are both on Tailwind's scale).
 * `bg-clip: border-box` — the default — means a row's hover fill still covers
 * the same rounded rectangle it always did.
 *
 * ## Why the full-screen shape keeps a close button
 *
 * Under `sm` the panel covers the viewport, so there is no backdrop left to tap
 * — an explicit close control is the only pointer affordance that survives, and
 * the shadcn `DialogContent` close button is it. The delete confirmation, which
 * is never full-screen, keeps its labelled Cancel instead.
 *
 * ## The footer, and where Delete went
 *
 * The footer is the sheet's action row: **Cancel** on the left, **Save** on the
 * right. Save keeps the filled default variant and takes the whole remaining
 * width (`flex-1`), while Cancel is an outlined button sized to its label — so
 * the primary action is the dominant one by colour *and* by area, and the row
 * reads left-to-right as "leave" then "commit". Cancel closes the sheet exactly
 * the way Escape and the backdrop do, through `handleOpenChange`, so the close
 * still flushes the debounced draft: nothing typed is thrown away, because
 * "closing never loses a change" is the editor's contract for every exit.
 *
 * Delete is no longer in the action row at all. It is a destructive row at the
 * very bottom of the form's content, below the subtasks: the last thing in the
 * scroll is then the action that removes the task, not something sitting beside
 * Save where a mis-tap was one row away from committing. It keeps the same label
 * and the same confirmation dialog — only its position changed.
 *
 * The pickers for repeat, reminders, priority, list and tags are the shared
 * drawers in this folder.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { DateTime } from 'luxon';

import { BellIcon } from '@svg-animated-icons/react/bell';
import { CalendarIcon } from '@svg-animated-icons/react/calendar';
import { Cross1Icon } from '@svg-animated-icons/react/cross-1';
import { DrawingPinIcon } from '@svg-animated-icons/react/drawing-pin';
import { LoopIcon } from '@svg-animated-icons/react/loop';
import { MinusIcon } from '@svg-animated-icons/react/minus';
import { PlusIcon } from '@svg-animated-icons/react/plus';
import { TimerIcon } from '@svg-animated-icons/react/timer';
import { TrashIcon } from '@svg-animated-icons/react/trash';
import { ChevronRight, Flag, Folder, Link, LoaderCircle, Tag } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { HoldConfirmButton } from '@/components/godui/hold-confirm-button';
import { addDaysToDateOnly, humanDuration, TIME_INPUT_STEP_SECONDS, timeIn, todayIn } from '@/lib/dates';
import { describeRRule, weekdayOfDate } from '@/lib/rrule';
import { useMediaQuery, useResource } from '@/lib/store';
import type { DateOnly, Task } from '@/lib/types';
import { DateField, TimeField } from '@/components/schedule/fields';
import { AttachmentsSection } from '@/components/attachments/AttachmentsSection';
import { cn } from '@/lib/utils';
import type { BootstrapPayload } from '@/lib/view-types';
import { ConvertToEventDialog } from './ConvertToEventDialog';
import { ListPicker } from './ListPicker';
import { ListManagerDialog } from './ListManagerDialog';
import { PriorityPicker } from './PriorityPicker';
import { ReminderPicker, describeReminders } from './ReminderPicker';
import { RepeatPicker } from './RepeatPicker';
import { SubTaskList } from './SubTaskList';
import { TagPicker } from './TagPicker';
import { TagManagerDialog } from './TagManagerDialog';
import { priorityColor, priorityLabel } from './priority';
import type { TaskPatch } from './payloads';
import { useTaskActions } from './useTaskActions';

/** Quiet period after the last edit before the PATCH goes out. */
const SAVE_DEBOUNCE_MS = 600;

/** How long an inline save failure stays on screen. */
const SAVE_ERROR_MS = 4000;

/**
 * Minutes from `start` to `end`, both `HH:mm`.
 *
 * The end may be earlier than the start (an evening block that crosses
 * midnight), in which case the span wraps; a zero-length range is the absence of
 * a duration, not a zero one.
 */
function minutesBetweenTimes(start: string, end: string): number {
  const toMinutes = (time: string) => {
    const [hours, minutes] = time.split(':').map(Number);
    return (hours || 0) * 60 + (minutes || 0);
  };
  return (toMinutes(end) - toMinutes(start) + 24 * 60) % (24 * 60);
}

/** `HH:mm` that many minutes after `start`, wrapping at midnight. */
function addMinutesToTime(start: string, minutes: number): string {
  const [hours, mins] = start.split(':').map(Number);
  const total = ((hours || 0) * 60 + (mins || 0) + minutes) % (24 * 60);
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

type PickerId = 'repeat' | 'reminder' | 'priority' | 'list' | 'tags';

export interface TaskEditorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The task being edited; `null` renders an empty dialog body. */
  task: Task | null;
  /**
   * Called after a write lands. The views use it to refresh the list the task
   * came from — an editor write cannot be applied optimistically to a filtered
   * collection it does not own.
   */
  onSaved?: () => void;
}

/**
 * A textarea that grows with its content and never collapses below `minRows`.
 *
 * The title field was a single line of `text-xl`, so a title long enough to need
 * a second line was unreadable while it was being typed. The shadcn `Textarea`
 * ships `field-sizing-content`, which does this natively where it is supported,
 * but not in every browser this app targets — so the height is measured here
 * instead: reset to `auto`, read `scrollHeight`, and floor it at `minRows`
 * line-heights plus the field's own vertical padding. That explicit height is a
 * measured value, which is exactly what the spacing rules allow inline `style`
 * for.
 */
function AutoGrowTextarea({
  minRows,
  value,
  className,
  ...props
}: ComponentProps<typeof Textarea> & { minRows: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Measure the content, not the height the last measurement left behind.
    el.style.height = 'auto';
    const styles = window.getComputedStyle(el);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 0;
    const padding = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
    const floor = lineHeight * minRows + padding;
    el.style.height = `${Math.max(el.scrollHeight, floor)}px`;
  }, [value, minRows]);

  return (
    <Textarea
      ref={ref}
      rows={minRows}
      value={value}
      // `shrink-0`: the editor body is a flex column, and a flex item may shrink
      // below its content when the column runs out of room. Without this the
      // measured height is silently compressed back to the textarea's
      // `min-h-16` and the text clips — the exact bug this component fixes.
      className={cn('field-sizing-fixed shrink-0 resize-none overflow-hidden', className)}
      {...props}
    />
  );
}

/** One tappable field row: icon, label, current value, chevron. */
function EditorRow({
  icon,
  title,
  value,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  value: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex min-h-12 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm',
        // A 1px transparent border, so this borderless button's content sits on
        // the same 13px axis as the shadcn `Input`/`Textarea` above it. See the
        // file doc; it is layout-identical to the inputs' visible border.
        'border border-transparent',
        'hover:bg-accent hover:text-accent-foreground',
        'disabled:pointer-events-none disabled:opacity-50',
      )}
    >
      <span aria-hidden className="inline-flex shrink-0 text-xl text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <span className="max-w-[45%] shrink-0 truncate text-sm text-muted-foreground">{value}</span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground/60" />
    </button>
  );
}

export function TaskEditorSheet({ open, onOpenChange, task, onSaved }: TaskEditorSheetProps) {
  const { data: bootstrap } = useResource<BootstrapPayload>('/api/bootstrap', undefined, { staleAfterMs: 60_000 });
  const zone = bootstrap?.settings.timezone ?? bootstrap?.user.timezone ?? 'utc';
  const lists = bootstrap?.lists ?? [];
  const tags = bootstrap?.tags ?? [];
  /*
   * Every calendar, because the conversion dialog needs to *name* the one a task
   * already sits in even when it is not a destination — a task pulled from a
   * read-only or hidden collection — while offering only the writable, visible
   * ones as a choice. The filter is the dialog's (`selectableCalendars`), applied
   * to the choices rather than to this list.
   */
  const calendars = bootstrap?.calendars ?? [];
  /* react-day-picker wants the literal weekday union; the setting is 0 or 1. */
  const weekStartsOn = (bootstrap?.settings.weekStartsOn ?? 1) as 0 | 1;

  const actions = useTaskActions(zone);
  const fullScreen = useMediaQuery('(max-width: 639px)');

  const [draft, setDraft] = useState<TaskPatch>({});
  /**
   * Whether the draft holds an edit the server has not acknowledged yet.
   *
   * Kept as its own flag rather than derived from `draft`: the draft is not
   * cleared on a successful save (see `flush`), so it stays the form's values and
   * `Object.keys(draft).length` would never fall back to zero.
   */
  const [dirty, setDirty] = useState(false);
  const [picker, setPicker] = useState<PickerId | null>(null);
  /** The list manager, hosted here so it outlives the ListPicker drawer. */
  const [manageLists, setManageLists] = useState(false);
  /** The tag manager, hosted here for the same reason. */
  const [manageTags, setManageTags] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  /** The "Convert to event" chooser, hosted here so it outlives the row. */
  const [convertOpen, setConvertOpen] = useState(false);
  /** The due-date popover is controlled so picking a day closes it. */
  const [dateOpen, setDateOpen] = useState(false);
  /** A save failure is surfaced inline rather than only as a toast. */
  const [saveError, setSaveError] = useState<string | null>(null);
  /** The explicit Save button's own in-flight flag. */
  const [saving, setSaving] = useState(false);

  // The debounce and the close-flush both need the newest values without
  // re-creating themselves on every keystroke.
  const latest = useRef({ draft, dirty, task, actions, onSaved });
  latest.current = { draft, dirty, task, actions, onSaved };
  const editSeq = useRef(0);
  /** Set when a save failed, so the debounce does not hammer the server. */
  const blocked = useRef(false);

  useEffect(() => {
    setDraft({});
    setDirty(false);
    setSaving(false);
    setPicker(null);
    setConfirmOpen(false);
    setDateOpen(false);
    setSaveError(null);
    setManageLists(false);
    blocked.current = false;
  }, [task?.id, open]);

  // The snackbar's `autoHideDuration`, kept: an inline error that never leaves
  // would outlive the mistake it reports.
  useEffect(() => {
    if (saveError === null) return;
    const timer = window.setTimeout(() => setSaveError(null), SAVE_ERROR_MS);
    return () => window.clearTimeout(timer);
  }, [saveError]);

  const flush = useCallback(async (): Promise<boolean> => {
    const current = latest.current;
    const pending = current.draft;
    // Nothing to send is a success, not a failure: a deliberate Save of an
    // unmodified task is allowed, and it must still be able to close the sheet.
    if (!current.task || !current.dirty) return true;

    const seq = editSeq.current;
    const saved = await current.actions.patch(current.task.id, pending);

    if (!saved) {
      // Nothing the user typed is dropped — the draft stays, the toast has
      // already fired, and the same failure is surfaced inline beside the
      // button. Editing again re-arms the save.
      blocked.current = true;
      setSaveError('Could not save the task.');
      return false;
    }
    setSaveError(null);
    current.onSaved?.();
    /*
     * The draft is the form's values now, so it is deliberately *not* cleared.
     * Clearing it dropped the form back to the `task` prop captured when the
     * editor opened — which the list refetch does not replace — so a field the
     * user had just saved visibly reverted. Only the dirty flag is reset, and
     * only when no later edit arrived while this save was in flight.
     */
    if (editSeq.current === seq) setDirty(false);
    return true;
  }, []);

  useEffect(() => {
    if (!open || !task) return;
    if (!dirty || blocked.current) return;
    if (!actions.online) return;
    const timer = window.setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, dirty, open, task, actions.online, flush]);

  function edit(patch: TaskPatch) {
    editSeq.current += 1;
    blocked.current = false;
    setDirty(true);
    setDraft((current) => ({ ...current, ...patch }));
  }

  /**
   * A date-popover quick pick. It writes through `edit()` — the same path the
   * calendar's own `onSelect` uses — so a shortcut day is saved exactly like a
   * tapped one, and then closes the popover the way picking a day does.
   */
  function pickDueDay(day: DateOnly) {
    edit({ dueDate: day, clearDue: false });
    setDateOpen(false);
  }

  /**
   * The explicit Save action: save, then dismiss.
   *
   * The debounce is the safety net; this is the deliberate save, so it flushes at
   * once instead of waiting out the quiet period, and then closes the sheet — one
   * tap, one outcome. It is *not* gated on the draft being modified: a save of an
   * untouched task is a legitimate "file it away", and `flush` returns success
   * without a request when there is nothing to send. It is disabled only while a
   * write is in flight, which is what keeps a second tap from sending a second
   * PATCH — and whatever the draft held has already gone out through `flush`, so
   * closing cannot lose a change.
   *
   * A *failed* save is the one case that does not close: the write did not land,
   * so the draft is the only copy of what the user typed and the inline alert has
   * to stay on screen beside it. The sheet stays up until the write succeeds.
   */
  async function save() {
    if (saving || actions.isSaving) return;
    setSaving(true);
    const ok = await flush();
    setSaving(false);
    if (ok) onOpenChange(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) void flush();
    onOpenChange(next);
  }

  async function confirmDelete() {
    if (!task) return;
    const deleted = await actions.remove(task.id);
    if (!deleted) {
      setSaveError('Could not delete the task.');
      return;
    }
    setDraft({});
    onSaved?.();
    onOpenChange(false);
  }

  /* ------------------------------------------------------------------ values */

  const fallbackDueTime = task?.dueAtMs && !task.isAllDay ? timeIn(task.dueAtMs, zone) : null;

  const title = draft.title ?? task?.title ?? '';
  const notes = draft.notes ?? task?.notes ?? '';
  const url = draft.url ?? task?.url ?? '';
  const dueDate = draft.clearDue ? null : draft.dueDate !== undefined ? draft.dueDate : (task?.dueDate ?? null);
  const dueTime =
    draft.clearDue || draft.dueTime === null
      ? null
      : draft.dueTime !== undefined
        ? draft.dueTime
        : fallbackDueTime;
  const recurrenceRule =
    draft.clearRecurrence || draft.recurrenceRule === null
      ? null
      : draft.recurrenceRule !== undefined
        ? draft.recurrenceRule
        : (task?.recurrenceRule ?? null);
  const reminderOffsets =
    draft.clearReminders
      ? []
      : draft.reminders !== undefined
        ? draft.reminders.map((item) => item.offsetMinutes).filter((value): value is number => value !== null)
        : (task?.reminders ?? []).map((item) => item.offsetMinutes).filter((value): value is number => value !== null);
  const priority = draft.priority ?? task?.priority ?? 'none';
  const listId = draft.listId !== undefined ? draft.listId : (task?.listId ?? null);
  const tagIds = draft.tagIds ?? task?.tagIds ?? [];
  const estimateMinutes = (draft.estimateMinutes !== undefined ? draft.estimateMinutes : task?.estimateMinutes) ?? 0;
  // The end is derived, never stored: `dueTime + estimateMinutes`. An empty
  // start or a zero duration leaves the field blank rather than inventing one.
  const endTime = dueTime && estimateMinutes > 0 ? addMinutesToTime(dueTime, estimateMinutes) : '';
  const isPinned = draft.isPinned ?? task?.isPinned ?? false;
  const subtasks = task?.subtasks ?? [];

  const activeList = lists.find((list) => list.id === listId) ?? null;
  const selectedTags = tags.filter((tag) => tagIds.includes(tag.id));
  /*
   * The task's calendar as a *value*: `''` is "no calendar", which is what
   * `allowNone` expects and what a task belonging to no collection actually is.
   */
  const calendarId = draft.calendarId !== undefined ? draft.calendarId : (task?.calendarId ?? null);
  /*
   * The anchor day and the three quick picks are Luxon work — `todayIn` builds a
   * `DateTime` and formats it, `addDaysToDateOnly` parses, shifts and formats —
   * and this component's whole element tree, the closed dialog's children
   * included, is built on every render of the screen that owns it. Unmemoized,
   * that was six Luxon calls per render of `/tasks` whether or not the editor
   * was on screen. They depend on the zone and nothing else, so they are memoized
   * on it once.
   */
  const today = useMemo(() => todayIn(zone), [zone]);
  const quickPicks = useMemo(
    () => [
      { label: 'Today', day: today },
      { label: 'Tomorrow', day: addDaysToDateOnly(today, 1, zone) },
      { label: 'Next week', day: addDaysToDateOnly(today, 7, zone) },
    ],
    [today, zone],
  );
  const repeatAnchorDay = weekdayOfDate(dueDate ?? today);

  const disabled = !actions.online;

  const dateValue = dueDate ? DateTime.fromISO(dueDate, { zone }).toJSDate() : undefined;

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className={cn(
            'flex max-h-dvh flex-col gap-0 p-0',
            fullScreen
              ? 'top-0 left-0 h-dvh w-full max-w-full translate-x-0 translate-y-0 rounded-none border-0'
              : 'sm:max-w-lg',
          )}
          onEscapeKeyDown={(event) => {
            // A sub-picker or the list manager is open: Escape and the backdrop
            // must not close the editor out from under it.
            if (picker || confirmOpen || convertOpen || manageLists || manageTags) event.preventDefault();
          }}
          /*
           * No autofocus on the title on the edit path. Radix would focus the
           * first focusable control — the title textarea — so opening the editor
           * to *read* or make one change immediately put the caret in the title
           * and (on iOS) raised the keyboard. The quick-add sheet owns the
           * deliberately-synchronous focus it needs for the keyboard (see
           * `QuickAddBar`); this sheet does not, so it starts without stealing
           * focus. Keyboard users still reach the form on the first Tab.
           */
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            /*
             * Take focus anyway, onto the sheet itself. Preventing Radix's
             * autofocus left it where it was — on the row the user tapped — so
             * that row kept its `focus-visible:ring-2` and read as selected
             * while the sheet was open. The content is `outline-none`, so this
             * is a focus that cannot be seen.
             */
            (event.target as HTMLElement).focus({ preventScroll: true });
          }}
          onInteractOutside={(event) => {
            // A picker drawer and the delete confirmation both portal to `body`,
            // so Radix reads a press inside them as "outside the editor". The
            // `picker`/`confirmOpen` state alone is not enough: Radix defers the
            // pointer-down decision until after the click, by which time the
            // sub-menu's own handler has already cleared that state — and the
            // editor would dismiss under the value the user just picked. The
            // press's target is still the sub-menu, so test the DOM.
            const target = event.detail.originalEvent.target;
            const inSubMenu =
              target instanceof Element &&
              (target.closest('[role="dialog"]') !== null ||
                document.querySelector('[data-slot="drawer"]')?.parentElement?.contains(target) === true);
            // `convertOpen` is a dialog of its own, portalled to `body` like the
            // pickers: without it here, picking a calendar inside it read as a
            // press outside the editor and dismissed the editor underneath.
            if (picker || confirmOpen || convertOpen || inSubMenu) event.preventDefault();
          }}
        >
          <div
            className={cn(
              'flex shrink-0 items-center gap-2 border-b px-gutter pb-stack',
              fullScreen ? 'pt-[max(0.75rem,env(safe-area-inset-top,0px))]' : 'pt-stack',
            )}
          >
            <DialogTitle>Task</DialogTitle>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-stack overflow-y-auto px-gutter py-card">
            <AutoGrowTextarea
              aria-label="Title"
              placeholder="Title"
              minRows={2}
              value={title}
              disabled={disabled}
              onChange={(event) => edit({ title: event.target.value })}
              onKeyDown={(event) => {
                // A title is one line; Enter files it away instead of adding a newline.
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
              className="text-xl font-semibold"
            />

            <Separator />

            <AutoGrowTextarea
              aria-label="Notes"
              placeholder="Notes"
              minRows={3}
              value={notes}
              disabled={disabled}
              onChange={(event) => edit({ notes: event.target.value })}
            />

            <Separator />

            {/*
             * The schedule: a due day, then the start and end of the block.
             *
             * The two fields are the app's shared `DateField` / `TimeField`
             * (`@/components/schedule/fields`) — the same components the event
             * editor draws, which is why a task's date now reads "Fri Oct 30
             * 2026" in a labelled field instead of a relative word in an
             * unlabelled row. What is task-specific is only what a task needs:
             * `quickPicks` (Today / Tomorrow / Next week, which is how most due
             * dates get chosen) and `onClear` on both fields, because a task may
             * have no date at all and no time on the day it has.
             *
             * Duration is derived from the range (`estimateMinutes` = end −
             * start) rather than picked from a preset list, so a task is
             * scheduled the way an event is. The task record has no end-time
             * column, so the end is never stored: the start goes to
             * `dueDate`/`dueTime` and the derived span goes to
             * `estimateMinutes`, the field the "Estimated time" stepper below
             * reads and writes too, so the two controls cannot disagree. The end
             * field is available only once there is a start; an end with no
             * beginning is not a range.
             */}
            <div className="flex flex-col gap-2">
              <DateField
                id="task-due-date"
                label="Due"
                value={dueDate}
                zone={zone}
                weekStartsOn={weekStartsOn}
                quickPicks={quickPicks}
                disabled={disabled}
                onClear={() => edit({ clearDue: true, dueDate: null, dueTime: null })}
                onChange={(date) => edit({ dueDate: date, clearDue: false })}
              />

              <div className="grid grid-cols-2 gap-2">
                <TimeField
                  id="task-due-time"
                  label="Start"
                  value={dueTime ?? ''}
                  disabled={disabled || !dueDate}
                  onChange={(value) => {
                    if (!value) {
                      edit({ dueTime: null, clearDue: false });
                      return;
                    }
                    edit({ dueDate: dueDate ?? todayIn(zone), dueTime: value, clearDue: false });
                  }}
                  onClear={() => edit({ dueTime: null, clearDue: false })}
                />

                <TimeField
                  id="task-end-time"
                  label="End"
                  value={endTime}
                  disabled={disabled || !dueDate || !dueTime}
                  onChange={(value) => {
                    if (!value || !dueTime) {
                      edit({ estimateMinutes: null });
                      return;
                    }
                    const diff = minutesBetweenTimes(dueTime, value);
                    edit({ estimateMinutes: diff > 0 ? diff : null });
                  }}
                  onClear={() => edit({ estimateMinutes: null })}
                />
              </div>
            </div>

            <div className="flex flex-col">
              <EditorRow
                icon={<LoopIcon />}
                title="Repeat"
                value={describeRRule(recurrenceRule) ?? 'Never'}
                disabled={disabled}
                onClick={() => setPicker('repeat')}
              />
              <EditorRow
                icon={<BellIcon />}
                title="Reminder"
                value={describeReminders(reminderOffsets)}
                disabled={disabled}
                onClick={() => setPicker('reminder')}
              />
              <EditorRow
                icon={<Flag className={cn('size-5', priorityColor(priority))} />}
                title="Priority"
                value={priorityLabel(priority)}
                disabled={disabled}
                onClick={() => setPicker('priority')}
              />
            </div>

            <Separator />

            <div className="flex flex-col">
              <EditorRow
                icon={<Folder className="size-5" />}
                title="List"
                value={activeList?.name ?? 'No list'}
                disabled={disabled}
                onClick={() => setPicker('list')}
              />
              <EditorRow
                icon={<Tag className="size-5" />}
                title="Tags"
                value={selectedTags.length ? selectedTags.map((tag) => `#${tag.name}`).join(' ') : 'None'}
                disabled={disabled}
                onClick={() => setPicker('tags')}
              />

              <div className="flex min-h-12 items-center gap-3 px-3 py-2 text-sm border border-transparent">
                <span aria-hidden className="inline-flex shrink-0 text-xl text-muted-foreground">
                  <TimerIcon />
                </span>
                <span className="min-w-0 flex-1 truncate">Estimated time</span>
                <span className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Decrease estimated time"
                    disabled={disabled || estimateMinutes === 0}
                    onClick={() => {
                      const next = Math.max(0, estimateMinutes - 5);
                      edit({ estimateMinutes: next === 0 ? null : next });
                    }}
                  >
                    <MinusIcon className="size-4 text-base" />
                  </Button>
                  <span className="min-w-12 text-center text-sm text-muted-foreground tabular-nums">
                    {estimateMinutes === 0 ? 'None' : humanDuration(estimateMinutes)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Increase estimated time"
                    disabled={disabled || estimateMinutes >= 1440}
                    onClick={() => edit({ estimateMinutes: Math.min(1440, estimateMinutes + 5) })}
                  >
                    <PlusIcon className="size-4 text-base" />
                  </Button>
                </span>
              </div>

              <div className="flex items-center gap-3 px-3 py-2 border border-transparent">
                <Link aria-hidden className="size-5 shrink-0 text-muted-foreground" />
                <Input
                  aria-label="Link"
                  inputMode="url"
                  placeholder="https://…"
                  value={url}
                  disabled={disabled}
                  onChange={(event) => edit({ url: event.target.value })}
                />
              </div>

              <div className="flex min-h-12 items-center gap-3 px-3 py-2 text-sm border border-transparent">
                <span aria-hidden className="inline-flex shrink-0 text-xl text-muted-foreground">
                  <DrawingPinIcon />
                </span>
                <span className="min-w-0 flex-1 truncate">Pin to top</span>
                {/*
                 * A switch keeps one name and reports its state through
                 * `aria-checked` — a name that flips between "Pin…" and
                 * "Unpin…" would be announced as a different control.
                 */}
                <Switch
                  aria-label="Pin to top"
                  checked={isPinned}
                  disabled={disabled}
                  onCheckedChange={(checked) => edit({ isPinned: checked })}
                />
              </div>
            </div>

            <Separator />

            <h3 className="px-3 text-sm font-medium border border-transparent">Subtasks</h3>
            <SubTaskList
              subtasks={subtasks}
              disabled={disabled}
              onToggle={(subtask) =>
                void actions.complete(subtask, subtask.status === 'completed').then((result) => {
                  if (result) onSaved?.();
                })
              }
              onRename={(subtask, nextTitle) =>
                void actions.patch(subtask.id, { title: nextTitle }).then((result) => {
                  if (result) onSaved?.();
                })
              }
              onDelete={(subtask) =>
                void actions.remove(subtask.id).then((removed) => {
                  if (removed) onSaved?.();
                })
              }
              onAdd={async (nextTitle) => {
                if (!task) return;
                const created = await actions.create({ title: nextTitle, parentId: task.id, listId });
                if (created) onSaved?.();
              }}
            />

            <Separator />

            {/*
             * Files, below the subtasks: both are "things that hang off this
             * task", and both are a list you scroll rather than a field you set.
             * The section is shared with the event editor, so a file looks and
             * behaves the same wherever you attached it.
             */}
            <AttachmentsSection owner={task ? { taskId: task.id } : null} disabled={disabled} />

            <Separator />

            {/*
             * Convert to event, in the same place the destructive row lives — at
             * the end of the form, below the subtasks — because it is a *move* of
             * the whole record rather than a value of one field, and it used to be
             * a field: a "Calendar" combobox in the group above, which quietly
             * filed the task into a collection and left it a task. Tapping this
             * asks which calendar to put the event in, then moves the task there
             * as an event.
             */}
            <Button
              type="button"
              variant="ghost"
              disabled={disabled || !task}
              onClick={() => setConvertOpen(true)}
              className="min-h-12 w-full justify-start gap-3 rounded-md px-3 border border-transparent"
            >
              <CalendarIcon className="size-4 text-base" />
              <span className="min-w-0 flex-1 truncate text-left">Convert to event</span>
              <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground/60" />
            </Button>

            {/*
             * Delete, at the very bottom of the form's content rather than in
             * the footer's action row. It is a row like the ones above it —
             * icon, label, `min-h-12`, the same 29px content axis (hence the
             * transparent border) — but painted with the destructive colour so
             * it cannot be mistaken for a value. The confirmation dialog below
             * is unchanged.
             */}
            <Button
              type="button"
              variant="ghost"
              disabled={disabled || !task}
              onClick={() => setConfirmOpen(true)}
              className="min-h-12 w-full justify-start gap-3 rounded-md px-3 text-destructive hover:bg-destructive/10 hover:text-destructive border border-transparent"
            >
              <TrashIcon className="size-4 text-base" />
              Delete task
            </Button>
          </div>

          <div className="flex shrink-0 flex-col gap-stack border-t px-gutter pt-stack pb-[max(0.25rem,env(safe-area-inset-bottom,0px))]">
            {disabled ? <p className="text-xs text-muted-foreground">{actions.offlineNotice}</p> : null}
            {saveError !== null ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{saveError}</AlertDescription>
              </Alert>
            ) : null}
            {/*
             * Cancel on the left, Save on the right. Save keeps the filled
             * default variant and takes the whole remaining width (`flex-1`),
             * while Cancel is outlined and sized to its label, so the primary
             * action is the dominant one by colour and by area and the row reads
             * as "leave" then "commit".
             *
             * Cancel goes through `handleOpenChange`, the same close path Escape
             * and the backdrop take, so it flushes the debounced draft —
             * cancelling means "dismiss", never "throw away what I typed".
             *
             * Save is enabled even when nothing has been edited — a deliberate
             * "file it away" — and then closes the sheet; it is disabled only
             * while a write is in flight, so it can never send a double PATCH.
             */}
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                className="flex-1"
                disabled={disabled || !task || saving || actions.isSaving}
                aria-busy={saving || actions.isSaving || undefined}
                onClick={() => void save()}
              >
                {saving || actions.isSaving ? (
                  <>
                    <LoaderCircle aria-label="Saving" className="size-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  'Save'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <RepeatPicker
        open={picker === 'repeat'}
        onOpenChange={(next) => setPicker(next ? 'repeat' : null)}
        value={recurrenceRule}
        dueDay={repeatAnchorDay}
        cron={draft.cron}
        onChange={(rule) => edit({ recurrenceRule: rule, clearRecurrence: rule === null })}
        /*
         * The expression goes to the server as typed; it reads it into the rule,
         * the due time and a reminder at it, so the stored task cannot differ from
         * what the field previewed. An emptied box drops the field rather than
         * sending an empty string, which the schema would refuse.
         */
        onCronChange={(cron) => {
          if (!cron) {
            edit({ cron: undefined });
            return;
          }
          /*
           * An expression names a time of day, and a time of day needs a date to
           * land on: without one the task is all-day and the hour is dropped. So
           * applying one to a dateless task starts it today — visible in the sheet
           * as the date filling in, rather than a time that quietly went nowhere.
           */
          edit({ cron, ...(dueDate ? {} : { dueDate: today, clearDue: false }) });
        }}
      />
      <ReminderPicker
        open={picker === 'reminder'}
        onOpenChange={(next) => setPicker(next ? 'reminder' : null)}
        value={reminderOffsets}
        hasDueDate={Boolean(dueDate)}
        onChange={(offsets) =>
          edit({
            reminders: offsets.map((offsetMinutes) => ({ offsetMinutes })),
            clearReminders: offsets.length === 0,
          })
        }
      />
      <PriorityPicker
        open={picker === 'priority'}
        onOpenChange={(next) => setPicker(next ? 'priority' : null)}
        value={priority}
        onChange={(next) => edit({ priority: next })}
      />
      <ListPicker
        open={picker === 'list'}
        onOpenChange={(next) => setPicker(next ? 'list' : null)}
        lists={lists}
        value={listId}
        onChange={(next) => edit({ listId: next })}
        onManage={() => setManageLists(true)}
      />
      <ListManagerDialog
        open={manageLists}
        onOpenChange={setManageLists}
      />
      <TagPicker
        open={picker === 'tags'}
        onOpenChange={(next) => setPicker(next ? 'tags' : null)}
        tags={tags}
        value={tagIds}
        onChange={(next) => edit({ tagIds: next })}
        disabled={disabled}
        onCreate={actions.createTag}
        onManage={() => setManageTags(true)}
      />
      <TagManagerDialog open={manageTags} onOpenChange={setManageTags} />

      <ConvertToEventDialog
        open={convertOpen}
        onOpenChange={setConvertOpen}
        task={task}
        calendars={calendars}
        disabled={disabled}
        onConverted={() => {
          /*
           * The record this sheet was editing no longer exists, so it closes
           * rather than sitting on a deleted id — and the list behind it
           * refreshes through `onSaved`, the same path a delete takes.
           */
          onSaved?.();
          handleOpenChange(false);
        }}
      />

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent showCloseButton={false} className="gap-0 p-0">
          <div className="flex flex-col gap-stack p-card">
            <DialogTitle>Delete this task?</DialogTitle>
            <DialogDescription>
              {`“${title}” will be removed from every list. This cannot be undone.`}
            </DialogDescription>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <HoldConfirmButton
                variant="destructive"
                disabled={disabled || !task}
                onConfirm={() => void confirmDelete()}
              >
                Delete
              </HoldConfirmButton>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
