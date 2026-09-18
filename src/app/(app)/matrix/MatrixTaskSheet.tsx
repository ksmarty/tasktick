'use client';

/**
 * A compact task editor for the matrix.
 *
 * Deliberately smaller than the full task sheet: the matrix is about sorting,
 * so this exposes only what a sorting decision needs — the title, the priority
 * that defines the importance axis, and the due date that defines the urgency
 * axis — plus the two ways a task leaves the matrix (completed, deleted).
 *
 * The PATCH body follows the server's `resolveDue` contract: a day without a
 * time is an all-day task, which is how clearing the clock time is expressed.
 *
 * GodUI and shadcn own the surfaces: a shadcn `Dialog` (full-screen on a phone,
 * via `useMediaQuery`), the fields as `Input`/`Textarea`, the priority choice as
 * GodUI's `SegmentedControl`, and the due date as shadcn's `Calendar` in a
 * `Popover`. The calendar is a JS `Date` widget, so luxon converts at the edge
 * only — `dateToDateTime`/`dateFromDateTime` below are display carriers, never
 * instants: nothing here is ever compared with `Date.now()` or written to the
 * API. The clock time is a native `<input type="time">`, which already speaks
 * the floating `HH:mm` the API wants, so no third date library is needed.
 *
 * Deleting leaves the sheet behind a GodUI `HoldConfirmButton`: a hold is a
 * deliberate act, and this is the one irreversible button in the sheet.
 */
