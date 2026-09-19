'use client';

/**
 * The read-only preview for an item tapped in the calendar.
 *
 * A tap used to open the editor directly, which made the form the only way to
 * *read* an item. This is the missing middle step: it reuses the tasks feature's
 * shared `ItemDetailSheet` — the same bottom sheet the Tasks and Today screens
 * open — and its **Edit** action is the way through to the editor, so the editor
 * stays reachable without being the first thing a tap does.
 *
 * The event branch hands the calendar's `CalendarItem` straight to the sheet:
 * it carries the reads the row needs (title, time, calendar, location, url,
 * `readonly`), and the sheet itself reads the full event for the fields the
 * projection drops. A task does not: the calendar API buckets a deliberately
 * thin item with no notes, tags, subtasks or priority detail. The task branch
 * therefore performs the one read that fills the gap (`GET /api/tasks/:id`, the
 * same read `AgendaTaskEditor` makes) and shows a skeleton in the drawer until
 * it lands; a failed read says so in an `aria-live` alert rather than opening a
 * half-populated sheet.
 *
 * Both branches forward the item's own `readonly` flag, so an item mirrored from
 * a subscribed feed or a read-only collection opens the sheet without an Edit
 * action.
 *
 * Kept beside `AgendaTaskEditor` rather than inside `CalendarScreen` so the
 * screen owns only the two states — which item is being previewed, and which
 * editor is open — and the fetch/fallback lives with the other calendar sheet
 * wrapper.
 */
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Drawer } from '@/components/godui/drawer';
import { ItemDetailSheet } from '@/components/tasks/ItemDetailSheet';
import { useResource } from '@/lib/store';
import type { AccentColor, CalendarItem, Task } from '@/lib/types';

export interface AgendaItemPreviewProps {
  /** The tapped item, or `null` while the preview has never been opened. */
  item: CalendarItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  zone: string;
  timeFormat: '12h' | '24h';
  /** The event's calendar name, resolved by the screen. */
  calendarName?: string | null;
  /** The task's list name and colour, resolved by the screen. */
  listName?: string | null;
  listColor?: AccentColor | null;
  /** Opens the item's editor — the event editor or the task editor. */
  onEdit: () => void;
}

export function AgendaItemPreview({
  item,
  open,
  onOpenChange,
  zone,
  timeFormat,
  calendarName = null,
  listName = null,
  listColor = null,
  onEdit,
}: AgendaItemPreviewProps) {
  if (!item) return null;

  if (item.kind === 'event') {
    return (
      <ItemDetailSheet
        open={open}
        onOpenChange={onOpenChange}
        event={item}
        calendarName={calendarName}
        readOnly={item.readonly ?? false}
        zone={zone}
        timeFormat={timeFormat}
        onEdit={onEdit}
      />
    );
  }

  return (
    <TaskPreview
      item={item}
      open={open}
      onOpenChange={onOpenChange}
      listName={listName}
      listColor={listColor}
      zone={zone}
      timeFormat={timeFormat}
      onEdit={onEdit}
    />
  );
}

/**
 * The task branch: fetch the full record, then hand it to the shared sheet.
 *
 * `staleAfterMs: 0` forces a re-read so a reopened preview never shows a stale
 * copy — the same contract `AgendaTaskEditor` documents for the editor.
 */
function TaskPreview({
  item,
  open,
  onOpenChange,
  listName,
  listColor,
  zone,
  timeFormat,
  onEdit,
}: {
  item: CalendarItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listName: string | null;
  listColor: AccentColor | null;
  zone: string;
  timeFormat: '12h' | '24h';
  onEdit: () => void;
}) {
  const resource = useResource<Task>(`/api/tasks/${item.id}`, undefined, {
    staleAfterMs: 0,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  if (resource.data) {
    return (
      <ItemDetailSheet
        open={open}
        onOpenChange={onOpenChange}
        task={resource.data}
        listName={listName}
        listColor={listColor}
        readOnly={item.readonly ?? false}
        zone={zone}
        timeFormat={timeFormat}
        onEdit={onEdit}
      />
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} side="bottom" title={item.title} className="p-0 px-card">
      <div className="flex flex-col gap-stack pb-[max(0.25rem,env(safe-area-inset-bottom,0px))]">
        {resource.error ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{resource.error}</AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-col gap-2" aria-busy>
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}
      </div>
    </Drawer>
  );
}
