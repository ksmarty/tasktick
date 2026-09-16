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
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Trash2 } from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  DateField,
  SegmentedControl,
  Sheet,
  TextArea,
  TextField,
  TimeField,
  useToast,
} from '@/components/ui';
import { api } from '@/lib/api-client';
import { useMutation } from '@/lib/store';
import { timeIn } from '@/lib/dates';
import type { CompleteTaskPayload } from '@/lib/view-types';
import type { DateOnly, Priority, Task, TimeOnly } from '@/lib/types';

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

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

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState<Priority>('none');
  const [dueDate, setDueDate] = useState<DateOnly | null>(null);
  const [dueTime, setDueTime] = useState<TimeOnly | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!task) {
      hydratedFor.current = null;
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
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        title="Task"
        snapPoints={[0.5, 0.9]}
        footer={
          <div className="flex gap-2">
            <Button variant="gray" fullWidth loading={complete.isPending} disabled={busy} icon={Check} onClick={() => void complete.run()}>
              Complete
            </Button>
            <Button fullWidth loading={save.isPending} disabled={busy} onClick={() => void save.run()}>
              Save
            </Button>
          </div>
        }
      >
        <div className="space-y-4 pb-4">
          <TextField label="Title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={2000} />
          <TextArea label="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} maxLength={50_000} />

          <div>
            <p className="mb-2 px-1 text-footnote text-secondary">Priority</p>
            <SegmentedControl options={PRIORITY_OPTIONS} value={priority} onChange={setPriority} label="Priority" size="sm" />
            <p className="px-1 pt-1.5 text-caption-1 text-tertiary">High and Medium count as important in the matrix.</p>
          </div>

          <DateField
            label="Due date"
            value={dueDate}
            onChange={setDueDate}
            clearable={Boolean(dueDate)}
            onClear={() => {
              setDueDate(null);
              setDueTime(null);
            }}
          />
          <TimeField
            label="Due time"
            value={dueTime}
            onChange={setDueTime}
            clearable={Boolean(dueTime)}
            onClear={() => setDueTime(null)}
            placeholder="All day"
            disabled={!dueDate}
          />
          <p className="px-1 text-caption-1 text-tertiary">
            A task is urgent when it is due within three days or already overdue.
          </p>

          <Button fullWidth variant="destructive" icon={Trash2} disabled={busy} onClick={() => setConfirmDelete(true)}>
            Delete task
          </Button>
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this task?"
        message={`“${task?.title ?? 'This task'}” will be removed. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => void remove.run()}
      />
    </>
  );
}
