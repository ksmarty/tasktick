'use client';

/**
 * The Today screen: everything that is due or overdue, in one chronological
 * scroll, with today's progress in the header.
 *
 * Data comes from the bootstrap agenda (already bucketed server-side), and every
 * checkbox tick publishes an optimistic agenda, so the row moves immediately and
 * the cache revalidates behind it.
 */
import { useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Plus, Search } from 'lucide-react';
import { CircleAlert } from 'lucide-react';
import { Button, EmptyState, NavBar, ProgressRing, Skeleton } from '@/components/ui';
import type { AgendaBuckets } from '@/lib/agenda-types';
import { formatFullDate } from '@/lib/dates';
import { useResource } from '@/lib/store';
import type { Task } from '@/lib/types';
import type { BootstrapPayload } from '@/lib/view-types';
import { EmptyTasks } from './EmptyTasks';
import { HeaderActionButton } from './HeaderActionButton';
import { QuickAddBar } from './QuickAddBar';
import { usePrimaryAction } from '@/lib/events';
import { TaskEditorSheet } from './TaskEditorSheet';
import { TaskListSection } from './TaskListSection';
import { removeFromAgenda, reorderAgendaSection, setAgendaStatus } from './optimistic';
import { buildTodaySections, countRemaining, todayProgress, type TaskSection } from './sections';
import { useTaskActions } from './useTaskActions';

