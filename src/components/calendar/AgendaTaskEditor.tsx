'use client';

/**
 * Opens the *tasks screen's own* editor for a task tapped in the calendar.
 *
 * The calendar API buckets items by day (`GET /api/calendar/items`) and sends a
 * deliberately thin `CalendarItem`: no notes, tags, reminders, subtasks or
 * recurrence. `TaskEditorSheet` needs the full record, so this wrapper performs
 * the one read that fills the gap — the same `GET /api/tasks/:id` the tasks
 * screen keeps in its store — and only then hands the task to the editor.
 *
 * Until that read lands the sheet shows a loading body rather than a
 * `Task`-shaped guess that would look half-populated; a failed read shows the
 * error in an `aria-live` alert instead of an empty form. The wrapper stays
 * mounted while the sheet closes, so its debounced close-flush behaves exactly
 * as it does on the tasks screen; the editor's own effect resets the draft when
 * the id changes.
 *
 * A cached copy is shown immediately and then re-read on every open (and after
 * every write). Task writes invalidate `/api/tasks/:id` without any mounted
 * reader forcing a refetch, so without this a reopened editor would show the
 * stale copy and, after a successful save cleared the draft, the field would
 * snap back to its pre-edit value.
 *
 * Kept out of `TaskEditorSheet` itself so the tasks feature keeps owning its
 * editor and this screen keeps owning the fetch+fallback it needs.
 */
import { useCallback, useEffect, useRef } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { TaskEditorSheet } from '@/components/tasks/TaskEditorSheet';
import { useResource } from '@/lib/store';
import type { Task } from '@/lib/types';

export interface AgendaTaskEditorProps {
  /** The task to edit; `null` while the sheet has never been opened. */
  taskId: string | null;
  /** Whether the sheet is showing. Kept separate so the editor can flush on close. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a write lands, so the calendar can refetch its items. */
  onSaved?: () => void;
}

export function AgendaTaskEditor({ taskId, open, onOpenChange, onSaved }: AgendaTaskEditorProps) {
  const resource = useResource<Task>(taskId ? `/api/tasks/${taskId}` : null, undefined, {
    // A cached copy may paint instantly; the effects below force a re-read so the
    // editor never keeps a stale record.
    staleAfterMs: 0,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  // `refresh` is a fresh closure each render; read it through a ref so the
  // effects below do not depend on its identity.
  const refreshRef = useRef(resource.refresh);
  refreshRef.current = resource.refresh;
  const hasDataRef = useRef(false);
  hasDataRef.current = resource.data !== undefined;

  // A re-open may be showing a cached copy: re-read it. The first open is left to
  // the hook's own mount effect, so it is not fetched twice.
  useEffect(() => {
    if (open && taskId && hasDataRef.current) void refreshRef.current();
  }, [open, taskId]);

  const handleSaved = useCallback(() => {
    void refreshRef.current();
    onSaved?.();
  }, [onSaved]);

  if (!taskId) return null;

  if (resource.data) {
    return (
      <TaskEditorSheet
        open={open}
        task={resource.data}
        onOpenChange={onOpenChange}
        onSaved={handleSaved}
      />
    );
  }

  // No task yet: show a loading/error body in the sheet's own dialog shape so
  // opening never flashes an empty editor.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>Task</DialogTitle>
        <DialogDescription className="sr-only">
          {resource.error ? 'The task could not be loaded.' : 'Loading the task…'}
        </DialogDescription>
        {resource.error ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{resource.error}</AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-col gap-stack py-2" aria-busy>
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
