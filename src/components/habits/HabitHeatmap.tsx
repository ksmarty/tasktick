'use client';

/**
 * The heatmap: a 53-week GitHub-style grid of daily entries.
 *
 * Geometry lives in `./heatmap` (pure, tested); this file is only the DOM.
 * Three things need care:
 *
 *   1. **Honest cell labels.** A screen reader cannot see a colour ramp, so
 *      every cell is a button whose accessible name is
 *      `12 March 2025, 3 of 8 glasses`.
 *   2. **A day popover that is not clipped.** The grid scrolls horizontally, and
 *      a popover rendered inside a scroll container is cut off. It is therefore
 *      a sibling of the scroller, positioned from the selected cell's column.
 *   3. **Colour without hex.** Levels come from `accentSoft` / `accentVar`, so a
 *      cell follows the habit's accent and the light/dark theme.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { accentSoft, accentVar } from '@/lib/colors';
import { cn } from '@/lib/cn';
import { IconButton, Stepper, Switch } from '@/components/ui';
import { useAppearance } from '@/app/providers';
import {
  buildHeatmapGrid,
  heatmapCellLabel,
  heatmapDateLabel,
  heatmapRangeLabel,
  habitsCheckedOn,
  heatmapWindow,
  type HeatmapCell,
} from './heatmap';
import type { AccentColor, DateOnly, Habit } from '@/lib/types';

/** Cell geometry. The step is the only number the popover positioning needs. */
const CELL_PX = 12;
const GAP_PX = 4;
const STEP_PX = CELL_PX + GAP_PX;
/** Fixed width of the sticky weekday gutter, so a cell's x is computable. */
const GUTTER_PX = 32;
/** Height of the month-label strip above the grid. */
const MONTH_ROW_PX = 16;
const PANEL_WIDTH_PX = 240;

/** Opacity of each intensity step above the empty cell. */
const LEVEL_ALPHA = [0, 0.3, 0.55, 0.8, 1];

export interface HabitHeatmapSeries {
  /** Stable id of what is being drawn (a habit id, or `all`). */
  key: string;
  label: string;
  color: AccentColor;
  /** Amount that counts as a full cell. */
  target: number;
  /** Unit shown in labels, e.g. `glasses`. */
  unit: string | null;
  /** When set, labels read `4 habits` instead of `4 of 8 glasses`. */
  noun?: string | null;
  entries: Record<DateOnly, number>;
}

export interface HabitHeatmapProps {
  series: HabitHeatmapSeries;
  today: DateOnly;
  weekStartsOn: number;
  /** Called with the new amount for a day. Omit to make the grid read-only. */
  onSetEntry?: (date: DateOnly, count: number | null) => void;
  /** Whether the day is scheduled, shown as a hint in the popover. */
  isScheduled?: (date: DateOnly) => boolean;
  /** Extra detail rendered at the bottom of the popover. */
  renderDetail?: (date: DateOnly) => ReactNode;
  /** Days before this cannot be opened (the habit's start date). */
  earliest?: DateOnly;
  className?: string;
}

