/**
 * The habit feature's public surface.
 *
 * Views import from here so the folder can be reorganised without touching the
 * routes: the components below are the ones the habits page composes.
 */
export { CheckInControl, type CheckInControlProps } from './CheckInControl';
export { HabitDayRing, type HabitDayRingProps } from './HabitDayRing';
export { HabitEditorSheet, type HabitEditorSheetProps } from './HabitEditorSheet';
export { HabitList, type HabitListProps } from './HabitList';
export { HabitMonthGrid, type HabitMonthGridProps } from './HabitMonthGrid';
export { HabitRow, type HabitRowProps } from './HabitRow';
export { HabitWeekStrip, type HabitWeekStripProps } from './HabitWeekStrip';
export { StreakCount, type StreakCountProps } from './StreakCount';

export {
  HABIT_WINDOWS,
  applyCheckInOptimistically,
  checkInCompletes,
  completionLabel,
  frequencySummary,
  goalSummary,
  habitDoneOn,
  habitMetaSummary,
  habitProgressView,
  habitRingColours,
  habitRingSegments,
  habitsCompletedOn,
  habitWindowRange,
  isHabitDueOn,
  longDateLabel,
  minutesToTime,
  reminderLabels,
  formatReminderTime,
  timeToMinutes,
  streakLabel,
  streakPhrase,
  streakUnit,
  weekOfDays,
  weekStripDays,
  type CheckInChange,
  type HabitProgressView,
  type HabitWindow,
  type WeekDayCell,
  type WeekStripDay,
} from './period';
export {
  DEFAULT_HABIT_ICON,
  HABIT_ICONS,
  HABIT_ICON_NAMES,
  habitIcon,
  habitIconLabel,
  type HabitIconName,
} from './icons';
export {
  RING_BOX_PX,
  RING_CENTRE_PX,
  RING_RADIUS_PX,
  RING_STROKE_PX,
  ringArcPath,
  ringArcs,
  ringPoint,
  type RingArc,
} from './ring';
