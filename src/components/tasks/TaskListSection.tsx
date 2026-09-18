'use client';

/**
 * One collapsible group of task rows, with drag reordering.
 *
 * The section header is the card's first row: one card per section, starting
 * with `Pinned  4  ⌄` and followed by the rows, rather than a caption floating
 * above a separate card. Each card also paints a stripe down its leading edge in
 * the colour of the list most of its rows belong to — Material has no equivalent
 * of the iOS grouped-list edge, so it is drawn explicitly with `borderLeft`,
 * which is what makes a long scroll scannable (see `edgeColorFor`).
 *
 * The header is a MUI `ListSubheader`; the rows live in a MUI `Collapse`, which
 * owns the height animation, so no hand-rolled grid-rows transition is needed.
 *
 * Reordering is deliberately browser-native on a desktop pointer (HTML5
 * drag-and-drop, with a real drop indicator) and pointer-driven on touch (press
 * and hold to lift the row so it follows the finger, with a shadow). Both paths
 * finish in the same place: the full ordered id list for the section is handed to
 * `onReorder`, which POSTs it to `/api/tasks/reorder`.
 */
import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import Box from '@mui/material/Box';
import Collapse from '@mui/material/Collapse';
import List from '@mui/material/List';
import ListSubheader from '@mui/material/ListSubheader';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { accentHex } from '@/lib/colors';
import type { AccentColor, Task } from '@/lib/types';
import { canReorder, reorderIds, reorderableIds } from './optimistic';
import { TaskRow, type TaskRowDrag } from './TaskRow';
import type { TaskSection } from './sections';

interface DragState {
  id: string;
  overId: string | null;
  edge: 'before' | 'after';
}

/** The collapse/expand transition, in ms. */
const COLLAPSE_MS = 300;

interface LiftState extends DragState {
  startY: number;
  offset: number;
}

/** A screen-reader-only mark, without pulling in a helper package. */
const SR_ONLY = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;

/**
 * The stripe colour for a section card.
 *
 * Overdue is about urgency rather than about a list, so it always paints the
 * danger colour. Every other section paints the list colour most of its rows
 * share: a section that mixes lists still has to show one stripe, and the most
 * common list is the one the section reads as. No known list colour falls back
 * to the theme primary.
 */
function edgeColorFor(section: TaskSection, listColors?: ReadonlyMap<string, AccentColor>): string {
  if (section.tone === 'danger') return 'error.main';

  const counts = new Map<AccentColor, number>();
  for (const task of section.tasks) {
    const color = task.listId ? listColors?.get(task.listId) : undefined;
    if (color) counts.set(color, (counts.get(color) ?? 0) + 1);
  }

  let winner: AccentColor | undefined;
  let winnerCount = 0;
  for (const [color, count] of counts) {
    if (count > winnerCount) {
      winner = color;
      winnerCount = count;
    }
  }

  return winner ? accentHex(winner) : 'primary.main';
}

export interface TaskListSectionProps {
  section: TaskSection;
  zone: string;
  timeFormat: '12h' | '24h';
  /** `listId -> colour`, which sets each card's leading-edge stripe. */
  listColors?: ReadonlyMap<string, AccentColor>;
  onToggle: (task: Task) => void;
  onOpen: (task: Task) => void;
  onDelete?: (task: Task) => void;
  onWontDo?: (task: Task) => void;
  /** Publishes a new manual order for this section. */
  onReorder?: (section: TaskSection, orderedIds: string[]) => void;
  selectionMode?: boolean;
  selectedIds?: ReadonlySet<string>;
  onSelect?: (task: Task) => void;
  disabled?: boolean;
}

