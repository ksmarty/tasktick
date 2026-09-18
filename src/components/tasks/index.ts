/**
 * Public surface of the task feature.
 *
 * The route pages in `src/app/(app)/today` and `src/app/(app)/tasks` render the
 * two views from here; nothing outside this folder reaches into the individual
 * files, so the internals stay free to move.
 */

/* ------------------------------- components ------------------------------ */
export { TaskRow, type TaskRowProps, type TaskRowDrag } from './TaskRow';
export { TaskListSection, type TaskListSectionProps } from './TaskListSection';
export {
  DueDateLabel,
  TaskMeta,
  dueLabel,
  type DueDateLabelProps,
  type TaskMetaProps,
  type DueLabel,
  type DueTone,
} from './TaskMeta';
export { TaskEditorSheet, type TaskEditorSheetProps } from './TaskEditorSheet';
export { QuickAddBar, type QuickAddBarProps } from './QuickAddBar';
export { SubTaskList, type SubTaskListProps } from './SubTaskList';
export { EmptyTasks, type EmptyTasksProps } from './EmptyTasks';

/* --------------------------------- pickers ------------------------------- */
export { PriorityPicker, type PriorityPickerProps } from './PriorityPicker';
export { RepeatPicker, type RepeatPickerProps } from './RepeatPicker';
export {
  ReminderPicker,
  describeReminders,
  REMINDER_OFFSETS,
  type ReminderPickerProps,
  type ReminderOffset,
} from './ReminderPicker';
export { TagPicker, type TagPickerProps } from './TagPicker';
export { ListPicker, type ListPickerProps } from './ListPicker';
export { TaskFilterMenu, type TaskFilterMenuProps } from './FilterMenu';
export { TaskSortMenu, type TaskSortMenuProps } from './SortMenu';

/* ---------------------------------- views -------------------------------- */
export { TodayView } from './TodayView';
export { TasksView } from './TasksView';

/* ------------------------------ pure helpers ----------------------------- */
export {
  buildListSections,
  buildTodaySections,
  countRemaining,
  SECTION_BUCKET,
  TODAY_SECTIONS,
  todayProgress,
  type ListSectionOptions,
  type TaskSection,
  type TaskSectionTone,
  type TodayProgress,
} from './sections';
export {
  applyOrder,
  canReorder,
  moveId,
  patchById,
  patchByIds,
  removeByIds,
  removeFromAgenda,
  reorderAgendaSection,
  reorderIds,
  reorderList,
  reorderableIds,
  setAgendaStatus,
  setPriorityByIds,
  setStatusById,
  setStatusByIds,
} from './optimistic';
export {
  dedupeTagNames,
  findListByName,
  planQuickAdd,
  quickAddChips,
  type QuickAddChip,
  type QuickAddChipKind,
  type QuickAddContext,
  type QuickAddPlan,
} from './quick-add';
export {
  activeFilters,
  clearFilter,
  DEFAULT_TASK_VIEW,
  defaultSortDir,
  DIRECTIONAL_SORTS,
  isDirectionalSort,
  parseTaskView,
  serializeTaskView,
  sortDirLabel,
  sortTasks,
  taskQuery,
  taskViewTitle,
  TASK_SORTS,
  TASK_WINDOWS,
  updateTaskView,
  type ActiveFilter,
  type TaskSort,
  type TaskSortDir,
  type TaskViewState,
  type TaskWindow,
} from './filters';
export {
  OFFLINE_NOTICE,
  useTaskActions,
  type TaskActions,
  type TaskRef,
} from './useTaskActions';
export {
  PRIORITY_ITEMS,
  priorityColor,
  priorityLabel,
  type PriorityItem,
} from './priority';
export type { BulkAction, BulkPayload, CreateTaskPayload, TaskPatch } from './payloads';
