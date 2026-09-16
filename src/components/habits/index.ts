/**
 * The habit feature's public surface.
 *
 * Views import from here so the folder can be reorganised without touching the
 * routes: the six components below are the ones the habits page composes.
 */
export { CheckInControl, type CheckInControlProps } from './CheckInControl';
export { HabitCalendarStrip, type HabitCalendarStripProps } from './HabitCalendarStrip';
export { HabitEditorSheet, type HabitEditorSheetProps } from './HabitEditorSheet';
export { HabitHeatmap, HeatmapHabitList, type HabitHeatmapProps, type HabitHeatmapSeries } from './HabitHeatmap';
export { HabitList, type HabitListProps } from './HabitList';
export { HabitRow, type HabitRowProps } from './HabitRow';
export { StreakBadge, type StreakBadgeProps } from './StreakBadge';

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
  habitProgressView,
  habitWindowRange,
  isHabitDueOn,
  reminderLabel,
  streakLabel,
  streakUnit,
  weekStripDays,
  type CheckInChange,
  type HabitProgressView,
  type HabitWindow,
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