import { useEffect, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { CalendarIcon } from '@svg-animated-icons/react/calendar';
import { CheckIcon } from '@svg-animated-icons/react/check';
import { CrossCircledIcon } from '@svg-animated-icons/react/cross-circled';
import { TrashIcon } from '@svg-animated-icons/react/trash';
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
import { Textarea } from '@/components/ui/textarea';
import { HoldConfirmButton } from '@/components/godui/hold-confirm-button';
import { SegmentedControl } from '@/components/godui/segmented-control';
import { useToast } from '@/components/app/Toast';
import { api } from '@/lib/api-client';
import { useMediaQuery, useMutation } from '@/lib/store';
import { timeIn } from '@/lib/dates';
import { cn } from '@/lib/utils';
import type { CompleteTaskPayload } from '@/lib/view-types';
import type { DateOnly, Priority, Task, TimeOnly } from '@/lib/types';

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

/** The viewport the sheet fills instead of floating in: shadcn's `sm`. */
const FULL_SCREEN_QUERY = '(max-width: 639px)';

/**
 * A floating `DateOnly` as a `DateTime` in the user's zone.
 *
 * The calendar reads the day back out of it, so this is a display carrier, never
 * a conversion to an instant: nothing here is ever compared with `Date.now()` or
 * written to the API.
 */
function dateToDateTime(date: DateOnly, zone: string): DateTime {
  const value = DateTime.fromISO(date, { zone });
  return value.isValid ? value : DateTime.fromISO(date, { zone: 'utc' });
}

/** The same floating day as the JS `Date` the shadcn calendar renders. */
function dateToCalendarDate(date: DateOnly, zone: string): Date {
  return dateToDateTime(date, zone).toJSDate();
}

/** The calendar's JS `Date` back to the floating `DateOnly` the API speaks. */
function dateFromCalendarDate(selected: Date, zone: string): DateOnly | null {
  const value = DateTime.fromJSDate(selected, { zone });
  return value.isValid ? value.toISODate() : null;
}

/**
 * The inline "working" spinner — an animated ring that takes the colour of the
 * button it sits in. The MUI version put a `CircularProgress` here; there is no
 * GodUI spinner, and a ring is a ring.
 */
function Spinner() {
  return (
    <span
      aria-hidden
      className="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

export interface MatrixTaskSheetProps {
  /** The task being edited; `null` closes the sheet. */
  task: Task | null;
  onOpenChange: (open: boolean) => void;
  zone: string;
  /** Called after any successful write so the matrix can refetch. */
  onChanged?: () => void;
}

export function MatrixTaskSheet({ task, onOpenChange, zone, onChanged }: MatrixTaskSheetProps) {
  const { toast } = useToast();
  const open = task !== null;
  const fullScreen = useMediaQuery(FULL_SCREEN_QUERY);

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState<Priority>('none');
  const [dueDate, setDueDate] = useState<DateOnly | null>(null);
  const [dueTime, setDueTime] = useState<TimeOnly | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);

  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!task) {
      hydratedFor.current = null;
      // The calendar popover lives inside the dialog, which unmounts when the
      // sheet closes; without this it would reappear open on the next task.
      setDateOpen(false);
      return;
    }
    if (hydratedFor.current === task.id) return;
    hydratedFor.current = task.id;

    setTitle(task.title);
    setNotes(task.notes ?? '');
    setPriority(task.priority);
    setDueDate(task.dueDate);
    setDueTime(!task.isAllDay && task.dueAtMs ? timeIn(task.dueAtMs, zone) : null);
  }, [task, zone]);

  const save = useMutation(
    async () => {
      const body: Record<string, unknown> = {
        title: title.trim() || task?.title || 'Untitled task',
        notes: notes.trim() ? notes.trim() : null,
        priority,
      };
      if (dueDate) {
        body.dueDate = dueDate;
        if (dueTime) body.dueTime = dueTime;
      } else {
        body.clearDue = true;
      }
      return api.patch<Task>(`/api/tasks/${task?.id}`, body);
    },
    {
      invalidates: ['/api/tasks'],
      onSuccess: () => {
        toast({ title: 'Task updated', variant: 'success' });
        onChanged?.();
        onOpenChange(false);
      },
      onError: (message) => toast({ title: 'Could not save the task', description: message, variant: 'error' }),
    },
  );

  const complete = useMutation(async () => api.post<CompleteTaskPayload>(`/api/tasks/${task?.id}/complete`), {
    invalidates: ['/api/tasks'],
    onSuccess: (result) => {
      toast({
        title: result?.recurred ? 'Repeating task moved to its next date' : 'Task completed',
        variant: 'success',
      });
      onChanged?.();
      onOpenChange(false);
    },
    onError: (message) => toast({ title: 'Could not complete the task', description: message, variant: 'error' }),
  });

  const remove = useMutation(async () => api.delete<{ deleted: boolean }>(`/api/tasks/${task?.id}`), {
    invalidates: ['/api/tasks'],
    onSuccess: () => {
      toast({ title: 'Task deleted', variant: 'success' });
      onChanged?.();
      onOpenChange(false);
    },
    onError: (message) => toast({ title: 'Could not delete the task', description: message, variant: 'error' }),
  });

  const busy = save.isPending || complete.isPending || remove.isPending;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          aria-labelledby="matrix-task-title"
          // The sheet is a form, not a sentence: there is nothing to describe.
          aria-describedby={undefined}
          className={cn(
            'flex flex-col gap-0 p-0',
            fullScreen
              ? 'top-0 left-0 h-dvh max-w-none translate-x-0 translate-y-0 rounded-none pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:max-w-none'
              : 'max-h-[90dvh]',
          )}
        >
          <DialogHeader className="shrink-0 gap-0 border-b border-border px-card pt-card pb-3">
            <DialogTitle id="matrix-task-title" className="pr-8 text-lg font-semibold">
              Task
            </DialogTitle>
          </DialogHeader>

          {/* The field column is the sheet's scroll pane, so the actions below
              stay reachable in the full-screen case on a short phone. */}
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-card py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="matrix-task-title-field">Title</Label>
              <Input
                id="matrix-task-title-field"
                value={title}
                maxLength={2000}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="matrix-task-notes">Notes</Label>
              <Textarea
                id="matrix-task-notes"
                value={notes}
                rows={3}
                maxLength={50_000}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <span className="px-1 text-sm text-muted-foreground">Priority</span>
              {/*
               * GodUI's segmented control is the app's single-choice widget, and
               * it spreads its props onto the control element, so `aria-label`
               * gives it the same accessible group name the ToggleButtonGroup
               * carried.
               */}
              <SegmentedControl
                aria-label="Priority"
                options={PRIORITY_OPTIONS.map(({ value, label }) => ({ value, label }))}
                value={priority}
                onChange={(next) => setPriority(next as Priority)}
                className="w-full [&>button]:flex-1"
              />
              <span className="px-1 text-xs text-muted-foreground">
                High and Medium count as important in the matrix.
              </span>
            </div>

            <div className="flex flex-col gap-2">
              <span className="px-1 text-sm text-muted-foreground">Due date</span>
              <div className="flex items-center gap-2">
                <Popover open={dateOpen} onOpenChange={setDateOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      aria-label="Due date"
                      className="min-w-0 flex-1 justify-start font-normal"
                    >
                      <CalendarIcon className="size-4 text-base" />
                      <span className="truncate">
                        {dueDate ? dateToDateTime(dueDate, zone).toLocaleString(DateTime.DATE_MED) : 'No due date'}
                      </span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={dueDate ? dateToCalendarDate(dueDate, zone) : undefined}
                      onSelect={(selected) => {
                        if (!selected) {
                          // Picking the selected day again clears the day — and
                          // with it the clock time, because a day without a time
                          // is what "all-day" means to the server.
                          setDueDate(null);
                          setDueTime(null);
                          return;
                        }
                        setDueDate(dateFromCalendarDate(selected, zone));
                        setDateOpen(false);
                      }}
                    />
                  </PopoverContent>
                </Popover>
                {dueDate ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Clear due date"
                    onClick={() => {
                      setDueDate(null);
                      setDueTime(null);
                    }}
                  >
                    <CrossCircledIcon className="size-4 text-base" />
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="matrix-task-due-time">Due time</Label>
              <Input
                id="matrix-task-due-time"
                aria-label="Due time"
                type="time"
                value={dueTime ?? ''}
                disabled={!dueDate}
                onChange={(event) => setDueTime(event.target.value || null)}
              />
            </div>

            <p className="px-1 text-xs text-muted-foreground">
              A task is urgent when it is due within three days or already overdue.
            </p>

            <Button
              type="button"
              variant="destructive"
              className="w-full"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              <TrashIcon className="size-4 text-base" />
              Delete task
            </Button>
          </div>

          <DialogFooter className="shrink-0 gap-2 border-t border-border px-card py-4">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={busy}
              aria-busy={complete.isPending || undefined}
              onClick={() => void complete.run()}
            >
              {complete.isPending ? <Spinner /> : <CheckIcon className="size-4 text-base" />}
              Complete
            </Button>
            <Button
              type="button"
              variant="default"
              className="flex-1"
              disabled={busy}
              aria-busy={save.isPending || undefined}
              onClick={() => void save.run()}
            >
              {save.isPending ? <Spinner /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        {/* The description below is what radix links through `aria-describedby`,
            so this dialog must not override it the way the sheet above does. */}
        <DialogContent aria-labelledby="matrix-delete-title">
          <DialogHeader>
            <DialogTitle id="matrix-delete-title">Delete this task?</DialogTitle>
            <DialogDescription>
              {`“${task?.title ?? 'This task'}” will be removed. This cannot be undone.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" disabled={remove.isPending} onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            {/*
             * The confirmation stays up — with a spinner — until the write
             * settles, then closes either way; the sheet itself closes only on
             * success.
             */}
            <HoldConfirmButton
              variant="destructive"
              disabled={remove.isPending}
              aria-label="Delete"
              onConfirm={() => void remove.run().then(() => setConfirmDelete(false))}
            >
              {remove.isPending ? (
                <>
                  <Spinner />
                  Delete
                </>
              ) : (
                'Delete'
              )}
            </HoldConfirmButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
