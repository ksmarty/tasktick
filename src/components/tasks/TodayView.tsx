'use client';

/**
 * The Today screen: everything that is due or overdue, in one chronological
 * scroll, with today's progress in the header.
 *
 * Data comes from the bootstrap agenda (already bucketed server-side), and every
 * checkbox tick publishes an optimistic agenda, so the row moves immediately and
 * the cache revalidates behind it.
 *
 * The progress ring is the one place a shadcn primitive does not fit: `Progress`
 * is a bar, and this is a ring with the fraction sitting inside it, so the ring is
 * drawn here as two SVG circles. `pathLength={100}` makes the circumference
 * exactly 100 units, so the arc is the percentage and the dash length is a
 * computed value — the case inline `style` is allowed for.
 */
import { useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useRouter } from 'next/navigation';
import { ExclamationCircledIcon } from '@svg-animated-icons/react/exclamation-circled';
import { MagnifyingGlassIcon } from '@svg-animated-icons/react/magnifying-glass';
import { PlusIcon } from '@svg-animated-icons/react/plus';
import type { AgendaBuckets } from '@/lib/agenda-types';
import { formatFullDate } from '@/lib/dates';
import { usePrimaryAction } from '@/lib/events';
import { useResource } from '@/lib/store';
import type { Task } from '@/lib/types';
import type { BootstrapPayload } from '@/lib/view-types';
import { useShellPane } from '@/components/app/ShellPane';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { LiquidGlassCard } from '@/components/godui/liquid-glass-card';
import { EmptyTasks } from './EmptyTasks';
import { HeaderActionButton } from './HeaderActionButton';
import { QuickAddBar } from './QuickAddBar';
import { TaskEditorSheet } from './TaskEditorSheet';
import { TaskListSection } from './TaskListSection';
import { removeFromAgenda, reorderAgendaSection, setAgendaStatus } from './optimistic';
import { taskAccentLookup } from './row-colors';
import { buildTodaySections, countRemaining, todayProgress, type TaskSection } from './sections';
import { GLASS_TINT } from './surface';
import { useTaskActions } from './useTaskActions';

export function TodayView() {
  const router = useRouter();
  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');
  const data = bootstrap.data;

  const zone = data?.settings.timezone ?? data?.user.timezone ?? 'utc';
  const timeFormat = data?.settings.timeFormat ?? '24h';
  const weekStartsOn = data?.settings.weekStartsOn ?? 1;
  const actions = useTaskActions(zone);

  // Resolves each row's list colour once, for the per-row colour strip.
  const lists = useMemo(() => data?.lists ?? [], [data?.lists]);
  const accentForTask = useMemo(() => taskAccentLookup(lists), [lists]);

  // This screen owns its own scroll: the header stays put while the list moves.
  // The shell hands the pane over as a fixed-height box; see `ShellPane`.
  useShellPane({ fullHeight: true });

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
  const ratio = progress.total === 0 ? 0 : Math.round(progress.value * 100);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="z-appbar shrink-0 border-b border-border bg-background pt-[env(safe-area-inset-top,0px)]">
        <div className="flex min-h-14 items-center gap-2 px-gutter">
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">Today</h1>
          <HeaderActionButton
            aria-label="Search everything"
            icon={MagnifyingGlassIcon}
            onClick={() => router.push('/search')}
          />
          {/*
           * Desktop only. The floating band — and with it the action button — is
           * hidden at `lg`, so this is the only way to create a task from a
           * desktop-sized window.
           */}
          <HeaderActionButton
            aria-label="Add a task"
            icon={PlusIcon}
            onClick={openQuickAdd}
            className="hidden lg:inline-flex"
          />
        </div>
      </header>

      {/*
       * The list owns the scroll now, not the shell's pane. It restates the
       * mobile tab-bar clearance the pane used to carry, or the last row sits
       * under the band; at `lg` the band is gone, so the padding is too.
       */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom)_+_5.25rem)] lg:pb-0">
      {data ? (
        <div className="px-gutter pt-2 pb-1">
          {/*
           * The ring and the copy are one block, so they share one surface —
           * the same GodUI glass panel the list sections use. The fraction is
           * absolutely positioned inside the ring, so it reads as the ring's own
           * label rather than as a datum beside it.
           */}
          {/*
           * The same surface as a list section: `sheen={0}` because the glass
           * card's edge sheen paints a second line inside its own border (see
           * `TaskListSection`), and the border is the one edge on the card.
           */}
          <LiquidGlassCard
            radius={16}
            strength={0}
            sheen={0}
            tint={GLASS_TINT}
            className="border-border shadow-sm"
          >
            <div className="flex items-center gap-4 p-card">
              <div
                className="relative grid size-14 shrink-0 place-items-center"
                role="progressbar"
                aria-valuenow={ratio}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${progress.completed} of ${progress.total} tasks done today`}
              >
                <svg viewBox="0 0 36 36" className="size-14 -rotate-90" aria-hidden>
                  <circle
                    cx="18"
                    cy="18"
                    r="15.9155"
                    fill="none"
                    strokeWidth="3"
                    className="stroke-muted"
                  />
                  <circle
                    cx="18"
                    cy="18"
                    r="15.9155"
                    fill="none"
                    strokeWidth="3"
                    strokeLinecap="round"
                    pathLength={100}
                    className="stroke-primary"
                    style={{ strokeDasharray: `${ratio} 100` }}
                  />
                </svg>
                <span className="absolute text-xs font-semibold tabular-nums">
                  {progress.completed}/{progress.total}
                </span>
              </div>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold">
                  {remaining === 0 ? 'Nothing left for today' : `${remaining} task${remaining === 1 ? '' : 's'} left`}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {formatFullDate(Date.now(), { zone, timeFormat, weekStartsOn })}
                </p>
              </div>
            </div>
          </LiquidGlassCard>
        </div>
      ) : (
        <div className="px-gutter pt-3 pb-2">
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      )}

      {!actions.online ? (
        <p className="px-gutter pb-2 text-xs text-muted-foreground">{actions.offlineNotice}</p>
      ) : null}

      {bootstrap.error && !data ? (
        <div className="flex flex-col items-center gap-3 px-gutter py-6 text-center">
          <ExclamationCircledIcon className="text-4xl text-muted-foreground" aria-hidden />
          <h2 className="text-base font-medium">Couldn&apos;t load today</h2>
          <p className="text-sm text-muted-foreground">{bootstrap.error}</p>
          <Button type="button" variant="outline" className="mt-1" onClick={refresh}>
            Try again
          </Button>
        </div>
      ) : loading ? (
        <div className="flex flex-col gap-2 px-gutter py-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-7 w-full" />
          ))}
        </div>
      ) : sections.length === 0 ? (
        <EmptyTasks
          title="Today is clear"
          description="Nothing is due and nothing is overdue. Add something now, or enjoy the quiet."
          onAdd={openQuickAdd}
        />
      ) : (
        <div className="flex flex-col gap-stack px-gutter py-3">
          {sections.map((section) => (
            <TaskListSection
              key={section.id}
              section={section}
              zone={zone}
              timeFormat={timeFormat}
              onToggle={toggleTask}
              onOpen={(task) => setEditor({ open: true, task })}
              listColorFor={accentForTask}
              onDelete={deleteTask}
              onWontDo={wontDoTask}
              onReorder={reorderSection}
              disabled={!actions.online}
            />
          ))}
        </div>
      )}
      </div>

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
