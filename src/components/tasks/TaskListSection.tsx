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
 * ## The colour: one dot, not a stripe
 *
 * The card used to paint a 4px full-height stripe down its leading edge in the
 * colour of the list most of its rows belong to. Celestial Sapphire is
 * achromatic, and a red / green / purple stripe per section was the loudest
 * colour on the screen — but the colour is *data* (which list), so dropping it
 * outright would lose information. It survives as a single 8px dot in the
 * section header: the same signal, a fraction of the coloured area, on a card
 * that is otherwise pure contrast. Overdue keeps the theme's destructive dot,
 * which is the one urgency the palette lets colour carry; its label is also the
 * only one at full `text-foreground` contrast, so the meaning does not depend on
 * hue alone.
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
import { accentHex } from '@/lib/colors';
import type { AccentColor, Task } from '@/lib/types';
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
                {/*
                 * The list's colour, reduced to a single dot. The dot is the
                 * section's leading edge now; see the file comment.
                 */}
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: edgeColorFor(section, listColors) }}
                />
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
