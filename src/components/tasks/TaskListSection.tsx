'use client';

/**
 * One collapsible group of task rows, with drag reordering.
 *
 * The section is a GodUI `LiquidGlassCard` — a frosted, monochrome panel with a
 * soft elevation — and the GodUI `Accordion` provides the disclosure inside it
 * (its own `border`/`rounded-xl` are neutralised so the glass card is the only
 * surface). That keeps the spring height animation and rotating chevron the
 * Accordion already owns, and lets the card be the thing that reads as GodUI.
 *
 * ## The colour: gone from the section header
 *
 * The card once painted a 4px stripe down its leading edge, then a single 8px dot
 * in the section header, both in the colour of the list most of its rows belong
 * to. The dot is gone now too. Celestial Sapphire is achromatic, and a list's
 * colour is already carried where it is actionable — the list's own row, the
 * pickers, the sidebar — so repeating it above every section was colour spent on
 * a datum the user is not acting on. The header still separates its sections by
 * contrast: Overdue is the only one at full `text-foreground`, the rest sit at
 * `text-muted-foreground`.
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
 *    with an explicit `text-base text-foreground`. The track also carries the
 *    hairline under the header and between rows, which is what gives the denser
 *    list its rhythm without a background per row.
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
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Accordion } from '@/components/godui/accordion';
import { LiquidGlassCard } from '@/components/godui/liquid-glass-card';
import type { Task } from '@/lib/types';
import { cn } from '@/lib/utils';
import { canReorder, reorderIds, reorderableIds } from './optimistic';
import { TaskRow, type TaskRowDrag } from './TaskRow';
import type { TaskSection } from './sections';
import { GLASS_TINT } from './surface';

interface DragState {
  id: string;
  overId: string | null;
  edge: 'before' | 'after';
}

interface LiftState extends DragState {
  startY: number;
  offset: number;
}

export interface TaskListSectionProps {
  section: TaskSection;
  zone: string;
  timeFormat: '12h' | '24h';
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
    /*
     * `strength={0}`: the refraction would have nothing to bend on the flat page
     * background, so the card keeps the tint, frost, sheen and elevation without
     * paying for the displacement filter on every section of an everyday list.
     */
    <LiquidGlassCard
      radius={16}
      strength={0}
      sheen={0.3}
      tint={GLASS_TINT}
      className="border-border shadow-sm"
    >
      <Accordion
        type="single"
        collapsible
        // A section that starts collapsed is the one the caller marked as such —
        // "Completed" holds work the user has finished with, so it arrives closed.
        defaultValue={section.defaultCollapsed ? [] : [section.id]}
        // Neutralise the Accordion's own surface so the glass card is the card.
        className="rounded-none border-0 bg-transparent"
        items={[
          {
            value: section.id,
            title: (
              <span className="-mx-1 flex min-w-0 flex-1 items-center gap-2">
                <span
                  className={cn(
                    'truncate text-xs font-semibold tracking-wider uppercase',
                    // Contrast, not hue, marks the urgent section: Overdue is
                    // the only header at full foreground.
                    danger ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {section.title}
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-2">
                  <span className="rounded-full border border-border px-2 text-xs tabular-nums text-muted-foreground">
                    {section.tasks.length}
                  </span>
                  <span className="sr-only">{`${section.tasks.length} task${section.tasks.length === 1 ? '' : 's'}`}</span>
                </span>
              </span>
            ),
            content: (
              <ul className="-mx-5 -mb-4 flex flex-col divide-y divide-border/70 border-t border-border/70 text-base text-foreground">
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
    </LiquidGlassCard>
  );
}
