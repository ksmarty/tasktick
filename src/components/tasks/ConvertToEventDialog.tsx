'use client';

/**
 * "Convert to event": pick where the event should live, and the task moves there.
 *
 * This replaced a *Calendar* dropdown in the task editor, and the difference is
 * the whole point. The dropdown filed a task into a calendar and left it a task:
 * the calendar then drew it as a task, and every editor opened it as one, which
 * is not what "put this on my calendar" means. Here the choice is a *move* — the
 * record becomes an event in the calendar that is picked — so the two kinds
 * cannot be confused again by a field that looks like a preference.
 *
 * The list is `selectableCalendars` (writable and visible), not the calendars
 * that accept tasks: the destination of an event is an event calendar, and a task
 * is what is leaving. Two cases cannot become an event without losing something,
 * and both are stopped here rather than on the server so the reason is visible
 * next to the button: subtasks (the removal takes children with it) and no due
 * day (an event needs a start).
 */
import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/app/Toast';
import { api, errorMessage } from '@/lib/api-client';
import { affectsFor } from '@/lib/offline-rules';
import { invalidate } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { Calendar as CalendarRecord, Task } from '@/lib/types';
import { selectableCalendars } from '@/components/calendar/selectable';
import { TASK_WRITE_PREFIXES } from './useTaskActions';

/** What `POST /api/tasks/:id/convert` returns. */
interface ConversionResult {
  eventId: string;
  taskId: string;
  calendarId: string;
}

/** Creating an event reaches the same reads a task write does, plus the calendar. */
const CONVERSION_PREFIXES: string[] = [...TASK_WRITE_PREFIXES, ...affectsFor('POST', '/api/events')];

export function ConvertToEventDialog({
  open,
  onOpenChange,
  task,
  calendars,
  disabled = false,
  onConverted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: Task | null;
  calendars: readonly CalendarRecord[];
  disabled?: boolean;
  /** Fired with the new event's id, so the caller can refresh or open it. */
  onConverted?: (result: ConversionResult) => void;
}) {
  const { toast } = useToast();
  const choices = selectableCalendars(calendars);
  const [calendarId, setCalendarId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * The dialog opens on a sensible destination rather than on nothing: the task's
   * own calendar when it is writable (a task pulled from a VTODO collection
   * usually belongs where it already is), otherwise the first writable one.
   */
  useEffect(() => {
    if (!open) return;
    const current = task?.calendarId && choices.some((calendar) => calendar.id === task.calendarId);
    setCalendarId(current ? (task?.calendarId ?? '') : (choices[0]?.id ?? ''));
    setError(null);
    // `choices` is derived from the prop and re-created every render; the id list
    // is what actually decides the default, so depend on that instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id, task?.calendarId, calendars.length]);

  const subtasks = task?.subtasks?.length ?? 0;
  const hasDay = Boolean(task?.dueDate);
  const blocker =
    subtasks > 0
      ? `This task has ${subtasks} subtask${subtasks === 1 ? '' : 's'}. Converting it would delete them, so it cannot be converted.`
      : !hasDay
        ? 'Give the task a due date first: an event needs to start somewhere.'
        : null;

  const submit = async () => {
    if (!task || !calendarId || blocker) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<ConversionResult>(`/api/tasks/${task.id}/convert`, { calendarId });
      await invalidate(CONVERSION_PREFIXES);
      const destination = calendars.find((calendar) => calendar.id === calendarId)?.name ?? 'the calendar';
      toast({
        title: 'Converted to an event',
        description: `“${task.title}” now sits in ${destination}.`,
        variant: 'success',
      });
      onConverted?.(result);
      onOpenChange(false);
    } catch (failure) {
      /* Stay open: the reason belongs next to the button that caused it. */
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="gap-0 p-0">
        <div className="flex flex-col gap-stack p-card">
          <DialogTitle>Convert to event</DialogTitle>
          <DialogDescription>
            {`“${task?.title ?? ''}” becomes a calendar event. Its notes, link, due day, estimate, repeat and reminders come with it; its list, tags, priority and tracked time do not.`}
          </DialogDescription>

          {choices.length ? (
            <div role="radiogroup" aria-label="Calendar" className="flex flex-col gap-1">
              {choices.map((calendar) => {
                const selected = calendar.id === calendarId;
                return (
                  <Button
                    key={calendar.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    variant={selected ? 'secondary' : 'ghost'}
                    className={cn('min-h-12 w-full justify-start gap-3 px-3', selected && 'border border-input')}
                    onClick={() => setCalendarId(calendar.id)}
                  >
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: calendar.color }}
                    />
                    <span className="min-w-0 flex-1 truncate text-left">{calendar.name}</span>
                  </Button>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              There is no calendar this app can write to. Add one in Settings → Calendars first.
            </p>
          )}

          {blocker ? (
            <Alert role="status">
              <AlertDescription>{blocker}</AlertDescription>
            </Alert>
          ) : null}

          {error ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={disabled || busy || !task || !calendarId || Boolean(blocker)}
              aria-busy={busy || undefined}
              onClick={() => void submit()}
            >
              {busy ? 'Converting…' : 'Convert'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
