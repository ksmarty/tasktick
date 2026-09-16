'use client';

/**
 * Day view: the shared time grid with a single column.
 *
 * Identical behaviour to the week — same drag, same all-day strip — because it
 * *is* the same component with one day instead of seven.
 */
import { TimeGrid, type TimeGridProps } from './TimeGrid';

export type DayViewProps = TimeGridProps;

export function DayView(props: DayViewProps) {
  return <TimeGrid {...props} />;
}