export function TaskListSection({
  section,
  zone,
  timeFormat,
  listColors,
  onToggle,
  onOpen,
  onDelete,
  onWontDo,
  onReorder,
  selectionMode = false,
  selectedIds,
  onSelect,
  disabled = false,
}: TaskListSectionProps) {
  const [collapsed, setCollapsed] = useState(section.defaultCollapsed);
  const [htmlDrag, setHtmlDrag] = useState<DragState | null>(null);
  const [lift, setLift] = useState<LiftState | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  const reorderable = Boolean(onReorder) && section.reorderable && !selectionMode && !disabled;

  // While a row is lifted, the browser must not scroll the list under the
  // finger. `touchmove` is only cancelable from a non-passive listener, and only
  // during the lift — so ordinary scrolling keeps working.
  useEffect(() => {
    if (!lift) return;
    const stop = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault();
    };
    document.addEventListener('touchmove', stop, { passive: false });
    return () => document.removeEventListener('touchmove', stop);
  }, [lift]);

  /** The row the pointer is currently over, and which side of it. */
  function resolveTarget(clientY: number): { overId: string; edge: 'before' | 'after' } | null {
    const ids = reorderableIds(section.tasks);
    let lastTarget: { overId: string; edge: 'before' | 'after' } | null = null;

    for (const id of ids) {
      const node = rowRefs.current.get(id);
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      const result = { overId: id, edge: clientY < rect.top + rect.height / 2 ? ('before' as const) : ('after' as const) };
      if (clientY < rect.top + rect.height / 2) return result;
      lastTarget = result;
    }

    return lastTarget;
  }

  function commit(draggedId: string, overId: string, edge: 'before' | 'after') {
    if (!onReorder) return;
    const ids = reorderableIds(section.tasks);
    const next = reorderIds(ids, draggedId, overId, edge);
    if (next.join('\u0000') === ids.join('\u0000')) return;
    onReorder(section, next);
  }

  function dragPropsFor(task: Task): TaskRowDrag | null {
    if (!reorderable || !canReorder(task)) return null;

    return {
      draggable: true,
      isLifted: lift?.id === task.id,
      liftOffset: lift?.id === task.id ? lift.offset : 0,
      dropEdge:
        (htmlDrag?.overId ?? lift?.overId) === task.id ? (htmlDrag?.edge ?? lift?.edge ?? null) : null,
      onDragStart: (event: DragEvent<HTMLElement>) => {
        event.dataTransfer.setData('text/plain', task.id);
        event.dataTransfer.effectAllowed = 'move';
        setHtmlDrag({ id: task.id, overId: task.id, edge: 'before' });
      },
      onDragEnd: () => setHtmlDrag(null),
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!htmlDrag) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const target = resolveTarget(event.clientY);
        if (!target) return;
        setHtmlDrag((current) =>
          current ? { ...current, overId: target.overId, edge: target.edge } : current,
        );
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        const current = htmlDrag;
        setHtmlDrag(null);
        if (!current?.overId) return;
        commit(current.id, current.overId, current.edge);
      },
      onLiftStart: (event: ReactPointerEvent<HTMLElement>) => {
        setLift({ id: task.id, overId: task.id, edge: 'before', startY: event.clientY, offset: 0 });
      },
      onLiftMove: (event: ReactPointerEvent<HTMLElement>) => {
        setLift((current) => {
          if (!current) return current;
          const target = resolveTarget(event.clientY);
          return {
            ...current,
            offset: event.clientY - current.startY,
            overId: target?.overId ?? current.overId,
            edge: target?.edge ?? current.edge,
          };
        });
      },
      onLiftEnd: () => {
        const current = lift;
        setLift(null);
        if (!current?.overId) return;
        commit(current.id, current.overId, current.edge);
      },
    };
  }

  const danger = section.tone === 'danger';

  return (
    <Box sx={{ mx: 2, pt: 1.5, '&:first-of-type': { pt: 0.5 } }}>
      {/*
       * One card per section. The 3px stripe is the deliberate iOS-style edge —
       * `overflow: hidden` keeps a revealed swipe action inside the rounded
       * corners.
       */}
      <Paper
        variant="outlined"
        sx={{
          borderRadius: 2,
          overflow: 'hidden',
          borderLeft: '3px solid',
          borderLeftColor: edgeColorFor(section, listColors),
        }}
      >
        <List
          component="div"
          disablePadding
          subheader={
            <ListSubheader
              component="div"
              disableSticky
              sx={{ p: 0, bgcolor: 'transparent', lineHeight: 'normal' }}
            >
              <Box
                component="button"
                type="button"
                onClick={() => setCollapsed((value) => !value)}
                aria-expanded={!collapsed}
                aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${section.title}`}
                sx={{
                  display: 'flex',
                  width: '100%',
                  minHeight: 44,
                  alignItems: 'center',
                  gap: 1,
                  px: 1.5,
                  border: 0,
                  bgcolor: 'transparent',
                  cursor: 'pointer',
                  font: 'inherit',
                  color: 'inherit',
                  textAlign: 'left',
                }}
              >
                {/* The section title is the loudest thing on the line. */}
                <Typography
                  component="span"
                  variant="subtitle2"
                  sx={{ fontWeight: 600, color: danger ? 'error.main' : 'text.primary' }}
                >
                  {section.title}
                </Typography>
                <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.75, color: 'text.secondary' }}>
                  <Typography component="span" variant="caption" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
                    {section.tasks.length}
                  </Typography>
                  <Box component="span" sx={SR_ONLY}>
                    {`${section.tasks.length} task${section.tasks.length === 1 ? '' : 's'}`}
                  </Box>
                  <ExpandMoreIcon
                    aria-hidden
                    sx={{
                      fontSize: 14,
                      transition: 'transform 200ms cubic-bezier(0.32, 0.72, 0, 1)',
                      transform: collapsed ? 'rotate(-90deg)' : 'none',
                    }}
                  />
                </Box>
              </Box>
            </ListSubheader>
          }
        >
          {/*
           * The rows live in a MUI `Collapse`, which owns the height animation.
           * `unmountOnExit` keeps a collapsed section — the completed one can hold
           * hundreds of rows — out of the DOM at rest, exactly as the old
           * grid-rows track did.
           */}
          <Collapse in={!collapsed} timeout={COLLAPSE_MS} mountOnEnter unmountOnExit>
            <List disablePadding>
              {section.tasks.map((task, index) => (
                <TaskRow
                  key={task.id}
                  ref={(node) => {
                    if (node) rowRefs.current.set(task.id, node);
                    else rowRefs.current.delete(task.id);
                  }}
                  task={task}
                  zone={zone}
                  timeFormat={timeFormat}
                  onToggle={onToggle}
                  onOpen={onOpen}
                  onDelete={onDelete}
                  onWontDo={onWontDo}
                  disabled={disabled}
                  selectionMode={selectionMode}
                  selected={selectedIds?.has(task.id) ?? false}
                  onSelect={onSelect}
                  drag={dragPropsFor(task)}
                  first={index === 0}
                  last={index === section.tasks.length - 1}
                />
              ))}
            </List>
          </Collapse>
        </List>
      </Paper>
    </Box>
  );
}
