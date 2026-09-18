/**
 * Public surface of the calendar feature.
 *
 * The route (`src/app/(app)/calendar/page.tsx`) only needs `CalendarScreen`;
 * everything else is exported so a piece can be reused (and reasoned about) on
 * its own. The pure geometry lives in `./geometry` and is covered by
 * `tests/calendar-*.test.ts`.
 */
export { CalendarScreen, type CalendarScreenProps } from './CalendarScreen';

/* ------------------------------- the screen ------------------------------ */
export { MonthGrid, type MonthGridProps, type MonthPage } from './MonthGrid';
export { DayAgenda, type DayAgendaProps } from './DayAgenda';
export { CalendarToolbar, type CalendarToolbarProps } from './CalendarToolbar';

/* -------------------------------- pieces --------------------------------- */
export { CalendarCombobox, type CalendarComboboxProps } from './CalendarCombobox';
export { DayDetailSheet, type DayDetailSheetProps } from './DayDetailSheet';
export { EventEditorSheet, type EventEditorSheetProps, type EventDefaults } from './EventEditorSheet';
export { CalendarSidebar, type CalendarSidebarProps } from './CalendarSidebar';
export { DragGhostLabel } from './DragGhostLabel';

/* ------------------------------- internals ------------------------------- */
export { itemColor, itemHex, calendarColorHex, customCalendarHex } from './colors';
export { moveItemInPayload, type MovedInstants } from './optimistic';
export { useItemDrag, type DragGhost, type DragInit, type ItemDragConfig } from './use-item-drag';
export {
  useMonthGestures,
  MONTH_ROW_PX,
  MONTH_EXPANDED_PX,
  MONTH_COLLAPSED_PX,
  AXIS_LOCK_PX,
  type MonthGestures,
  type MonthGestureOptions,
} from './use-month-gestures';
export * from './geometry';
export {
  createInteraction,
  type CalendarFilter,
  type CalendarInteraction,
  type CalendarLookup,
  type CalendarPrefs,
  type ItemOpenHandler,
  type RescheduleHandler,
  type RescheduleTarget,
} from './types';
