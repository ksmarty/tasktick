/**
 * The settings sections, as data.
 *
 * This used to live at the bottom of `SettingsTabs.tsx`, below the navigation
 * shell that consumes it. The shell is a client component that imports the
 * Radix primitives, so anything it exported was untestable in this repo (there is
 * no jsdom/testing-library here) — which mattered the moment the settings search
 * needed to be checked: the search is a pure function over *these* groups, and a
 * pure function over nothing cannot be tested. So the configuration moved out,
 * and the shell imports it.
 *
 * ## The grouping
 *
 * The split is by subject: everything about you and how the app is set up
 * personally, then everything that connects the app to calendars and
 * notifications elsewhere, then the settings that change how the app behaves or
 * hand you your data. At most four sections per group is also what keeps both
 * rows of the navigation one clean line at 390px.
 *
 * ## Keywords are for the search, not for show
 *
 * A section's label is what fits in a pill; it is not what someone types when
 * they are looking for it. Nobody hunting for the reminder settings types
 * "notifications" — they type "push", "alerts" or "quiet hours". `keywords` is
 * where those words go: they are matched by `searchSettings` and never rendered.
 */
import type { SettingsNavGroup } from './SettingsTabs';

/** Every section, by its stable value. */
export type SettingsTab =
  | 'account'
  | 'appearance'
  | 'date-time'
  | 'tags'
  | 'notifications'
  | 'calendars'
  | 'integrations'
  | 'focus'
  | 'api'
  | 'data'
  | 'admin';

/** The route each section points at. */
export const TAB_HREF: Record<SettingsTab, string> = {
  account: '/settings',
  appearance: '/settings/appearance',
  'date-time': '/settings/date-time',
  tags: '/settings/tags',
  notifications: '/settings/notifications',
  calendars: '/settings/calendars',
  integrations: '/settings/integrations',
  focus: '/settings/focus',
  api: '/settings/api',
  data: '/settings/data-export',
  admin: '/settings/admin',
};

/** The sections, grouped, in the order the primary and sub rows show them. */
export const SECTION_GROUPS: SettingsNavGroup[] = [
  {
    label: 'Personal',
    sections: [
      { value: 'account', label: 'Account', keywords: ['profile', 'name', 'email', 'password', 'sign out'] },
      {
        value: 'appearance',
        label: 'Appearance',
        keywords: ['theme', 'dark', 'light', 'colour', 'color', 'motion', 'animation'],
      },
      {
        value: 'date-time',
        label: 'Date & time',
        keywords: ['timezone', 'time zone', 'week start', 'clock', '24 hour', 'format'],
      },
      { value: 'tags', label: 'Tags', keywords: ['tag', 'tags', 'labels', 'categories'] },
    ],
  },
  {
    label: 'Scheduling',
    sections: [
      { value: 'calendars', label: 'Calendars', keywords: ['caldav', 'ical', 'feed', 'subscribe', 'visibility'] },
      {
        value: 'integrations',
        label: 'Integrations',
        keywords: ['home assistant', 'apprise', 'webhook', 'import', 'ticktick', 'notify'],
      },
      {
        value: 'notifications',
        label: 'Notifications',
        keywords: ['push', 'alerts', 'reminders', 'quiet hours', 'vapid', 'devices'],
      },
    ],
  },
  {
    label: 'Advanced',
    sections: [
      { value: 'focus', label: 'Focus', keywords: ['pomodoro', 'timer', 'break', 'session'] },
      { value: 'data', label: 'Data', keywords: ['export', 'backup', 'download', 'json', 'delete'] },
      { value: 'api', label: 'API', keywords: ['token', 'tokens', 'access', 'automation'] },
      { value: 'admin', label: 'Admin', adminOnly: true, keywords: ['users', 'invite', 'instance'] },
    ],
  },
];

/**
 * The section a pathname represents, or `null` when it is not a section.
 *
 * `usePathname` strips the query string and gives the canonical route, so the
 * reverse of `TAB_HREF` is all that is needed. The legacy `/settings/advanced`
 * alias has no entry in the map — it renders the Focus controls — so it is
 * mapped to Focus explicitly, which also canonicalises on click.
 */
export function sectionForPath(pathname: string): SettingsTab | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (path === '/settings/advanced') return 'focus';
  const entry = (Object.entries(TAB_HREF) as [SettingsTab, string][]).find(([, href]) => href === path);
  return entry ? entry[0] : null;
}
