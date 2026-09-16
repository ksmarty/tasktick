'use client';

/**
 * The calendar toolbar.
 *
 * The nav bar title carries the range label from `rangeForView` ("March 2025",
 * "10–16 March 2025", "Monday 10 March"), so what the user sees at the top is
 * exactly the window the server was asked for. Because that label changes
 * without a page navigation, a screen reader is told about it through a hidden
 * `aria-live` region in the pager row — otherwise a keyboard user would page
 * through months in silence.
 */
import { ChevronLeft, ChevronRight, Plus, SlidersHorizontal } from 'lucide-react';
import { Button, Chip, IconButton, NavBar, SegmentedControl, type SegmentedOption } from '@/components/ui';
import type { CalendarFilter, CalendarViewMode } from './types';

const VIEW_OPTIONS: SegmentedOption<CalendarViewMode>[] = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' },
  { value: 'agenda', label: 'Agenda' },
];

export interface CalendarToolbarProps {
  view: CalendarViewMode;
  onViewChange: (view: CalendarViewMode) => void;
  /** `rangeForView(...).label` for the visible window. */
  label: string;
  /** A short label for the anchor day, e.g. "Mon 10 Mar". */
  anchorLabel: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onAdd: () => void;
  onOpenCalendars: () => void;
  /** Set when `?calendar=` is pinning the view to one calendar. */
  filter: CalendarFilter | null;
  onClearFilter: () => void;
}

export function CalendarToolbar({
  view,
  onViewChange,
  label,
  anchorLabel,
  onPrev,
  onNext,
  onToday,
  onAdd,
  onOpenCalendars,
  filter,
  onClearFilter,
}: CalendarToolbarProps) {
  return (
    <NavBar
      title={label}
      leading={
        <Button variant="plain" size="sm" onClick={onToday} className="px-2">
          Today
        </Button>
      }
      trailing={
        <div className="flex items-center gap-1">
          <SegmentedControl
            size="sm"
            label="Calendar view"
            options={VIEW_OPTIONS}
            value={view}
            onChange={onViewChange}
            className="w-[9.5rem] sm:w-[11rem]"
          />
          <IconButton aria-label="New event" icon={Plus} size="md" onClick={onAdd} />
        </div>
      }
    >
      <div className="flex items-center gap-1 px-2 pb-1.5">
        <IconButton aria-label="Previous period" icon={ChevronLeft} size="sm" onClick={onPrev} />
        <IconButton aria-label="Next period" icon={ChevronRight} size="sm" onClick={onNext} />

        <span className="min-w-0 flex-1 truncate px-1 text-center text-footnote text-secondary">{anchorLabel}</span>
        <span aria-live="polite" className="sr-only">
          {label}
        </span>

        {filter ? (
          <Chip color={filter.color} onRemove={onClearFilter} removeLabel={`Stop filtering by ${filter.name}`}>
            {filter.name}
          </Chip>
        ) : null}

        <IconButton aria-label="Calendars" icon={SlidersHorizontal} size="sm" onClick={onOpenCalendars} />
      </div>
    </NavBar>
  );
}
