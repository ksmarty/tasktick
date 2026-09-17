'use client';

/**
 * One collapsible group of task rows, with drag reordering.
 *
 * The section header is the card's *first row*: one card per section, starting
 * with `Pinned  4  ⌄` and followed by the rows, rather than a caption floating
 * above a separate card. Each card also paints a stripe down its leading edge in
 * the colour of the list most of its rows belong to, which is what makes a long
 * scroll scannable — see `edgeColorFor`.
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
import { ChevronDown } from 'lucide-react';
import { SectionHeader } from '@/components/ui';
import { cn } from '@/lib/cn';
import { accentVar } from '@/lib/colors';
import type { AccentColor, Task } from '@/lib/types';
import { canReorder, reorderIds, reorderableIds } from './optimistic';
import { TaskRow, type TaskRowDrag } from './TaskRow';
import type { TaskSection } from './sections';

interface DragState {
  id: string;
  overId: string | null;
  edge: 'before' | 'after';
}

/**
 * How long the entrance stagger is allowed to run.
 *
 * The utility's longest delay is 242ms plus a 320ms animation, so 600ms clears
 * the whole envelope. After it has played, the class is dropped — see
 * `entering` below.
 */
const STAGGER_MS = 600;

interface LiftState extends DragState {
  startY: number;
  offset: number;
}

/**
 * The stripe colour for a section card.
 *
 * Overdue is about urgency rather than about a list, so it always paints the
 * danger colour. Every other section paints the list colour most of its rows
 * share: a section that mixes lists still has to show one stripe, and the most
 * common list is the one the section reads as. No known list colour falls back
 * to the tint, which is the same fallback `card-edge` itself uses.
 */
function edgeColorFor(section: TaskSection, listColors?: ReadonlyMap<string, AccentColor>): string {
  if (section.tone === 'danger') return 'var(--danger)';

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

  return winner ? accentVar(winner) : 'var(--tint)';
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

  /*
   * `stagger` is an entrance, not a decoration. React reuses the row elements
   * across a re-render (they are keyed by task id), so a plain class would not
   * restart — but a *new* element would animate, and a checkbox tick or a cache
   * revalidation can insert one. Dropping the class once the entrance has played
   * makes that impossible: only the very first paint of a mounted section
   * staggers, and collapsing/expanding it later stays still.
   */
  const [entering, setEntering] = useState(true);
  useEffect(() => {
    if (!entering) return;
    const timer = window.setTimeout(() => setEntering(false), STAGGER_MS);
    return () => window.clearTimeout(timer);
  }, [entering]);

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

  const header = (
    <SectionHeader
      // The section header is the card's first row, 44px like any other row, so
      // the title, the count and the chevron sit on the row's own baseline
      // rather than in a caption block above the card.
      className="h-11 items-center px-4 pt-0 pb-0"
      // The section title is the loudest thing on the line: a real label-sized
      // 15px title, with the count and the chevron as quiet secondary marks.
      // A filled badge and a 16px chevron used to outweigh the word itself.
      title={
        <span
          className={cn(
            'text-subhead font-semibold',
            section.tone === 'danger' ? 'text-danger' : 'text-label',
          )}
        >
          {section.title}
        </span>
      }
      action={
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${section.title}`}
          className="flex h-11 items-center gap-1.5 rounded-ios px-1 text-secondary pressable"
        >
          <span aria-hidden className="tnum text-footnote font-medium">
            {section.tasks.length}
          </span>
          <span className="sr-only">
            {`${section.tasks.length} task${section.tasks.length === 1 ? '' : 's'}`}
          </span>
          <ChevronDown
            className={cn(
              'size-3.5 transition-transform duration-200 ease-ios-out',
              collapsed && '-rotate-90',
            )}
            aria-hidden
          />
        </button>
      }
    />
  );

  return (
    <div className="mx-4 pt-3 first:pt-1">
      {/*
       * One card per section. `card-edge` is the glass surface plus the 3px
       * stripe down the leading edge and the `overflow-hidden` that keeps a
       * revealed swipe action inside the rounded corners.
       */}
      <div className="card-edge" style={{ '--edge-color': edgeColorFor(section, listColors) } as CSSProperties}>
        {header}

        {collapsed ? null : (
          <>
            {/*
             * The rows carry no background of their own, so the card reads as
             * one surface — header row first, then the tasks. No hairline under
             * the header: the two are one card rather than two groups, so a rule
             * there drew a box around the title instead of separating anything,
             * and the header's own weight already marks where the section
             * starts.
             */}
            <ul className={cn(entering && 'stagger')}>
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
          </>
        )}
      </div>
    </div>
  );
}
