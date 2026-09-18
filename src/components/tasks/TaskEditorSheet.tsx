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
 * The due time is a native `<input type="time">` that stores `HH:mm`: a native
 * control renders in the user's own 12h/24h convention and emits `HH:mm` either
 * way, so the `timeFormat` setting has nothing to do here. It carries a
 * placeholder for the engines that honour one on a time field. Both halves of the
 * pair are `h-9` with the same type scale — 16px on a phone, 14px from `md` up —
 * so they read as one control.
 *
 * ## Specifying a date or a duration
 *
 * The schedule row has two modes, switched with a GodUI `SegmentedControl`. In
 * **Date** mode it is the calendar button plus the time field; in **Duration**
 * mode it is a row of duration quick-picks. Both write fields the task record
 * already has: the date is `dueDate`/`dueTime`, and the duration is
 * `estimateMinutes` — the same field the editor's own "Estimated time" stepper
 * edits, so the two controls are always in step and nothing new is invented on
 * the wire.
 *
 * The chosen mode is *derived* from the record rather than stored: the sheet opens
 * in Duration mode exactly when the task has an estimate and no due date, which is
 * the state the mode itself produces, so it survives a reload. A task that carries
 * *both* a date and an estimate reopens in Date mode, because there is no field on
 * a task (and no endpoint) that records the preference — see the report.
 *
 * ## One horizontal axis under the date row
 *
 * Every row below the schedule row is `px-3`, the same inner padding the shadcn
 * `Input`/`Textarea`/`Button` use, so the icons and labels land on the text axis
 * of the fields above them (measured: 29.0px from the panel's padding edge for the
 * date field's own content, 28.0px for the rows below — the 1px is the field's own
 * border). They used to be `px-row` (16px), which put them at 32.0px — 3px past
 * the axis, close enough to look like a mistake rather than a choice.
 *
 * ## Why the full-screen shape keeps a close button
 *
 * Under `sm` the panel covers the viewport, so there is no backdrop left to tap
 * — an explicit close control is the only pointer affordance that survives, and
 * the shadcn `DialogContent` close button is it. The delete confirmation, which
 * is never full-screen, keeps its labelled Cancel instead.
 *
 * The pickers for repeat, reminders, priority, list and tags are the shared
 * drawers in this folder.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import { DateTime } from 'luxon';

import { BellIcon } from '@svg-animated-icons/react/bell';
import { CalendarIcon } from '@svg-animated-icons/react/calendar';
import { DrawingPinIcon } from '@svg-animated-icons/react/drawing-pin';
import { LoopIcon } from '@svg-animated-icons/react/loop';
import { MinusIcon } from '@svg-animated-icons/react/minus';
import { PlusIcon } from '@svg-animated-icons/react/plus';
import { TimerIcon } from '@svg-animated-icons/react/timer';
import { TrashIcon } from '@svg-animated-icons/react/trash';
import { ChevronRight, Flag, Folder, Link, LoaderCircle, Tag } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { HoldConfirmButton } from '@/components/godui/hold-confirm-button';
import { SegmentedControl } from '@/components/godui/segmented-control';
import { addDaysToDateOnly, humanDuration, relativeDayLabel, timeIn, todayIn } from '@/lib/dates';
import { describeRRule, weekdayOfDate } from '@/lib/rrule';
import { useMediaQuery, useResource } from '@/lib/store';
import type { DateOnly, Task } from '@/lib/types';
import { cn } from '@/lib/utils';
import type { BootstrapPayload } from '@/lib/view-types';
import { ListPicker } from './ListPicker';
import { PriorityPicker } from './PriorityPicker';
import { ReminderPicker, describeReminders } from './ReminderPicker';
import { RepeatPicker } from './RepeatPicker';
import { SubTaskList } from './SubTaskList';
import { TagPicker } from './TagPicker';
import { priorityColor, priorityLabel } from './priority';
import type { TaskPatch } from './payloads';
import { useTaskActions } from './useTaskActions';

/** Quiet period after the last edit before the PATCH goes out. */
const SAVE_DEBOUNCE_MS = 600;

/** How long an inline save failure stays on screen. */
const SAVE_ERROR_MS = 4000;