export function TodayView() {
  const router = useRouter();
  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');
  const data = bootstrap.data;

  const zone = data?.settings.timezone ?? data?.user.timezone ?? 'utc';
  const timeFormat = data?.settings.timeFormat ?? '24h';
  const weekStartsOn = data?.settings.weekStartsOn ?? 1;
  const actions = useTaskActions(zone);

  const [quickAddOpen, setQuickAddOpen] = useState(false);

  // The shell's action button asks the mounted view for its primary create action.
  usePrimaryAction(openQuickAdd);
  const [editor, setEditor] = useState<{ open: boolean; task: Task | null }>({ open: false, task: null });

  /**
   * Opens quick add *inside* the gesture that asked for it — see `TasksView` for
   * why: iOS raises the keyboard only for a `focus()` in the task that handled
   * the tap, and the sheet's panel is a couple of renders away otherwise.
   */
  function openQuickAdd() {
    flushSync(() => setQuickAddOpen(true));
  }

  const sections = useMemo(() => buildTodaySections(data?.agenda), [data?.agenda]);
  const remaining = countRemaining(sections);
  const progress = todayProgress(data?.agenda);
  const listColors = useMemo(
    () => new Map((data?.lists ?? []).map((list) => [list.id, list.color])),
    [data?.lists],
  );

  /** Publishes a new agenda without mutating the resource's own object. */
  function mutateAgenda(update: (agenda: AgendaBuckets) => AgendaBuckets) {
    bootstrap.mutate((current) => (current ? { ...current, agenda: update(current.agenda) } : current));
  }

  /**
   * Runs a write with an optimistic agenda change, restoring the previous agenda
   * if the write fails — a failed request must never leave the row looking saved.
   */
  function optimistic(
    update: (agenda: AgendaBuckets) => AgendaBuckets,
    write: () => Promise<unknown>,
  ) {
    const snapshot = bootstrap.data;
    mutateAgenda(update);
    void write().then((result) => {
      if (result === undefined && snapshot) bootstrap.mutate(snapshot);
    });
  }

  function toggleTask(task: Task) {
    const undo = task.status === 'completed';
    optimistic(
      (agenda) => setAgendaStatus(agenda, task.id, undo ? 'todo' : 'completed', Date.now()),
      () => actions.complete(task, undo),
    );
  }

  const refresh = () => void bootstrap.refresh();

  function wontDoTask(task: Task) {
    optimistic(
      (agenda) => setAgendaStatus(agenda, task.id, 'wont_do', Date.now()),
      () => actions.patch(task.id, { status: 'wont_do' }),
    );
  }

  function deleteTask(task: Task) {
    optimistic(
      (agenda) => removeFromAgenda(agenda, new Set([task.id])),
      () => actions.remove(task.id),
    );
  }

  function reorderSection(section: TaskSection, orderedIds: string[]) {
    optimistic(
      (agenda) => reorderAgendaSection(agenda, section.id, orderedIds),
      () => actions.reorder(orderedIds),
    );
  }

  const loading = data === undefined && !bootstrap.error;

  return (
    <div>
      <NavBar
        largeTitle
        title="Today"
        trailing={
          <>
            {/*
             * Desktop only. The floating band — and with it the action button —
             * is hidden at `lg`, so this is the only way to create a task from a
             * desktop-sized window.
             */}
            <HeaderActionButton
              aria-label="Add a task"
              icon={Plus}
              className="hidden lg:inline-flex"
              onClick={openQuickAdd}
            />
            <HeaderActionButton
              aria-label="Search everything"
              icon={Search}
              onClick={() => router.push('/search')}
            />
          </>
        }
      />

      {data ? (
        <div className="px-2 pt-1 pb-2">
          {/*
           * The ring and the copy are one block, so they share one surface.
           * The fraction is absolutely positioned inside the ring: `ProgressRing`
           * only centres its *own* percentage, so a hand-passed label has to
           * place itself — otherwise it sits beside the ring and reads as if it
           * belonged to the date next to it.
           */}
          <div className="glass-card flex items-center gap-3.5 rounded-ios-lg px-4 py-3">
            <ProgressRing
              value={progress.value}
              size={54}
              strokeWidth={5}
              label={`${progress.completed} of ${progress.total} tasks done today`}
            >
              <span className="tnum absolute inset-0 flex items-center justify-center text-caption-1 font-semibold text-label">
                {progress.completed}/{progress.total}
              </span>
            </ProgressRing>
            <div className="min-w-0">
              <p className="truncate text-subhead font-semibold text-label">
                {remaining === 0 ? 'Nothing left for today' : `${remaining} task${remaining === 1 ? '' : 's'} left`}
              </p>
              <p className="truncate text-footnote text-secondary">
                {formatFullDate(Date.now(), { zone, timeFormat, weekStartsOn })}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="px-2 pt-2 pb-3">
          <Skeleton variant="rect" className="h-20 rounded-ios-lg" />
        </div>
      )}

      {!actions.online ? <p className="px-4 pb-2 text-footnote text-secondary">{actions.offlineNotice}</p> : null}

      {bootstrap.error && !data ? (
        <EmptyState
          icon={CircleAlert}
          title="Couldn't load today"
          description={bootstrap.error}
          action={
            <Button variant="tinted" onClick={refresh}>
              Try again
            </Button>
          }
        />
      ) : loading ? (
        <div className="space-y-6 px-2">
          <Skeleton variant="text" lines={4} />
          <Skeleton variant="text" lines={3} />
        </div>
      ) : sections.length === 0 ? (
        <EmptyTasks
          title="Today is clear"
          description="Nothing is due and nothing is overdue. Add something now, or enjoy the quiet."
          onAdd={openQuickAdd}
        />
      ) : (
        <div>
          {sections.map((section) => (
            <TaskListSection
              key={section.id}
              section={section}
              zone={zone}
              timeFormat={timeFormat}
              listColors={listColors}
              onToggle={toggleTask}
              onOpen={(task) => setEditor({ open: true, task })}
              onDelete={deleteTask}
              onWontDo={wontDoTask}
              onReorder={reorderSection}
              disabled={!actions.online}
            />
          ))}
        </div>
      )}

      <QuickAddBar open={quickAddOpen} onOpenChange={setQuickAddOpen} onCreated={refresh} />
      <TaskEditorSheet
        open={editor.open}
        task={editor.task}
        onSaved={refresh}
        onOpenChange={(open) => setEditor((current) => ({ ...current, open }))}
      />
    </div>
  );
}
