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
 * ## The colour: on the rows, not the header
 *
 * The card once painted a 4px stripe down its leading edge, then a single 8px dot
 * in the section header, both in the colour of the list most of its rows belong
 * to. Both are gone. A list's colour now rides each row's own leading edge (see
 * `TaskRow`/`EventRow`): the colour belongs to the task you are reading, not to
 * the group it was bucketed into, and one strip per row scans a mixed list
 * better than one dot per section. The header therefore separates its sections
 * by contrast alone: Overdue is the only one at full `text-foreground`, the rest
 * sit at `text-muted-foreground`.
 *
 * ## Events share the list
 *
 * A section renders its tasks and then its events. Events are `CalendarItem`s
 * from `/api/calendar/items`, drawn by `EventRow` with a calendar glyph where the
 * checkbox sits; they are never completable and never reordered.
 *
 * ## The one edge on the card
 *
 * The glass card ships a 1px `border` *and* a static edge sheen — an inset
 * `box-shadow: inset 0 1px 0 rgba(255,255,255,0.5·sheen)` — which on the light
 * theme paints a second, lighter line one pixel inside the border. Measured down
 * a 1px column at the card's top edge (mobile, DSF 2, pixels read back from the
 * screenshot): page `#ffffff`, border `#e5e5e5`, sheen `#f0f0f0`, card
 * `#eeeeee` — two lines, exactly the double border that was reported. `sheen={0}`
 * removes the sheen and leaves the single `border-border` edge; it also drops the
 * pointer-tracked specular glow, which a flat, non-refracting list card has
 * nothing to say with. The hairline under the header used to be a second line
 * inside the card; it is gone now, and the header and its rows are separated by
 * spacing instead (see below).
 *
 * ## The header's vertical padding
 *
 * The vendored trigger is `py-4` on top of an 18px title row, which made the
 * header 50px tall against 44px rows — the top of every card read as empty. The
 * padding is tightened to `py-2.5` through a descendant rule on the Accordion's
 * own root (`[&_button[aria-expanded]]:py-2.5`), which is why the height is set
 * here rather than on the title: a negative margin on the title can only shrink
 * the line to the 16px chevron that is its sibling, and cannot reach the padding
 * at all. Measured: 50px → 38px. `py-2.5` is on Tailwind's scale, and the
 * override is vertical only, so the horizontal axis below is untouched.
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
 *    The header's own padding is a separate, vertical override (above), so this
 *    compensation is unchanged: the rows' left/right axis still comes from
 *    `-mx-5` + `px-row`.
 *  - the trigger owns `px-5`, so the header's own content pulls back with `-mx-1`
 *    (1.25rem − 0.25rem = 1rem) and lands on exactly the same `px-row` axis as the
 *    rows. A negative margin rather than an override, because `tailwind-merge`
 *    cannot be relied on to resolve a token class against a vendored one.
 *  - the panel paints `text-sm text-muted-foreground`, which the row track resets
 *    with an explicit `text-base text-foreground`. The track used to carry the
 *    hairline under the header and between rows; both lines are gone, and the
 *    track's own 44px rows plus the header's own `py-2.5` supply the rhythm by
 *    spacing alone.
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
import type { CalendarLookup } from '@/components/calendar/types';
import type { CalendarItem, AccentColor, Task } from '@/lib/types';
import { cn } from '@/lib/utils';
import { canReorder, reorderIds, reorderableIds } from './optimistic';
import { EventRow } from './EventRow';
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
  /** Resolves a task's list colour for its row strip. */
  listColorFor?: (task: Task) => AccentColor | null;
  /** The calendars, so an event strip resolves the calendar's own colour. */
  calendars?: CalendarLookup;
  /** Whether the resolved appearance is dark, for the accent hex lookup. */
  dark?: boolean;
  /** Opens an event row. */
  onOpenEvent?: (event: CalendarItem) => void;
  onDelete?: (task: Task) => void;
  onWontDo?: (task: Task) => void;
  /** Pins a task to the top of the list, or unpins it when already pinned. */
  onPin?: (task: Task) => void;
  /** Publishes a new manual order for this section. */
  onReorder?: (section: TaskSection, orderedIds: string[]) => void;
  disabled?: boolean;
}

export function TaskListSection({
  section,
  zone,
  timeFormat,
  onToggle,
  onOpen,
  listColorFor,
  calendars,
  dark = false,
  onOpenEvent,
  onDelete,
  onWontDo,
  onPin,
  onReorder,
  disabled = false,
}: TaskListSectionProps) {
  const [htmlDrag, setHtmlDrag] = useState<DragState | null>(null);
  const [lift, setLift] = useState<LiftState | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  const reorderable = Boolean(onReorder) && section.reorderable && !disabled;

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
  const taskCount = section.tasks.length;
  const eventCount = section.events.length;
  /*
   * The count is every row the section renders, not just its tasks: a group
   * whose header said "2" while three event rows sat under it was the bug. The
   * screen-reader line spells out the split, so "2 tasks, 1 event" is announced
   * rather than a bare total.
   */
  const itemCount = taskCount + eventCount;
  const countSummary = [
    taskCount ? `${taskCount} task${taskCount === 1 ? '' : 's'}` : null,
    eventCount ? `${eventCount} event${eventCount === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    /*
     * `strength={0}`: the refraction would have nothing to bend on the flat page
     * background, so the card keeps the tint, frost and elevation without paying
     * for the displacement filter on every section of an everyday list.
     * `sheen={0}`: the edge sheen is the second line on the card's top edge (see
     * the file doc), so the border is the only edge.
     */
    <LiquidGlassCard
      radius={10}
      strength={0}
      sheen={0}
      tint={GLASS_TINT}
      className="border-border shadow-sm"
    >
      <Accordion
        type="single"
        collapsible
        // A section that starts collapsed is the one the caller marked as such —
        // "Completed" holds work the user has finished with, so it arrives closed.
        defaultValue={section.defaultCollapsed ? [] : [section.id]}
        // Neutralise the Accordion's own surface so the glass card is the card,
        // and tighten the header's own `py-4` (see the file doc).
        className="rounded-none border-0 bg-transparent [&_button[aria-expanded]]:py-2.5"
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
                    {itemCount}
                  </span>
                  <span className="sr-only">{countSummary}</span>
                </span>
              </span>
            ),
            content: (
              /*
               * No hairlines: neither the rule under the header nor the rules
               * between rows. Separation is spacing — the header trigger's own
               * `py-2.5` above the rows — so a row is delimited by air rather
               * than by a line. There is deliberately no vertical gap between
               * rows: a gap is exactly where the per-row colour strips used to
               * break, and a continuous strip down the section is the point. The
               * rows' own 44px boxes and the inset press region supply the
               * rhythm instead.
               */
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
                    accent={listColorFor?.(task) ?? null}
                    onDelete={onDelete}
                    onWontDo={onWontDo}
                    onPin={onPin}
                    disabled={disabled}
                    drag={dragPropsFor(task)}
                    first={index === 0}
                    last={eventCount === 0 && index === taskCount - 1}
                  />
                ))}
                {section.events.map((event, index) => (
                  <EventRow
                    key={event.key}
                    event={event}
                    zone={zone}
                    timeFormat={timeFormat}
                    onOpen={onOpenEvent}
                    calendars={calendars}
                    dark={dark}
                    first={taskCount === 0 && index === 0}
                    last={index === eventCount - 1}
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
