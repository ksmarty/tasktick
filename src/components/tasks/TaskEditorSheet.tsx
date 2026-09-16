'use client';

/**
 * The task editor — every field a task has, in an iOS bottom sheet.
 *
 * Saving is debounced (600ms after the last keystroke) and flushed immediately
 * when the sheet closes, so a user who edits and swipes away never loses a
 * change. Picking a value inside a sub-sheet makes the editor undismissible for
 * the duration, which keeps Escape from closing both at once.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Calendar, Clock, Flag, Link2, List as ListIcon, Repeat, Tag as TagIcon, Trash } from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  DateField,
  Divider,
  ListGroup,
  ListRow,
  SectionHeader,
  Sheet,
  Stepper,
  Switch,
  TextArea,
  TextField,
  TimeField,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { combineDateAndTime, formatTime, humanDuration, relativeDayLabel, timeIn, todayIn } from '@/lib/dates';
import { describeRRule, weekdayOfDate } from '@/lib/rrule';
import { useResource } from '@/lib/store';
import type { Task } from '@/lib/types';
import type { BootstrapPayload } from '@/lib/view-types';
import { ListPicker } from './ListPicker';
import { PriorityPicker } from './PriorityPicker';
import { ReminderPicker, describeReminders } from './ReminderPicker';
import { RepeatPicker } from './RepeatPicker';
import { SubTaskList } from './SubTaskList';
import { TagPicker } from './TagPicker';
import { priorityLabel, priorityTextClass } from './priority';
import type { TaskPatch } from './payloads';
import { useTaskActions } from './useTaskActions';

/** Quiet period after the last edit before the PATCH goes out. */
const SAVE_DEBOUNCE_MS = 600;

type PickerId = 'repeat' | 'reminder' | 'priority' | 'list' | 'tags' | 'date' | 'time';

export interface TaskEditorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The task being edited; `null` renders an empty sheet body. */
  task: Task | null;
  /**
   * Called after a write lands. The views use it to refresh the list the task
   * came from — an editor write cannot be applied optimistically to a filtered
   * collection it does not own.
   */
  onSaved?: () => void;
}

