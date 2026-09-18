'use client';

/**
 * One collapsible group of task rows, with drag reordering.
 *
 * The section header is the card's first row: one card per section, starting with
 * `Pinned  4  ⌄` and followed by the rows, rather than a caption floating above a
 * separate card. Each card paints a stripe down its leading edge in the colour of
 * the list most of its rows belong to — Material had no equivalent of the iOS
 * grouped-list edge, so it is drawn explicitly, which is what makes a long scroll
 * scannable (see `edgeColorFor`).
 *
 * Material's `List`/`ListSubheader`/`Collapse` trio is replaced by the GodUI
 * `Accordion`, which already owns a spring height animation and rotating chevron —
 * so there is no hand-rolled grid-rows track, and a collapsed section is unmounted
 * at rest (which matters for `Completed`, which can hold hundreds of rows).
 *
 * ## The three places this file compensates for the vendored Accordion
 *
 * `components/godui/accordion.tsx` is upstream's file and is shared, so it is not
 * edited here; instead its own padding is neutralised, and the compensation is
 * stated rather than hidden:
 *
 *  - the panel owns `px-5 pb-4 pt-0`, so the row track pulls back with `-mx-5
 *    -mb-4` and every row then supplies its own `px-row`. That is what keeps the
 *    row inset coming from the layout token instead of from a vendored number.
 *  - the trigger owns `px-5`, so the header's own content pulls back with `-mx-1`
 *    (1.25rem − 0.25rem = 1rem) and lands on exactly the same `px-row` axis as the
 *    rows. A negative margin rather than an override, because `tailwind-merge`
 *    cannot be relied on to resolve a token class against a vendored one.
 *  - the panel paints `text-sm text-muted-foreground`, which the row track resets
 *    with an explicit `text-base text-foreground`.
 *
 * ## The coloured edge
 *
 * `border-l-4` rather than the old 3px: three is not on Tailwind's scale, and the
 * conventions are explicit that a size which is not on the scale is a size the
 * design should not want. The colour is per-section and therefore a CSS custom
 * property written inline (`--edge-color`), which is the one thing about the edge
 * that genuinely cannot be a class.
 *
 * ## Reordering
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
  type CSSProperties,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Accordion } from '@/components/godui/accordion';
import { accentHex } from '@/lib/colors';
import type { AccentColor, Task } from '@/lib/types';
import { cn } from '@/lib/utils';
import { canReorder, reorderIds, reorderableIds } from './optimistic';
import { TaskRow, type TaskRowDrag } from './TaskRow';
import type { TaskSection } from './sections';

interface DragState {
  id: string;
  overId: string | null;
  edge: 'before' | 'after';
}

interface LiftState extends DragState {
  startY: number;
  offset: number;
}

/**
 * The stripe colour for a section card.
 *
 * Overdue is about urgency rather than about a list, so it always paints the
 * theme's destructive colour. Every other section paints the list colour most of
 * its rows share: a section that mixes lists still has to show one stripe, and the
 * most common list is the one the section reads as. No known list colour falls
 * back to the theme primary.
 */
function edgeColorFor(section: TaskSection, listColors?: ReadonlyMap<string, AccentColor>): string {
  if (section.tone === 'danger') return 'var(--destructive)';

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

  return winner ? accentHex(winner) : 'var(--primary)';
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
    <Accordion
      type="single"
      collapsible
      // A section that starts collapsed is the one the caller marked as such —
      // "Completed" holds work the user has finished with, so it arrives closed.
      defaultValue={section.defaultCollapsed ? [] : [section.id]}
      className="border-l-4 border-l-[var(--edge-color)]"
      style={{ '--edge-color': edgeColorFor(section, listColors) } as CSSProperties}
      items={[
        {
          value: section.id,
          title: (
            <span className="-mx-1 flex min-w-0 flex-1 items-center gap-2">
              {/* The section title is the loudest thing on the line. */}
              <span
                className={cn('truncate text-sm font-semibold', danger ? 'text-destructive' : 'text-foreground')}
              >
                {section.title}
              </span>
              <span className="ml-auto flex shrink-0 items-center gap-2 text-xs tabular-nums">
                {section.tasks.length}
                <span className="sr-only">{`${section.tasks.length} task${section.tasks.length === 1 ? '' : 's'}`}</span>
              </span>
            </span>
          ),
          content: (
            <ul className="-mx-5 -mb-4 flex flex-col text-base text-foreground">
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
            </ul>
          ),
        },
      ]}
    />
  );
}