export function HabitHeatmap({
  series,
  today,
  weekStartsOn,
  onSetEntry,
  isScheduled,
  renderDetail,
  earliest,
  className,
}: HabitHeatmapProps) {
  const { resolvedTheme } = useAppearance();
  const dark = resolvedTheme === 'dark';

  const window_ = useMemo(() => heatmapWindow(today), [today]);
  const grid = useMemo(
    () =>
      buildHeatmapGrid({
        from: window_.from,
        to: window_.to,
        today,
        weekStartsOn,
        entries: series.entries,
        target: series.target,
      }),
    [series.entries, series.target, today, weekStartsOn, window_],
  );

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const cellRefs = useRef(new Map<DateOnly, HTMLButtonElement>());

  const [selected, setSelected] = useState<DateOnly | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);

  const selectedCell = useMemo(() => {
    if (!selected) return null;
    for (const week of grid.weeks) {
      for (const cell of week) if (cell?.date === selected) return cell;
    }
    return null;
  }, [grid.weeks, selected]);

  const close = useCallback((restoreFocus = true) => {
    setSelected((current) => {
      if (current && restoreFocus) cellRefs.current.get(current)?.focus({ preventScroll: true });
      return null;
    });
  }, []);

  // Escape and an outside press both dismiss, like every other popover here.
  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (target instanceof HTMLElement && target.dataset.heatmapCell) return;
      close(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [close, selected]);

  // Focus the panel's first control the moment it opens, but never again while
  // the user walks through days with the arrows.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (selected && !wasOpen.current) {
      panelRef.current?.querySelector<HTMLElement>('button, input, [tabindex="0"]')?.focus({ preventScroll: true });
    }
    wasOpen.current = Boolean(selected);
  }, [selected]);

  const panelStyle = useMemo(() => {
    if (!selectedCell) return undefined;
    const scroller = scrollerRef.current;
    const viewport = scroller?.clientWidth ?? 0;
    const rawLeft = GUTTER_PX + selectedCell.weekIndex * STEP_PX - scrollLeft - PANEL_WIDTH_PX / 2;
    const maxLeft = Math.max(0, viewport - PANEL_WIDTH_PX - 4);
    const left = Math.min(Math.max(4, rawLeft), maxLeft || 4);
    const below = selectedCell.row < 4;
    const top = MONTH_ROW_PX + (below ? (selectedCell.row + 1) * STEP_PX + 6 : selectedCell.row * STEP_PX - 6);
    return { left, top, transform: below ? undefined : 'translateY(-100%)' } as const;
  }, [scrollLeft, selectedCell]);

  const selectedCount = selected ? series.entries[selected] ?? 0 : 0;
  // Never offer to walk outside the grid: a day with no cell has nothing to show.
  const earliestBound = earliest && earliest > grid.from ? earliest : grid.from;
  const canGoBack = Boolean(selected && selected > earliestBound);
  const canGoForward = Boolean(selected && selected < grid.to);

  function shiftDay(delta: number) {
    if (!selected) return;
    const next = addDays(selected, delta);
    if (next < earliestBound) return;
    if (next > grid.to) return;
    setSelected(next);
    cellRefs.current.get(next)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  return (
    <div className={cn('relative', className)}>
      <div
        ref={scrollerRef}
        onScroll={(event) => setScrollLeft(event.currentTarget.scrollLeft)}
        className="scroll-ios no-scrollbar overflow-x-auto pb-1"
      >
        <div className="flex">
          {/* Weekday gutter: sticky so the orientation survives a horizontal scroll. */}
          <div className="sticky left-0 z-10 shrink-0 bg-card pr-1" style={{ width: GUTTER_PX }}>
            <div style={{ height: MONTH_ROW_PX }} aria-hidden />
            <div className="flex flex-col" style={{ gap: GAP_PX }}>
              {grid.rows.map((row, index) => (
                <span
                  key={row.weekday}
                  aria-hidden
                  className="flex items-center text-caption-2 leading-none text-tertiary"
                  style={{ height: CELL_PX }}
                >
                  {grid.labelledRows.includes(index) ? row.label : ''}
                </span>
              ))}
            </div>
          </div>

          <div className="shrink-0">
            <div className="relative" style={{ height: MONTH_ROW_PX }} aria-hidden>
              {grid.months.map((month) => (
                <span
                  key={`${month.label}-${month.weekIndex}`}
                  className="absolute bottom-0 text-caption-2 leading-none text-tertiary"
                  style={{ left: month.weekIndex * STEP_PX }}
                >
                  {month.label}
                </span>
              ))}
            </div>

            <div className="flex" style={{ gap: GAP_PX }}>
              {grid.weeks.map((week, weekIndex) => (
                <div key={weekIndex} className="flex flex-col" style={{ gap: GAP_PX }}>
                  {week.map((cell, row) =>
                    cell ? (
                      <button
                        key={cell.date}
                        ref={(node) => {
                          if (node) cellRefs.current.set(cell.date, node);
                          else cellRefs.current.delete(cell.date);
                        }}
                        type="button"
                        data-heatmap-cell="true"
                        aria-label={heatmapCellLabel(cell.date, cell.count, {
                          target: series.target,
                          unit: series.unit,
                          noun: series.noun ?? null,
                        })}
                        aria-haspopup="dialog"
                        aria-expanded={selected === cell.date}
                        onClick={() => setSelected(cell.date === selected ? null : cell.date)}
                        className={cn(
                          'rounded-[3px] pressable',
                          cell.level === 0 && 'bg-fill-tertiary',
                          cell.date === today && 'ring-1 ring-label',
                        )}
                        // An empty button has no intrinsic size, so the cell's
                        // geometry has to be stated here — the same 12px box the
                        // gutter and the empty-cell placeholders use, or the
                        // whole grid collapses to a zero-height strip.
                        style={{
                          width: CELL_PX,
                          height: CELL_PX,
                          ...(cell.level > 0 ? cellBackground(cell, series.color, dark) : {}),
                        }}
                      />
                    ) : (
                      <span key={`${weekIndex}-${row}`} aria-hidden style={{ width: CELL_PX, height: CELL_PX }} />
                    ),
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <p className="pt-2 text-caption-1 text-tertiary">
        {heatmapRangeLabel(grid.from, grid.to)} · {series.label}
        {onSetEntry ? ' · tap a square to edit that day' : ''}
      </p>

      {selected && selectedCell && panelStyle ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={`Entry for ${heatmapDateLabel(selected)}`}
          style={{ ...panelStyle, width: PANEL_WIDTH_PX }}
          className="absolute rounded-ios-lg bg-elevated p-3 shadow-ios-lg animate-ios-in"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-subhead font-semibold text-label">{heatmapDateLabel(selected)}</p>
              <p className="text-caption-1 text-secondary">
                {selected === today ? 'Today' : ''}
                {isScheduled && !isScheduled(selected) ? `${selected === today ? ' · ' : ''}Not scheduled` : ''}
              </p>
            </div>
            <IconButton
              icon={X}
              size="sm"
              variant="plain"
              aria-label="Close day details"
              onClick={() => close()}
              className="-mt-1 -mr-1"
            />
          </div>

          <div className="mt-2 flex items-center justify-between gap-1">
            <IconButton
              icon={ChevronLeft}
              size="sm"
              variant="tinted"
              disabled={!canGoBack}
              aria-label="Previous day"
              onClick={() => shiftDay(-1)}
            />
            <span className="tnum text-footnote text-secondary">
              {selectedCount > 0
                ? series.noun
                  ? `${selectedCount} ${series.noun}`
                  : `${selectedCount}${series.target > 1 ? `/${series.target}` : ''}${series.unit ? ` ${series.unit}` : ''}`
                : 'Nothing logged'}
            </span>
            <IconButton
              icon={ChevronRight}
              size="sm"
              variant="tinted"
              disabled={!canGoForward}
              aria-label="Next day"
              onClick={() => shiftDay(1)}
            />
          </div>

          {onSetEntry ? (
            <div className="mt-3">
              {series.noun ? null : series.target > 1 ? (
                <Stepper
                  label={`Amount for ${heatmapDateLabel(selected)}`}
                  value={selectedCount}
                  min={0}
                  max={Math.max(2, series.target * 3)}
                  size="sm"
                  onChange={(value) => onSetEntry(selected, value)}
                  formatValue={(value) => `${value}${series.unit ? ` ${series.unit}` : ''}`}
                />
              ) : (
                <Switch
                  checked={selectedCount > 0}
                  size="sm"
                  label="Checked in"
                  onCheckedChange={(checked) => onSetEntry(selected, checked ? 1 : null)}
                />
              )}
              <p className="mt-2 text-caption-1 text-tertiary">
                {series.target > 1 && !series.noun ? 'Set it to zero to clear the day.' : ''}
              </p>
            </div>
          ) : null}

          {renderDetail ? <div className="mt-2">{renderDetail(selected)}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function cellBackground(cell: HeatmapCell, color: AccentColor, dark: boolean) {
  const alpha = LEVEL_ALPHA[cell.level] ?? 1;
  if (cell.level >= 4) return { backgroundColor: accentVar(color) };
  return { backgroundColor: accentSoft(color, alpha, dark) };
}

/** Floating-day arithmetic for the popover, kept local to avoid a zone argument. */
function addDays(date: DateOnly, days: number): DateOnly {
  const [y, m, d] = date.split('-').map((part) => Number.parseInt(part, 10));
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

/** Detail list for the combined grid: which habits were kept on a day. */
export function HeatmapHabitList({ habits, date }: { habits: readonly Habit[]; date: DateOnly }) {
  const checked = habitsCheckedOn(habits, date);
  if (checked.length === 0) return <p className="text-caption-1 text-tertiary">No habits logged.</p>;
  return (
    <ul className="space-y-0.5">
      {checked.map((habit) => (
        <li key={habit.id} className="flex items-center gap-1.5 text-caption-1 text-secondary">
          <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: accentVar(habit.color) }} aria-hidden />
          <span className="truncate">{habit.name}</span>
        </li>
      ))}
    </ul>
  );
}
