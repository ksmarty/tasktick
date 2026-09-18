'use client';

/**
 * The task editor — every field a task has, in a shadcn dialog (full-screen on a
 * phone, a centred panel from `sm` up).
 *
 * Saving is debounced (600ms after the last keystroke), flushed immediately when
 * the dialog closes, and available as an explicit **Save** button. The debounce
 * and the close-flush are the safety net — a change is never lost if the sheet is
 * dismissed — while the button is the deliberate action: it saves at once and
 * carries the saving/failure state. It is disabled while the draft is unmodified,
 * so it never fires a write with nothing to send. Picking a value inside a
 * sub-drawer makes the editor undismissible for the duration, which keeps Escape
 * from closing both at once.
 *
 * ## The date and time fields
 *
 * The due date is a shadcn `Calendar` (react-day-picker) inside a `Popover`; the
 * floating day (`YYYY-MM-DD`, no timezone) is converted to and from the `Date`
 * the picker speaks with Luxon **at the edge only**, so a day never gets compared
 * against an instant. The due time is a native `<input type="time">` that stores
 * `HH:mm`: a native control renders in the user's own 12h/24h convention and
 * emits `HH:mm` either way, so the `timeFormat` setting has nothing to do here.
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
import { humanDuration, relativeDayLabel, timeIn, todayIn } from '@/lib/dates';
import { describeRRule, weekdayOfDate } from '@/lib/rrule';
import { useMediaQuery, useResource } from '@/lib/store';
import type { Task } from '@/lib/types';
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
        'flex min-h-12 w-full items-center gap-3 rounded-md px-row py-2 text-left text-sm',
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
    blocked.current = false;
  }, [task?.id, open]);

  // The snackbar's `autoHideDuration`, kept: an inline error that never leaves
  // would outlive the mistake it reports.
  useEffect(() => {
    if (saveError === null) return;
    const timer = window.setTimeout(() => setSaveError(null), SAVE_ERROR_MS);
    return () => window.clearTimeout(timer);
  }, [saveError]);

  const flush = useCallback(async () => {
    const current = latest.current;
    const pending = current.draft;
    if (!current.task || !current.dirty) return;

    const seq = editSeq.current;
    const saved = await current.actions.patch(current.task.id, pending);

    if (!saved) {
      // Nothing the user typed is dropped — the draft stays, the toast has
      // already fired, and the same failure is surfaced inline beside the
      // button. Editing again re-arms the save.
      blocked.current = true;
      setSaveError('Could not save the task.');
      return;
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
   * The explicit Save action.
   *
   * The debounce is the safety net; this is the deliberate save, so it flushes at
   * once instead of waiting out the quiet period. It is disabled while the draft
   * is unmodified, so it can never fire a write with nothing to send, and it owns
   * the button's in-flight state so a slow save reads as "Saving…".
   */
  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    await flush();
    setSaving(false);
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

            <div className="flex items-center gap-stack">
              <Popover open={dateOpen} onOpenChange={setDateOpen}>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" className="min-w-0 flex-1 justify-start" disabled={disabled}>
                    <CalendarIcon className="size-4 text-base" />
                    <span className="truncate">{dueDate ? relativeDayLabel(dueDate, zone) : 'No date'}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-0">
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

              <div className="flex min-h-12 items-center gap-3 px-row py-2 text-sm">
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

              <div className="flex items-center gap-3 px-row py-2">
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

              <div className="flex min-h-12 items-center gap-3 px-row py-2 text-sm">
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

            <h3 className="px-row text-sm font-medium">Subtasks</h3>
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

          <div className="flex shrink-0 flex-col gap-stack border-t px-gutter pt-stack pb-[max(1rem,env(safe-area-inset-bottom,0px))]">
            {disabled ? <p className="text-xs text-muted-foreground">{actions.offlineNotice}</p> : null}
            {saveError !== null ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{saveError}</AlertDescription>
              </Alert>
            ) : null}
            {/*
             * Save is the deliberate action and Delete is the destructive one, so
             * they share a row: Save takes the space and the default fill, Delete
             * keeps its own label and does not shrink. Save is disabled when the
             * draft is unmodified (`dirty`) and while its own write is in flight,
             * so it can never send an empty PATCH or a double one.
             */}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                className="flex-1"
                disabled={disabled || !task || !dirty || saving}
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