/**
 * The duration quick-picks in the schedule row's Duration mode, in minutes.
 *
 * A small set rather than a free number field: these are the four or five
 * durations a task actually gets, they are one tap, and they round-trip as
 * `estimateMinutes` — the field the task record already stores. Anything else is
 * still reachable through the "Estimated time" stepper below, which edits the
 * same value.
 */
const DURATION_PRESETS = [
  { minutes: 15, label: '15m' },
  { minutes: 30, label: '30m' },
  { minutes: 60, label: '1h' },
  { minutes: 120, label: '2h' },
  { minutes: 240, label: '4h' },
] as const;

/** Which half of the schedule row is on screen: a due date, or a duration. */
type ScheduleMode = 'date' | 'duration';

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
  /** The schedule row's mode: a due date, or a duration (`estimateMinutes`). */
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('date');
  const [picker, setPicker] = useState<PickerId | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
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
    // The mode is read back off the record: a task that carries a duration and
    // no date is exactly the state Duration mode leaves behind, so reopening the
    // editor — after a reload, or on another day — lands in the same mode.
    setScheduleMode(
      task && !task.dueDate && (task.estimateMinutes ?? 0) > 0 ? 'duration' : 'date',
    );
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
  const isPinned = draft.isPinned ?? task?.isPinned ?? false;
  const subtasks = task?.subtasks ?? [];

  const activeList = lists.find((list) => list.id === listId) ?? null;
  const selectedTags = tags.filter((tag) => tagIds.includes(tag.id));
  const repeatAnchorDay = weekdayOfDate(dueDate ?? todayIn(zone));

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
            // A sub-picker is open: Escape and the backdrop must not close the
            // editor out from under it.
            if (picker || confirmOpen) event.preventDefault();
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
            if (picker || confirmOpen || inSubMenu) event.preventDefault();
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
             * The mode switch. A GodUI segmented control because this is exactly
             * a binary segmented choice, and it reports its state through
             * `aria-selected` on each option. `[&>button]:flex-1` splits the
             * control's full width evenly between the two options — the control
             * itself is `inline-flex`, so without it the pair would bunch at its
             * leading edge and leave the trailing half empty.
             */}
            <SegmentedControl
              aria-label="Specify by"
              size="sm"
              className="[&>button]:flex-1"
              options={[
                { value: 'date', label: 'Date' },
                { value: 'duration', label: 'Duration' },
              ]}
              value={scheduleMode}
              onChange={(next) => setScheduleMode(next === 'duration' ? 'duration' : 'date')}
            />

            {scheduleMode === 'date' ? (
              <div className="flex items-center gap-stack">
                <Popover open={dateOpen} onOpenChange={setDateOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      // `text-base md:text-sm` is the same type scale the shadcn
                      // `Input` uses, so the date button and the time field read as
                      // one pair (both `h-9`, both 16px on a phone).
                      className="min-w-0 flex-1 justify-start text-base md:text-sm"
                      disabled={disabled}
                    >
                      <CalendarIcon className="size-4 text-base" />
                      <span className="truncate">{dueDate ? relativeDayLabel(dueDate, zone) : 'No date'}</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto p-0">
                    {/*
                     * The quick picks, above the calendar: the three days that
                     * account for nearly every date a task gets. They write
                     * through the same `edit()` the calendar's own `onSelect`
                     * uses, so a picked day is saved exactly like a tapped one,
                     * and the pick that is already set reads as selected.
                     */}
                    <div className="flex gap-1 border-b border-border p-2">
                      {[
                        { label: 'Today', day: todayIn(zone) },
                        { label: 'Tomorrow', day: addDaysToDateOnly(todayIn(zone), 1, zone) },
                        { label: 'Next week', day: addDaysToDateOnly(todayIn(zone), 7, zone) },
                      ].map((pick) => (
                        <Button
                          key={pick.label}
                          type="button"
                          variant={dueDate === pick.day ? 'secondary' : 'ghost'}
                          size="sm"
                          aria-pressed={dueDate === pick.day}
                          className="flex-1"
                          onClick={() => pickDueDay(pick.day)}
                        >
                          {pick.label}
                        </Button>
                      ))}
                    </div>
                    <Calendar
                      mode="single"
                      autoFocus
                      weekStartsOn={weekStartsOn}
                      /* The picker opens on the task's own month, not today's. */
                      defaultMonth={dateValue}
                      selected={dateValue}
                      onSelect={(day) => {
                        if (!day) {
                          edit({ clearDue: true, dueDate: null, dueTime: null });
                        } else {
                          edit({ dueDate: DateTime.fromJSDate(day, { zone }).toISODate(), clearDue: false });
                        }
                        setDateOpen(false);
                      }}
                    />
                    {dueDate ? (
                      <div className="flex justify-end px-3 pb-3">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            edit({ clearDue: true, dueDate: null, dueTime: null });
                            setDateOpen(false);
                          }}
                        >
                          Clear
                        </Button>
                      </div>
                    ) : null}
                  </PopoverContent>
                </Popover>

                {/*
                 * `w-auto`: the parent is a row, and the date button is the
                 * flexible one. An `Input`'s default `w-full` is a 100% flex
                 * basis, which would win the space and collapse the button.
                 */}
                <Input
                  type="time"
                  aria-label="Time"
                  placeholder="--:--"
                  className="w-auto"
                  value={dueTime ?? ''}
                  disabled={disabled || !dueDate}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (!value) {
                      edit({ dueTime: null, clearDue: false });
                      return;
                    }
                    edit({ dueDate: dueDate ?? todayIn(zone), dueTime: value, clearDue: false });
                  }}
                />
              </div>
            ) : (
              /*
               * Duration mode: the quick-picks write `estimateMinutes`, the
               * field the record already stores, and the "Estimated time"
               * stepper below edits the same number, so the two never disagree.
               * Tapping the selected one clears it, which is the only way to get
               * back to "no duration" without the stepper.
               */
              <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Duration">
                {DURATION_PRESETS.map((preset) => {
                  const active = estimateMinutes === preset.minutes;
                  return (
                    <Button
                      key={preset.minutes}
                      type="button"
                      variant={active ? 'secondary' : 'outline'}
                      aria-pressed={active}
                      disabled={disabled}
                      onClick={() => edit({ estimateMinutes: active ? null : preset.minutes })}
                      className="flex-1"
                    >
                      {preset.label}
                    </Button>
                  );
                })}
              </div>
            )}

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

              <div className="flex min-h-12 items-center gap-3 px-3 py-2 text-sm">
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

              <div className="flex items-center gap-3 px-3 py-2">
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

              <div className="flex min-h-12 items-center gap-3 px-3 py-2 text-sm">
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

            <h3 className="px-3 text-sm font-medium">Subtasks</h3>
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
          </div>

          <div className="flex shrink-0 flex-col gap-stack border-t px-gutter pt-stack pb-[max(0.25rem,env(safe-area-inset-bottom,0px))]">
            {disabled ? <p className="text-xs text-muted-foreground">{actions.offlineNotice}</p> : null}
            {saveError !== null ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{saveError}</AlertDescription>
              </Alert>
            ) : null}
            {/*
             * Save is the deliberate action and Delete is the destructive one, so
             * they share a row: Save takes the space and the default fill, Delete
             * keeps its own label and does not shrink. Save is enabled even when
             * nothing has been edited — a deliberate "file it away" — and then
             * closes the sheet; it is disabled only while a write is in flight,
             * so it can never send a double PATCH.
             */}
            <div className="flex items-center gap-2">
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
              <Button
                type="button"
                variant="destructive"
                disabled={disabled || !task}
                onClick={() => setConfirmOpen(true)}
              >
                <TrashIcon className="size-4 text-base" />
                Delete task
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
        onChange={(rule) => edit({ recurrenceRule: rule, clearRecurrence: rule === null })}
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
      />
      <TagPicker
        open={picker === 'tags'}
        onOpenChange={(next) => setPicker(next ? 'tags' : null)}
        tags={tags}
        value={tagIds}
        onChange={(next) => edit({ tagIds: next })}
        disabled={disabled}
        onCreate={actions.createTag}
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
