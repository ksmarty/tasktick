/**
 * The habit feature's public surface.
 *
 * Views import from here so the folder can be reorganised without touching the
 * routes: the components below are the ones the habits page composes.
 */
export { CheckInControl, type CheckInControlProps } from './CheckInControl';
export { HabitEditorSheet, type HabitEditorSheetProps } from './HabitEditorSheet';
export { HabitHeatmap, HeatmapHabitList, type HabitHeatmapProps, type HabitHeatmapSeries } from './HabitHeatmap';
export { HabitList, type HabitListProps } from './HabitList';
export { HabitRow, type HabitRowProps } from './HabitRow';
export { HabitWeekStrip, type HabitWeekStripProps } from './HabitWeekStrip';
export { StreakCount, type StreakCountProps } from './StreakCount';

export {
  buildHeatmapGrid,
  combineHabitEntries,
  habitsCheckedOn,
  heatmapCellLabel,
  heatmapDateLabel,
  heatmapRangeLabel,
  heatmapWindow,
  intensityLevel,
  type HeatmapCell,
  type HeatmapGrid,
  type HeatmapWindow,
} from './heatmap';
export {
  HABIT_WINDOWS,
  applyCheckInOptimistically,
  completionLabel,
  frequencySummary,
  goalSummary,
  habitDoneOn,
  habitMetaSummary,
  habitProgressView,
  habitWindowRange,
  isHabitDueOn,
  reminderLabel,
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
