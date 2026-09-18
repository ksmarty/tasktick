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
 * Material owns the surfaces: a MUI `Dialog`, the fields as `TextField`s, the
 * priority choice as a `ToggleButtonGroup`, and the two date inputs as
 * `@mui/x-date-pickers`' `DatePicker`/`TimePicker` under the Luxon adapter
 * (`luxon` is already a direct dependency). The pickers only display and edit
 * the floating `DateOnly`/`HH:mm` values the API speaks — `lib/dates` stays the
 * one place a day and a time become an instant.
 */
import { useEffect, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import CheckIcon from '@mui/icons-material/Check';
import DeleteIcon from '@mui/icons-material/Delete';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterLuxon } from '@mui/x-date-pickers/AdapterLuxon';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { TimePicker } from '@mui/x-date-pickers/TimePicker';
import { useToast } from '@/components/app/Toast';
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

/**
 * A floating `DateOnly` as a `DateTime` in the user's zone.
 *
 * The picker reads the calendar fields back out of it, so this is a display
 * carrier, never a conversion to an instant: nothing here is ever compared with
 * `Date.now()` or written to the API.
 */
function dateToDateTime(date: DateOnly, zone: string): DateTime {
  const value = DateTime.fromISO(date, { zone });
  return value.isValid ? value : DateTime.fromISO(date, { zone: 'utc' });
}

/** A floating `HH:mm` on an arbitrary (but valid) day, for the time picker. */
function timeToDateTime(time: TimeOnly, zone: string): DateTime {
  const [hour, minute] = time.split(':').map(Number);
  const value = DateTime.fromObject({ hour, minute }, { zone });
  return value.isValid ? value : DateTime.fromObject({ hour, minute }, { zone: 'utc' });
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
      <LocalizationProvider dateAdapter={AdapterLuxon}>
        <Dialog
          open={open}
          onClose={() => onOpenChange(false)}
          fullWidth
          maxWidth="sm"
          aria-labelledby="matrix-task-title"
        >
          <DialogTitle id="matrix-task-title">Task</DialogTitle>

          <DialogContent>
            <Stack spacing={2} sx={{ pt: 0.5 }}>
              <TextField
                label="Title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                fullWidth
                slotProps={{ htmlInput: { maxLength: 2000 } }}
              />
              <TextField
                label="Notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                multiline
                rows={3}
                fullWidth
                slotProps={{ htmlInput: { maxLength: 50_000 } }}
              />

              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1, px: 1 }}>
                  Priority
                </Typography>
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  fullWidth
                  aria-label="Priority"
                  value={priority}
                  onChange={(_event, next: Priority | null) => {
                    if (next) setPriority(next);
                  }}
                >
                  {PRIORITY_OPTIONS.map((option) => (
                    <ToggleButton key={option.value} value={option.value} sx={{ flex: 1 }}>
                      {option.label}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1, pt: 0.5 }}>
                  High and Medium count as important in the matrix.
                </Typography>
              </Box>

              <DatePicker
                label="Due date"
                value={dueDate ? dateToDateTime(dueDate, zone) : null}
                onChange={(value: DateTime | null) => {
                  setDueDate(value ? value.toISODate() : null);
                  // A day without a time is an all-day task, so clearing the day
                  // clears the clock time with it.
                  if (!value) setDueTime(null);
                }}
                slotProps={{
                  textField: { fullWidth: true, size: 'small' },
                  field: {
                    clearable: true,
                    onClear: () => {
                      setDueDate(null);
                      setDueTime(null);
                    },
                  },
                }}
              />
              <TimePicker
                label="Due time"
                value={dueTime ? timeToDateTime(dueTime, zone) : null}
                disabled={!dueDate}
                onChange={(value: DateTime | null) => {
                  setDueTime(value ? value.toFormat('HH:mm') : null);
                }}
                slotProps={{
                  textField: { fullWidth: true, size: 'small' },
                  field: {
                    clearable: true,
                    onClear: () => setDueTime(null),
                  },
                }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1 }}>
                A task is urgent when it is due within three days or already overdue.
              </Typography>

              <Button
                fullWidth
                color="error"
                variant="contained"
                startIcon={<DeleteIcon />}
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                Delete task
              </Button>
            </Stack>
          </DialogContent>

          <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
            <Button
              variant="outlined"
              color="inherit"
              fullWidth
              disabled={busy}
              aria-busy={complete.isPending || undefined}
              startIcon={
                complete.isPending ? <CircularProgress size={16} color="inherit" /> : <CheckIcon />
              }
              onClick={() => void complete.run()}
            >
              Complete
            </Button>
            <Button
              variant="contained"
              fullWidth
              disabled={busy}
              aria-busy={save.isPending || undefined}
              startIcon={save.isPending ? <CircularProgress size={16} color="inherit" /> : undefined}
              onClick={() => void save.run()}
            >
              Save
            </Button>
          </DialogActions>
        </Dialog>
      </LocalizationProvider>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        aria-labelledby="matrix-delete-title"
      >
        <DialogTitle id="matrix-delete-title">Delete this task?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {`“${task?.title ?? 'This task'}” will be removed. This cannot be undone.`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button disabled={remove.isPending} onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
          {/*
           * The confirmation stays up — with a spinner — until the write settles,
           * then closes either way; the sheet itself closes only on success.
           */}
          <Button
            color="error"
            variant="contained"
            disabled={remove.isPending}
            startIcon={remove.isPending ? <CircularProgress size={16} color="inherit" /> : undefined}
            onClick={() => void remove.run().then(() => setConfirmDelete(false))}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
