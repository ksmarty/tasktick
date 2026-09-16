'use client';

/**
 * Week view: the shared time grid with seven day columns.
 *
 * The geometry, the server-provided overlap columns, the all-day strip and the
 * drag behaviour all live in `TimeGrid`; this wrapper exists so the two modes
 * have names of their own and can diverge later without touching the day view.
 */
import { TimeGrid, type TimeGridProps } from './TimeGrid';

export type WeekViewProps = TimeGridProps;

export function WeekView(props: WeekViewProps) {
  return <TimeGrid {...props} />;
}
