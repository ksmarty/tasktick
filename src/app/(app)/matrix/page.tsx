'use client';

/**
 * The Eisenhower matrix.
 *
 * Every open task is classified with the same rule the server uses, and dragging
 * a card between quadrants is translated into the smallest PATCH that moves the
 * task: the importance axis edits `priority`, the urgency axis edits the due
 * date. Because an urgency change *is* a due-date change, the drop is explained
 * in a toast — a card must never silently reschedule something.
 *
 * GodUI owns the surfaces: the four quadrants are `SpotlightCard`s in a CSS grid,
 * the grip is a shadcn `Button`, and the rows are plain flex boxes. The
 * classification, the drop plan and the pointer drag are unchanged — this file is
 * still only presentation plus wiring.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { DragHandleDots1Icon } from '@svg-animated-icons/react/drag-handle-dots-1';
import { ExclamationCircledIcon } from '@svg-animated-icons/react/exclamation-circled';
import { ViewGridIcon } from '@svg-animated-icons/react/view-grid';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SpotlightCard } from '@/components/godui/spotlight-card';
import { useToast } from '@/components/app/Toast';
import { accentHex } from '@/lib/colors';
import { api, errorMessage } from '@/lib/api-client';
import { useResource } from '@/lib/store';
import { todayIn, relativeDayLabel } from '@/lib/dates';
import { cn } from '@/lib/utils';
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

/** How long a touch has to rest on a row before it starts dragging it. */
const LONG_PRESS_MS = 450;
/** Movement that cancels an armed long press — that was a scroll, not a hold. */
const LONG_PRESS_SLOP_PX = 10;

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

  const startDrag = useCallback(
    (task: Task) => {
      dragRef.current = { task };
      setDragId(task.id);
      setHover(quadrantOf(task, todayDate, zone));
    },
    [todayDate, zone],
  );

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
    <div className="flex flex-col gap-stack px-gutter pb-8">
      {/*
       * No back control: the matrix is a top-level destination reached from the
       * tab bar's "More" sheet and the sidebar's Tools, not from Tasks.
       *
       * The header is full-bleed despite the page gutter, hence the negative
       * margin pulling it back out again: a sticky bar that stopped at the
       * gutter would let the quadrant cards scroll through the strips beside it.
       */}
      <header className="sticky top-0 z-appbar -mx-gutter flex items-center gap-2 bg-background px-gutter pt-[calc(env(safe-area-inset-top,0px)+0.5rem)] pb-2">
        <h1 className="min-w-0 flex-1 truncate text-2xl font-medium">Priority matrix</h1>
        <Badge variant="secondary">{list.length} tasks</Badge>
      </header>

      <p className="text-sm text-muted-foreground">
        Urgent means due within three days or overdue; important means high or medium priority. Drag a task to
        reclassify it — on a touch screen, press and hold it first.
      </p>

      {loading ? (
        [0, 1, 2, 3].map((key) => <Skeleton key={key} className="h-28 rounded-xl" />)
      ) : tasks.error && list.length === 0 ? (
        <EmptyNotice icon={ExclamationCircledIcon} title="Could not load your tasks" description={tasks.error} />
      ) : list.length === 0 ? (
        <EmptyNotice
          icon={ViewGridIcon}
          title="Nothing to sort"
          description="Once you have open tasks they appear here, grouped by how urgent and how important they are."
        />
      ) : (
        <div className="grid grid-cols-1 gap-stack md:grid-cols-2">
          {QUADRANTS.map((quadrant) => {
            const items = buckets[quadrant.id];
            return (
              /*
               * `SpotlightCard` renders a div, so it is the card itself: the
               * drop target, the label and the height all live on it. `region`
               * is what the `<section>` it replaces already meant once it had an
               * accessible name, so the landmark survives the swap.
               */
              <SpotlightCard
                key={quadrant.id}
                role="region"
                data-quadrant={quadrant.id}
                aria-labelledby={`quadrant-${quadrant.id}`}
                className={cn(
                  'h-full',
                  // The quadrant under a live drag is outlined, not filled: the
                  // card is what is being dropped into, and a fill would hide
                  // the rows it already holds.
                  hover === quadrant.id && dragId ? 'ring-2 ring-primary' : null,
                )}
              >
                <header className="flex items-center gap-2 border-b border-border px-card py-3">
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-full"
                    // A quadrant's colour is data, not theme, so it is resolved
                    // to a hex value here — the one case the conventions allow.
                    style={{ backgroundColor: accentHex(quadrant.color) }}
                  />
                  <h2 id={`quadrant-${quadrant.id}`} className="min-w-0 flex-1 truncate text-base font-semibold">
                    {quadrant.title}
                  </h2>
                  {/* The strategy hint is advice, the count is data: neither
                      competes with the name of the quadrant. */}
                  <span className="shrink-0 text-xs text-muted-foreground">{quadrant.hint}</span>
                  <span
                    aria-label={`${items.length} tasks`}
                    className="shrink-0 text-xs text-muted-foreground tabular-nums"
                  >
                    {items.length}
                  </span>
                </header>

                {items.length === 0 ? (
                  <p className="px-row py-3 text-sm text-muted-foreground">Drop a task here.</p>
                ) : (
                  <ul className="flex flex-col">
                    {items.map((task) => (
                      <li key={task.id} className="border-b border-border last:border-b-0">
                        <TaskRow
                          task={task}
                          zone={zone}
                          today={todayDate}
                          dragging={dragId === task.id}
                          onOpen={() => setEditing(task)}
                          onStartDrag={() => startDrag(task)}
                          onMoveToQuadrant={(target) => void applyDrop(task, target)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </SpotlightCard>
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
  onStartDrag,
  onMoveToQuadrant,
}: {
  task: Task;
  zone: string;
  today: DateOnly;
  dragging: boolean;
  onOpen: () => void;
  onStartDrag: () => void;
  onMoveToQuadrant: (target: QuadrantId) => void;
}) {
  const current = quadrantOf(task, today, zone);
  const due = task.dueDate ?? null;
  const overdue = isUrgent(task, today, zone) && Boolean(due && due < today);
  const longPress = useLongPressDrag(onStartDrag);

  return (
    /*
     * `group/row` is named rather than plain `group`, because the spotlight card
     * above already is a `group`: an unnamed one would reveal every row's grip
     * as soon as the pointer entered the quadrant.
     */
    <div className={cn('group/row flex items-center gap-1 px-row py-0.5', dragging && 'opacity-60')}>
      <button
        type="button"
        onClick={onOpen}
        onClickCapture={longPress.onClickCapture}
        onContextMenu={(event) => {
          // A held touch must not raise the native text-selection callout.
          if (dragging) event.preventDefault();
        }}
        {...longPress.handlers}
        className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-md bg-transparent py-1 text-left text-inherit"
      >
        {/*
         * The title takes the row and the due date yields: the title's basis is
         * zero, so it absorbs every free pixel and only ellipsises when the text
         * is genuinely longer than the row, and the date is capped so a longer
         * label can never eat the title's width.
         */}
        <span className={cn('min-w-0 flex-1 truncate', overdue && 'text-destructive')}>{task.title}</span>
        {due ? (
          <span
            className={cn('max-w-24 shrink truncate text-xs', overdue ? 'text-destructive' : 'text-muted-foreground')}
          >
            {relativeDayLabel(due, zone)}
          </span>
        ) : null}
      </button>

      {/*
       * One drag affordance, for pointers only.
       *
       * A mouse cursor reveals the grip on hover; a touch screen has no hover
       * and a handle on every row is permanent noise, so touch reorders with a
       * long press on the row itself (see `useLongPressDrag`). It stays
       * keyboard-reachable wherever it is rendered.
       */}
      <div className="flex pointer-coarse:hidden">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Move ${task.title} to another quadrant`}
          aria-roledescription="sortable"
          onPointerDown={(event) => {
            event.preventDefault();
            onStartDrag();
          }}
          onKeyDown={(event) => {
            const key = event.key;
            if (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'ArrowLeft' && key !== 'ArrowRight') return;
            const target = neighbourQuadrant(current, key);
            if (!target) return;
            event.preventDefault();
            onMoveToQuadrant(target);
          }}
          className="size-11 touch-none opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100"
        >
          <DragHandleDots1Icon className="size-4 text-base" />
        </Button>
      </div>
    </div>
  );
}

/** The centred "nothing here" panel: a disc, a title and one sentence. */
function EmptyNotice({
  icon: Icon,
  title,
  description,
}: {
  icon: ComponentType<{ className?: string; disableHover?: boolean }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-6 text-center">
      <span
        aria-hidden
        className="flex size-14 items-center justify-center rounded-full bg-accent text-muted-foreground"
      >
        <Icon className="size-6 text-2xl" />
      </span>
      <h2 className="text-base font-medium">{title}</h2>
      <p className="max-w-72 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

/**
 * Touch reorder: press and hold a row to start dragging it.
 *
 * A pointer device gets the visible grip instead; a touch device has no hover to
 * reveal one. Any movement cancels the press, so a scroll never becomes a
 * reorder, and the click that follows a fired long press is swallowed so the
 * editor sheet does not open behind the drag.
 */
function useLongPressDrag(start: () => void) {
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }, []);

  useEffect(() => () => cancel(), [cancel]);

  const handlers = {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === 'mouse') return;
      cancel();
      fired.current = false;
      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = null;
        fired.current = true;
        start();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      const from = origin.current;
      if (!from || timer.current === null) return;
      if (Math.hypot(event.clientX - from.x, event.clientY - from.y) > LONG_PRESS_SLOP_PX) cancel();
    },
    onPointerUp: () => cancel(),
    onPointerCancel: () => cancel(),
  };

  return {
    handlers,
    onClickCapture: (event: ReactMouseEvent<HTMLElement>) => {
      if (!fired.current) return;
      fired.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
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
    const blockTouchScroll = (event: TouchEvent) => event.preventDefault();

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    // A touch reorder must not scroll the pane out from under the drop.
    window.addEventListener('touchmove', blockTouchScroll, { passive: false });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('touchmove', blockTouchScroll);
    };
  }, [active]);
}