export function TaskEditorSheet({ open, onOpenChange, task, onSaved }: TaskEditorSheetProps) {
  const { data: bootstrap } = useResource<BootstrapPayload>('/api/bootstrap', undefined, { staleAfterMs: 60_000 });
  const zone = bootstrap?.settings.timezone ?? bootstrap?.user.timezone ?? 'utc';
  const timeFormat = bootstrap?.settings.timeFormat ?? '24h';
  const weekStartsOn = bootstrap?.settings.weekStartsOn ?? 1;
  const lists = bootstrap?.lists ?? [];
  const tags = bootstrap?.tags ?? [];

  const actions = useTaskActions(zone);

  const [draft, setDraft] = useState<TaskPatch>({});
  const [picker, setPicker] = useState<PickerId | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // The debounce and the close-flush both need the newest values without
  // re-creating themselves on every keystroke.
  const latest = useRef({ draft, task, actions, onSaved });
  latest.current = { draft, task, actions, onSaved };
  const editSeq = useRef(0);
  /** Set when a save failed, so the debounce does not hammer the server. */
  const blocked = useRef(false);

  useEffect(() => {
    setDraft({});
    setPicker(null);
    setConfirmOpen(false);
    blocked.current = false;
  }, [task?.id, open]);

  const flush = useCallback(async () => {
    const current = latest.current;
    const pending = current.draft;
    if (!current.task || Object.keys(pending).length === 0) return;

    const seq = editSeq.current;
    const saved = await current.actions.patch(current.task.id, pending);

    if (!saved) {
      // Nothing the user typed is dropped — the draft stays and the error was
      // already surfaced as a toast. Editing again re-arms the save.
      blocked.current = true;
      return;
    }
    current.onSaved?.();
    // Only clear the draft when no further edit arrived while this one was in
    // flight; otherwise those later edits would be wiped from the form.
    if (editSeq.current === seq) setDraft({});
  }, []);

  useEffect(() => {
    if (!open || !task) return;
    if (Object.keys(draft).length === 0 || blocked.current) return;
    if (!actions.online) return;
    const timer = window.setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, open, task, actions.online, flush]);

  function edit(patch: TaskPatch) {
    editSeq.current += 1;
    blocked.current = false;
    setDraft((current) => ({ ...current, ...patch }));
  }

  function handleOpenChange(next: boolean) {
    if (!next) void flush();
    onOpenChange(next);
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
  const estimateMinutes = draft.estimateMinutes !== undefined ? draft.estimateMinutes : (task?.estimateMinutes ?? 0);
  const isPinned = draft.isPinned ?? task?.isPinned ?? false;
  const subtasks = task?.subtasks ?? [];

  const activeList = lists.find((list) => list.id === listId) ?? null;
  const selectedTags = tags.filter((tag) => tagIds.includes(tag.id));
  const repeatAnchorDay = weekdayOfDate(dueDate ?? todayIn(zone));

  const disabled = !actions.online;

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={handleOpenChange}
        title="Task"
        dismissible={!picker && !confirmOpen}
        footer={
          <div className="space-y-2">
            {disabled ? <p className="text-footnote text-secondary">{actions.offlineNotice}</p> : null}
            {actions.isSaving ? <p className="text-footnote text-secondary">Saving…</p> : null}
            <Button
              variant="destructive"
              fullWidth
              icon={Trash}
              disabled={disabled || !task}
              onClick={() => setConfirmOpen(true)}
            >
              Delete task
            </Button>
          </div>
        }
      >
        <div className="pb-2">
          <ListGroup inset={false} className="mt-1">
            <div className="px-1">
              <TextArea
                rows={1}
                autoGrow
                aria-label="Title"
                placeholder="Title"
                value={title}
                disabled={disabled}
                inputClassName="text-headline font-semibold"
                onChange={(event) => edit({ title: event.target.value })}
                onKeyDown={(event) => {
                  // A title is one line; Enter files it away instead of adding a newline.
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
              />
            </div>
            <Divider />
            <div className="px-1">
              <TextArea
                rows={2}
                aria-label="Notes"
                placeholder="Notes"
                value={notes}
                disabled={disabled}
                onChange={(event) => edit({ notes: event.target.value })}
              />
            </div>
          </ListGroup>

          <ListGroup inset={false} className="mt-4">
            <ListRow
              title="Due date"
              leading={<Calendar className="size-5" aria-hidden />}
              trailing={dueDate ? relativeDayLabel(dueDate, zone) : 'No date'}
              disabled={disabled}
              showChevron
              onClick={() => setPicker('date')}
            />
            <ListRow
              title="Time"
              leading={<Clock className="size-5" aria-hidden />}
              trailing={
                dueTime
                  ? formatTime(
                      combineDateAndTime(dueDate ?? todayIn(zone), dueTime, zone),
                      { zone, timeFormat, weekStartsOn },
                    )
                  : 'No time'
              }
              disabled={disabled}
              showChevron
              onClick={() => setPicker('time')}
            />
            <ListRow
              title="Repeat"
              leading={<Repeat className="size-5" aria-hidden />}
              trailing={describeRRule(recurrenceRule) ?? 'Never'}
              disabled={disabled}
              showChevron
              onClick={() => setPicker('repeat')}
            />
            <ListRow
              title="Reminder"
              leading={<Bell className="size-5" aria-hidden />}
              trailing={describeReminders(reminderOffsets)}
              disabled={disabled}
              showChevron
              onClick={() => setPicker('reminder')}
            />
            <ListRow
              title="Priority"
              leading={<Flag className={cn('size-5', priorityTextClass(priority))} aria-hidden />}
              trailing={
                <span className={cn('text-subhead', priority === 'none' ? 'text-secondary' : priorityTextClass(priority))}>
                  {priorityLabel(priority)}
                </span>
              }
              disabled={disabled}
              showChevron
              onClick={() => setPicker('priority')}
            />
          </ListGroup>

          <ListGroup inset={false} className="mt-4">
            <ListRow
              title="List"
              leading={<ListIcon className="size-5" aria-hidden />}
              trailing={activeList?.name ?? 'No list'}
              disabled={disabled}
              showChevron
              onClick={() => setPicker('list')}
            />
            <ListRow
              title="Tags"
              leading={<TagIcon className="size-5" aria-hidden />}
              trailing={
                selectedTags.length ? (
                  <span className="max-w-40 truncate">{selectedTags.map((tag) => `#${tag.name}`).join(' ')}</span>
                ) : (
                  'None'
                )
              }
              disabled={disabled}
              showChevron
              onClick={() => setPicker('tags')}
            />
            <ListRow
              title="Estimated time"
              trailing={
                <Stepper
                  size="sm"
                  min={0}
                  max={1440}
                  step={5}
                  value={estimateMinutes ?? 0}
                  label="Estimated time"
                  disabled={disabled}
                  onChange={(value) => edit({ estimateMinutes: value === 0 ? null : value })}
                  formatValue={(value) => (value === 0 ? 'None' : humanDuration(value))}
                />
              }
            />
            <div className="px-4 py-2">
              <TextField
                aria-label="Link"
                placeholder="https://…"
                inputMode="url"
                value={url}
                disabled={disabled}
                leading={<Link2 className="size-4" />}
                onChange={(event) => edit({ url: event.target.value })}
              />
            </div>
            <div className="flex min-h-11 items-center px-4">
              <Switch
                className="w-full"
                checked={isPinned}
                disabled={disabled}
                label="Pin to top"
                onCheckedChange={(checked) => edit({ isPinned: checked })}
              />
            </div>
          </ListGroup>

          <SectionHeader title="Subtasks" className="px-0 pt-6 pb-2" />
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
      </Sheet>

      <Sheet
        open={picker === 'date'}
        onOpenChange={(next) => setPicker(next ? 'date' : null)}
        title="Due date"
        dismissible
      >
        <div className="pb-2">
          <DateField
            value={dueDate}
            weekStartsOn={weekStartsOn}
            disabled={disabled}
            clearable
            onChange={(date) => {
              edit({ dueDate: date, clearDue: false });
              setPicker(null);
            }}
            onClear={() => {
              edit({ clearDue: true, dueDate: null, dueTime: null });
              setPicker(null);
            }}
          />
        </div>
      </Sheet>

      <Sheet
        open={picker === 'time'}
        onOpenChange={(next) => setPicker(next ? 'time' : null)}
        title="Time"
        dismissible
      >
        <div className="pb-2">
          <TimeField
            value={dueTime}
            format={timeFormat}
            minuteStep={5}
            disabled={disabled}
            clearable
            onChange={(time) => {
              edit({ dueDate: dueDate ?? todayIn(zone), dueTime: time, clearDue: false });
              setPicker(null);
            }}
            onClear={() => {
              edit({ dueTime: null, clearDue: false });
              setPicker(null);
            }}
          />
        </div>
      </Sheet>

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

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete this task?"
        message={`“${title}” will be removed from every list. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!task) return;
          const deleted = await actions.remove(task.id);
          if (!deleted) throw new Error('delete failed');
          setDraft({});
          onSaved?.();
          onOpenChange(false);
        }}
      />
    </>
  );
}
