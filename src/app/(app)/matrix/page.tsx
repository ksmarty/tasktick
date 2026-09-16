'use client';

/**
 * The Eisenhower matrix.
 *
 * Every open task is classified with the same rule the server uses, and dragging
 * a card between quadrants is translated into the smallest PATCH that moves the
 * task: the importance axis edits `priority`, the urgency axis edits the due
 * date. Because an urgency change *is* a due-date change, the drop is explained
 * in a toast — a card must never silently reschedule something.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Grid2x2, GripVertical } from 'lucide-react';
import { Badge, EmptyState, NavBar, Skeleton, useToast } from '@/components/ui';import { accentVar } from '@/lib/colors';
import { cn } from '@/lib/cn';
import { api, errorMessage } from '@/lib/api-client';
import { useResource } from '@/lib/store';
import { todayIn, relativeDayLabel } from '@/lib/dates';
import { MatrixTaskSheet } from './MatrixTaskSheet';
import {
  QUADRANTS,
  applyDropLocally,
  dropMessage,
  groupByQuadrant,
  isUrgent,
  neighbourQuadrant,
  planDrop,
  quadrantOf,
  type QuadrantId,
} from './quadrants';
import type { BootstrapPayload } from '@/lib/view-types';
import type { DateOnly, Task } from '@/lib/types';
import type { PointerEvent as ReactPointerEvent } from 'react';

export default function MatrixPage() {
  const { toast } = useToast();

  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');
  const settings = bootstrap.data?.settings;
  const zone = settings?.timezone ?? 'utc';
  const today = useMemo(() => (settings ? todayIn(zone) : null), [settings, zone]);

  // No dueWindow: the matrix has to see every open task, including undated ones.
  // The limit matches the server's own `buildMatrix`, so the two agree on what
  // "everything" means.
  const tasks = useResource<Task[]>('/api/tasks', { limit: 2000 }, { enabled: Boolean(today) });

  const [dragId, setDragId] = useState<string | null>(null);
  const [hover, setHover] = useState<QuadrantId | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);

  const list = tasks.data ?? [];
  const todayDate = today ?? todayIn(zone);
  const buckets = useMemo(() => groupByQuadrant(list, todayDate, zone), [list, todayDate, zone]);
  const byId = useMemo(() => new Map(list.map((task) => [task.id, task])), [list]);

  /* ---------------------------------------------------------------------- */
  /* the drop                                                               */
  /* ---------------------------------------------------------------------- */

  const applyDrop = useCallback(
    async (task: Task, target: QuadrantId) => {
      const drop = planDrop(task, target, todayDate, zone);
      if (drop.changes.length === 0) {
        toast({ title: dropMessage(task, drop) });
        return;
      }

      const snapshot = tasks.data;
      tasks.mutate((current) =>
        current?.map((item) => (item.id === task.id ? applyDropLocally(item, drop.patch, zone) : item)),
      );

      try {
        await api.patch<Task>(`/api/tasks/${task.id}`, drop.patch);
        toast({ title: dropMessage(task, drop), description: 'An urgency change is a change to the due date.' });
        void tasks.refresh();
      } catch (error) {
        tasks.mutate(() => snapshot);
        toast({ title: 'Could not move the task', description: errorMessage(error), variant: 'error' });
      }
    },
    [tasks, todayDate, toast, zone],
  );

  /* ---------------------------------------------------------------------- */
  /* pointer drag                                                           */
  /* ---------------------------------------------------------------------- */

  const dragRef = useRef<{ task: Task } | null>(null);

  function startDrag(task: Task, event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    dragRef.current = { task };
    setDragId(task.id);
    setHover(quadrantOf(task, todayDate, zone));
  }

  const onPointerMove = useCallback((event: PointerEvent) => {
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const quadrant = target instanceof Element ? target.closest('[data-quadrant]') : null;
    const id = quadrant instanceof HTMLElement ? (quadrant.dataset.quadrant as QuadrantId | undefined) : undefined;
    setHover(id ?? null);
  }, []);

  const onPointerUp = useCallback(
    (event: PointerEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      setDragId(null);
      if (!drag) return;

      const target = document.elementFromPoint(event.clientX, event.clientY);
      const quadrant = target instanceof Element ? target.closest('[data-quadrant]') : null;
      const id = quadrant instanceof HTMLElement ? (quadrant.dataset.quadrant as QuadrantId | undefined) : undefined;
      setHover(null);
      if (!id) return;
      void applyDrop(drag.task, id);
    },
    [applyDrop],
  );

  const cancelDrag = useCallback(() => {
    dragRef.current = null;
    setDragId(null);
    setHover(null);
  }, []);

  useDragListeners(Boolean(dragId), onPointerMove, onPointerUp, cancelDrag);

  const loading = !today || tasks.isInitialLoading;

  return (
    <div className="min-h-dvh pb-8">
      <NavBar
        title="Priority matrix"
        largeTitle
        back
        backHref="/tasks"
        backLabel="Tasks"
        trailing={<Badge value={list.length} label={`${list.length} tasks`} />}
      />

      <p className="px-4 pb-3 text-footnote text-secondary">
        Urgent means due within three days or overdue. Important means high or medium priority. Drag a task — or use the
        handle&apos;s arrow keys — to reclassify it.
      </p>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} variant="rect" className="mx-4 h-28" />
          ))}
        </div>
      ) : tasks.error && list.length === 0 ? (
        <EmptyState icon={Grid2x2} title="Could not load your tasks" description={tasks.error} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={Grid2x2}
          title="Nothing to sort"
          description="Once you have open tasks they appear here, grouped by how urgent and how important they are."
        />
      ) : (
        <div className="space-y-3">
          {QUADRANTS.map((quadrant) => {
            const items = buckets[quadrant.id];
            return (
              <section
                key={quadrant.id}
                data-quadrant={quadrant.id}
                aria-labelledby={`quadrant-${quadrant.id}`}
                className={cn(
                  'grouped mx-4 transition-shadow',
                  hover === quadrant.id && dragId ? 'ring-2 ring-tint' : undefined,
                )}
              >
                <header className="hairline-b flex items-center gap-2 px-4 py-2.5">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: accentVar(quadrant.color) }}
                    aria-hidden
                  />
                  <h2 id={`quadrant-${quadrant.id}`} className="min-w-0 flex-1 truncate text-subhead font-semibold text-label">
                    {quadrant.title}
                  </h2>
                  <span className="shrink-0 text-caption-1 text-secondary">{quadrant.hint}</span>
                  <Badge value={items.length} label={`${items.length} tasks`} />
                </header>

                {items.length === 0 ? (
                  <p className="px-4 py-3 text-footnote text-tertiary">Drop a task here.</p>
                ) : (
                  <ul>
                    {items.map((task) => (
                      <li key={task.id} className="hairline-b last:border-b-0">
                        <TaskRow
                          task={task}
                          zone={zone}
                          today={todayDate}
                          dragging={dragId === task.id}
                          onOpen={() => setEditing(task)}
                          onGripPointerDown={(event) => startDrag(task, event)}
                          onMoveToQuadrant={(target) => void applyDrop(task, target)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      <MatrixTaskSheet
        task={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        zone={zone}
        onChanged={() => void tasks.refresh()}
      />
    </div>
  );
}

function TaskRow({
  task,
  zone,
  today,
  dragging,
  onOpen,
  onGripPointerDown,
  onMoveToQuadrant,
}: {
  task: Task;
  zone: string;
  today: DateOnly;
  dragging: boolean;
  onOpen: () => void;
  onGripPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onMoveToQuadrant: (target: QuadrantId) => void;
}) {
  const current = quadrantOf(task, today, zone);
  const due = task.dueDate ?? null;
  const overdue = isUrgent(task, today, zone) && Boolean(due && due < today);

  return (
    <div className={cn('flex items-center gap-2 px-2 py-1', dragging && 'opacity-60')}>
      <button
        type="button"
        onClick={onOpen}
        className="pressable-row flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-ios px-2 text-left"
      >
        <span className={cn('min-w-0 flex-1 truncate text-body', overdue ? 'text-danger' : 'text-label')}>{task.title}</span>
        {due ? (
          <span className={cn('shrink-0 text-footnote', overdue ? 'text-danger' : 'text-secondary')}>
            {relativeDayLabel(due, zone)}
          </span>
        ) : null}
      </button>

      <button
        type="button"
        aria-label={`Move ${task.title} to another quadrant`}
        aria-roledescription="sortable"
        onPointerDown={onGripPointerDown}
        onKeyDown={(event) => {
          const key = event.key;
          if (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'ArrowLeft' && key !== 'ArrowRight') return;
          const target = neighbourQuadrant(current, key);
          if (!target) return;
          event.preventDefault();
          onMoveToQuadrant(target);
        }}
        className="flex size-11 shrink-0 touch-none items-center justify-center rounded-ios text-tertiary pressable"
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/** Attaches the window-level pointer listeners only while a drag is active. */
function useDragListeners(
  active: boolean,
  onMove: (event: PointerEvent) => void,
  onUp: (event: PointerEvent) => void,
  onCancel: () => void,
) {
  const moveRef = useRef(onMove);
  moveRef.current = onMove;
  const upRef = useRef(onUp);
  upRef.current = onUp;
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    if (!active) return undefined;

    const move = (event: PointerEvent) => moveRef.current(event);
    const up = (event: PointerEvent) => upRef.current(event);
    const cancel = () => cancelRef.current();

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
  }, [active]);
}
