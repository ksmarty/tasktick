/**
 * Public surface of the calendar feature.
 *
 * The route (`src/app/(app)/calendar/page.tsx`) only needs `CalendarScreen`;
 * everything else is exported so a view can be reused (and reasoned about) on
 * its own. The pure geometry lives in `./geometry` and is covered by
 * `tests/calendar-*.test.ts`.
 */
export { CalendarScreen, type CalendarScreenProps } from './CalendarScreen';

/* ------------------------------- the modes ------------------------------- */
export { MonthGrid, type MonthGridProps } from './MonthGrid';
export { WeekView, type WeekViewProps } from './WeekView';
export { DayView, type DayViewProps } from './DayView';
export { AgendaView, type AgendaViewProps } from './AgendaView';
export { TimeGrid, type TimeGridProps } from './TimeGrid';

/* -------------------------------- pieces --------------------------------- */
export { CalendarToolbar, type CalendarToolbarProps } from './CalendarToolbar';
export { EventBlock, type EventBlockProps, type EventBlockVariant } from './EventBlock';
export { AllDayBar, type AllDayBarProps } from './AllDayBar';
export { DayDetailSheet, type DayDetailSheetProps } from './DayDetailSheet';
export { EventEditorSheet, type EventEditorSheetProps, type EventDefaults } from './EventEditorSheet';
export { CalendarSidebar, type CalendarSidebarProps } from './CalendarSidebar';
export { MiniMonth, type MiniMonthProps } from './MiniMonth';
export { DragGhostLabel } from './DragGhostLabel';

/* ------------------------------- internals ------------------------------- */
export { itemColor } from './colors';
export { moveItemInPayload, type MovedInstants } from './optimistic';
export { useItemDrag, type DragGhost, type DragInit, type ItemDragConfig } from './use-item-drag';
export * from './geometry';
export {
  createInteraction,
  type CalendarFilter,
  type CalendarInteraction,
  type CalendarLookup,
  type CalendarPrefs,
  type CalendarViewMode,
  type ItemOpenHandler,
  type RescheduleHandler,
  type RescheduleTarget,
} from './types';
