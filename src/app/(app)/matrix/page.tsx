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
 * Material owns the surfaces: a `Grid` of four `Paper`s, `Box`es for the rows and
 * a MUI `IconButton` for the drag grip. The classification, the drop plan and the
 * pointer drag are unchanged — this file is still only presentation plus wiring.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import GridViewIcon from '@mui/icons-material/GridView';
import ErrorOutlineOutlinedIcon from '@mui/icons-material/ErrorOutlineOutlined';
import type { SvgIconProps } from '@mui/material/SvgIcon';
import { useToast } from '@/components/app/Toast';
import { accentHex } from '@/lib/colors';
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
    <Box sx={{ pb: 4 }}>
      {/*
       * No back control: the matrix is a top-level destination reached from the
       * tab bar's "More" sheet and the sidebar's Tools, not from Tasks.
       */}
      <Box
        component="header"
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 'appBar',
          bgcolor: 'background.default',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 2,
          pt: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)',
          pb: 0.5,
        }}
      >
        <Typography variant="h5" component="h1" sx={{ minWidth: 0, flex: 1, fontWeight: 500 }}>
          Priority matrix
        </Typography>
        <Chip label={`${list.length} tasks`} size="small" />
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ px: 2, pb: 1.5 }}>
        Urgent means due within three days or overdue; important means high or medium priority. Drag a task to
        reclassify it — on a touch screen, press and hold it first.
      </Typography>

      {loading ? (
        <Stack spacing={1.5} sx={{ px: 2 }}>
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} variant="rounded" height={112} />
          ))}
        </Stack>
      ) : tasks.error && list.length === 0 ? (
        <EmptyNotice icon={ErrorOutlineOutlinedIcon} title="Could not load your tasks" description={tasks.error} />
      ) : list.length === 0 ? (
        <EmptyNotice
          icon={GridViewIcon}
          title="Nothing to sort"
          description="Once you have open tasks they appear here, grouped by how urgent and how important they are."
        />
      ) : (
        <Grid container spacing={2} sx={{ px: 2 }}>
          {QUADRANTS.map((quadrant) => {
            const items = buckets[quadrant.id];
            return (
              <Grid key={quadrant.id} size={{ xs: 12, md: 6 }}>
                <Paper
                  component="section"
                  variant="outlined"
                  data-quadrant={quadrant.id}
                  aria-labelledby={`quadrant-${quadrant.id}`}
                  sx={{
                    height: '100%',
                    // The quadrant under a live drag is outlined, not filled: the
                    // card is what is being dropped into, and a fill would hide
                    // the rows it already holds.
                    ...(hover === quadrant.id && dragId
                      ? { borderColor: 'primary.main', borderWidth: 2 }
                      : {}),
                  }}
                >
                  <Box
                    component="header"
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      px: 2,
                      py: 1.25,
                      borderBottom: 1,
                      borderColor: 'divider',
                    }}
                  >
                    <Box
                      aria-hidden
                      sx={{
                        width: 10,
                        height: 10,
                        flexShrink: 0,
                        borderRadius: '50%',
                        bgcolor: accentHex(quadrant.color),
                      }}
                    />
                    <Typography
                      component="h2"
                      id={`quadrant-${quadrant.id}`}
                      variant="subtitle1"
                      noWrap
                      sx={{ minWidth: 0, flex: 1, fontWeight: 600 }}
                    >
                      {quadrant.title}
                    </Typography>
                    {/* The strategy hint is advice, the count is data: neither
                        competes with the name of the quadrant. */}
                    <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                      {quadrant.hint}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      aria-label={`${items.length} tasks`}
                      sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}
                    >
                      {items.length}
                    </Typography>
                  </Box>

                  {items.length === 0 ? (
                    <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1.5 }}>
                      Drop a task here.
                    </Typography>
                  ) : (
                    <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
                      {items.map((task) => (
                        <Box
                          component="li"
                          key={task.id}
                          sx={{
                            borderBottom: 1,
                            borderColor: 'divider',
                            '&:last-of-type': { borderBottom: 0 },
                          }}
                        >
                          <TaskRow
                            task={task}
                            zone={zone}
                            today={todayDate}
                            dragging={dragId === task.id}
                            onOpen={() => setEditing(task)}
                            onStartDrag={() => startDrag(task)}
                            onMoveToQuadrant={(target) => void applyDrop(task, target)}
                          />
                        </Box>
                      ))}
                    </Box>
                  )}
                </Paper>
              </Grid>
            );
          })}
        </Grid>
      )}

      <MatrixTaskSheet
        task={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        zone={zone}
        onChanged={() => void tasks.refresh()}
      />
    </Box>
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
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.25,
        py: 0.25,
        pl: 1,
        pr: 0.5,
        ...(dragging ? { opacity: 0.6 } : {}),
        // The grip below reveals itself for a hovering pointer.
        '&:hover .MuiIconButton-root': { opacity: 1 },
      }}
    >
      <Box
        component="button"
        type="button"
        onClick={onOpen}
        onClickCapture={longPress.onClickCapture}
        onContextMenu={(event) => {
          // A held touch must not raise the native text-selection callout.
          if (dragging) event.preventDefault();
        }}
        {...longPress.handlers}
        sx={{
          display: 'flex',
          minWidth: 0,
          minHeight: 44,
          flex: 1,
          alignItems: 'center',
          gap: 0.75,
          border: 0,
          borderRadius: 1,
          bgcolor: 'transparent',
          px: 1,
          py: 0.5,
          color: 'inherit',
          font: 'inherit',
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        {/*
         * The title takes the row and the due date yields: the title's basis is
         * zero, so it absorbs every free pixel and only ellipsises when the text
         * is genuinely longer than the row, and the date is capped so a longer
         * label can never eat the title's width.
         */}
        <Typography
          component="span"
          variant="body1"
          noWrap
          sx={{ minWidth: 0, flex: 1, color: overdue ? 'error.main' : 'text.primary' }}
        >
          {task.title}
        </Typography>
        {due ? (
          <Typography
            component="span"
            variant="caption"
            noWrap
            sx={{ minWidth: 0, maxWidth: 96, flexShrink: 1, color: overdue ? 'error.main' : 'text.secondary' }}
          >
            {relativeDayLabel(due, zone)}
          </Typography>
        ) : null}
      </Box>

      {/*
       * One drag affordance, for pointers only.
       *
       * A mouse cursor reveals the grip on hover; a touch screen has no hover
       * and a handle on every row is permanent noise, so touch reorders with a
       * long press on the row itself (see `useLongPressDrag`). It stays
       * keyboard-reachable wherever it is rendered.
       */}
      <Box sx={{ display: 'flex', '@media (pointer: coarse)': { display: 'none' } }}>
        <IconButton
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
          sx={{
            width: 44,
            height: 44,
            flexShrink: 0,
            borderRadius: 1,
            color: 'text.disabled',
            touchAction: 'none',
            opacity: 0,
            transition: 'opacity 150ms',
            '&:focus-visible': { opacity: 1 },
          }}
        >
          <DragIndicatorIcon sx={{ fontSize: 16 }} aria-hidden />
        </IconButton>
      </Box>
    </Box>
  );
}

/** The centred "nothing here" panel: a disc, a title and one sentence. */
function EmptyNotice({
  icon: Icon,
  title,
  description,
}: {
  icon: ComponentType<SvgIconProps>;
  title: string;
  description: string;
}) {
  return (
    <Stack spacing={1} sx={{ alignItems: 'center', px: 6, py: 6, textAlign: 'center' }}>
      <Box
        aria-hidden
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 56,
          height: 56,
          mb: 1,
          borderRadius: '50%',
          bgcolor: 'action.hover',
          color: 'text.secondary',
        }}
      >
        <Icon />
      </Box>
      <Typography variant="subtitle1" component="h2">
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 288 }}>
        {description}
      </Typography>
    </Stack>
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
