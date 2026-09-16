'use client';

/**
 * One collapsible group of task rows, with drag reordering.
 *
 * Reordering is deliberately browser-native on a desktop pointer (HTML5
 * drag-and-drop, with a real drop indicator) and pointer-driven on touch (press
 * and hold to lift the row so it follows the finger, with a shadow). Both paths
 * finish in the same place: the full ordered id list for the section is handed to
 * `onReorder`, which POSTs it to `/api/tasks/reorder`.
 */
import { useEffect, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { SectionHeader, Badge } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { Task } from '@/lib/types';
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

export interface TaskListSectionProps {
  section: TaskSection;
  zone: string;
  timeFormat: '12h' | '24h';
  /** `listId -> name`, so rows in a mixed view can name their list. */
  listNames?: ReadonlyMap<string, string>;
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
  listNames,
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

  const header = (
    <SectionHeader
      title={<span className={cn(section.tone === 'danger' && 'text-danger')}>{section.title}</span>}
      className="pt-5 pb-1.5"
      action={
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${section.title}`}
          className="-my-2 flex min-h-11 items-center gap-2 rounded-ios px-2 pressable"
        >
          <Badge value={section.tasks.length} label={`${section.tasks.length} tasks`} />
          <ChevronDown
            className={cn(
              'size-4 text-tertiary transition-transform duration-200 ease-ios-out',
              collapsed && '-rotate-90',
            )}
            aria-hidden
          />
        </button>
      }
    />
  );

  if (collapsed) return header;

  return (
    <div>
      {header}
      <ul className="mx-4 rounded-ios-md bg-elevated">
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
            listName={listNames?.get(task.listId ?? '') ?? null}
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
    </div>
  );
}
