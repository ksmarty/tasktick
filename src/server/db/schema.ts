/**
 * Dialect-selecting schema barrel.
 *
 * `schema.pg.ts` is a deliberate mechanical mirror of `schema.sqlite.ts`, kept
 * honest by `tests/schema-parity.test.ts`. Both files export the same table
 * names with structurally identical JS types, so application code is written
 * once against the SQLite types (full type inference, no unions) while the
 * runtime object handed to Drizzle matches the configured driver.
 *
 * The single cast below is the *only* place that relies on that invariant; the
 * parity test is what makes it safe.
 */
import * as sqliteSchema from './schema.sqlite';
import * as pgSchema from './schema.pg';
import { currentDialect } from './dialect';

export type Schema = typeof sqliteSchema;

export const schema: Schema =
  currentDialect() === 'postgres' ? (pgSchema as unknown as Schema) : sqliteSchema;

export const {
  user,
  session,
  account,
  verification,
  invites,
  userSettings,
  lists,
  tags,
  tasks,
  taskTags,
  taskCompletions,
  taskReminders,
  habits,
  habitEntries,
  caldavAccounts,
  calendars,
  calendarEvents,
  syncLogs,
  syncConflicts,
  pushSubscriptions,
  icalTokens,
  apiTokens,
  focusSessions,
  savedFilters,
  importKeys,
} = schema;

export type {
  UserRow,
  SessionRow,
  ListRow,
  TaskRow,
  TagRow,
  HabitRow,
  HabitEntryRow,
  CalendarRow,
  CalendarEventRow,
  CaldavAccountRow,
  SyncLogRow,
  SyncConflictRow,
  FocusSessionRow,
  SavedFilterRow,
  ImportKeyRow,
  UserSettingsRow,
  TaskReminderRow,
  PushSubscriptionRow,
  IcalTokenRow,
  ApiTokenRow,
  InviteRow,
} from './schema.sqlite';
