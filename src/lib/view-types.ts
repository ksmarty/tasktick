/**
 * View-model types shared between server responses and client components.
 *
 * These are the *wire* shapes: what an API route actually returns after it has
 * been assembled from repositories. They are declared separately from
 * `./types` so a change to a database column never silently changes a component
 * prop, and vice versa.
 */
import type {
  CaldavAccount,
  Calendar,
  CalendarItem,
  FocusSession,
  Habit,
  List,
  ProductivityStats,
  SessionUser,
  Tag,
  Task,
  UserSettings,
} from './types';
import type { AgendaBuckets } from './agenda-types';

export interface Capabilities {
  push: boolean;
  oidc: boolean;
  vapidPublicKey: string | null;
}

/** Response of `GET /api/bootstrap`. */
export interface BootstrapPayload {
  user: SessionUser;
  settings: UserSettings;
  lists: List[];
  tags: Tag[];
  calendars: Calendar[];
  inboxListId: string | null;
  agenda: AgendaBuckets;
  capabilities: Capabilities;
}

/** Response of `GET /api/settings`. */
export interface SettingsPayload {
  settings: UserSettings;
  capabilities: Capabilities;
  pushDevices: number;
}

/** Response of `GET /api/calendar/items`. */
export interface CalendarItemsPayload {
  items: CalendarItem[];
  calendars: Calendar[];
  /** Items bucketed by `YYYY-MM-DD`. */
  days: Record<string, CalendarItem[]>;
  /** Present only when `?layout=1` was requested. */
  layout?: { item: CalendarItem; column: number; columns: number }[];
}

/** Response of `GET /api/stats`. */
export type StatsPayload = ProductivityStats;

/** Response of `GET /api/focus`. */
export interface FocusPayload {
  sessions: FocusSession[];
  completedToday: number;
}

/** Response of `GET /api/search`. */
export interface SearchPayload {
  tasks: Task[];
  events: { id: string; summary: string; startMs: number | null; startDate: string | null; isAllDay: boolean }[];
  habits: Habit[];
}

/** Response of `GET /api/caldav/accounts`. */
export type AccountsPayload = CaldavAccount[];

/** Response of `POST /api/ical-tokens`. */
export interface IcalTokenPayload {
  id: string;
  name: string;
  url: string;
  includeTasks: boolean;
  includeEvents: boolean;
  lastUsedAtMs: number | null;
  createdAt: number;
}

/** Response of `POST /api/invites` and `GET /api/invites`. */
export interface InvitePayload {
  id: string;
  email: string;
  isAdmin: boolean;
  url: string | null;
  expiresAtMs: number;
  acceptedAtMs: number | null;
  createdAt: number;
}

/** Response of `GET /api/admin/users`. */
export interface AdminUserPayload {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  banned: boolean;
  timezone: string;
  createdAt: number;
}

/** Response of `POST /api/tasks/[id]/complete`. */
export interface CompleteTaskPayload {
  task: Task | null;
  /** True when a recurring task rolled forward instead of finishing. */
  recurred: boolean;
}

/** Response of `POST /api/habits/[id]/checkin`. */
export interface CheckInPayload {
  entries: Record<string, number>;
  doneToday: boolean;
}

/** Response of `POST /api/caldav/accounts/[id]/sync` and `/discover`. */
export interface SyncRunPayload {
  kind: 'full' | 'incremental' | 'push' | 'discover';
  status: 'success' | 'error' | 'skipped';
  pulled: number;
  pushed: number;
  deletedRemote: number;
  deletedLocal: number;
  conflicts: number;
  error?: string;
  calendars?: { href: string; displayName: string; color: string | null; supportsVtodo: boolean; readOnly: boolean }[];
}
