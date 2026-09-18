'use client';

/**
 * Settings: the index.
 *
 * The rule this page follows is that the things you change often live inline
 * (appearance, time zone, clock format) and the things you configure once get
 * their own screen (calendars, notifications, focus, admin). Everything here is
 * a real write against `/api/settings` or `/api/bootstrap`; nothing is a mock.
 *
 * The header is owned by the app shell: this page publishes its title through
 * `PageHeader` (see `@/components/app/PageHeader`) rather than stacking a second
 * bar under the shell's, which is what keeps one title row, one safe-area inset
 * and one elevation across every screen.
 */
import Link from 'next/link';
import Box from '@mui/material/Box';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloudIcon from '@mui/icons-material/Cloud';
import GridViewIcon from '@mui/icons-material/GridView';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import SearchIcon from '@mui/icons-material/Search';
import ShieldIcon from '@mui/icons-material/Shield';
import SpaIcon from '@mui/icons-material/Spa';
import TimerIcon from '@mui/icons-material/Timer';
import { PageHeader } from '@/components/app/PageHeader';
import { useResource } from '@/lib/store';
import { AccountSettings } from '@/components/settings/AccountSettings';
import { AppearanceSettings } from '@/components/settings/AppearanceSettings';
import { DateTimeSettings } from '@/components/settings/DateTimeSettings';
import { SettingsGroup } from '@/components/settings/SettingsGroup';
import type { BootstrapPayload } from '@/lib/view-types';

export default function SettingsPage() {
  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');
  const data = bootstrap.data;

  return (
    <Box sx={{ pb: 4 }}>
      {/* No back control: Settings is a top-level destination, reached from the
          sidebar and from the tab bar. */}
      <PageHeader title="Settings" />

      {!data ? (
        <Stack spacing={2} sx={{ px: 2, pt: 1 }}>
          <Skeleton variant="rounded" height={96} />
          <Skeleton variant="rounded" height={128} />
          <Skeleton variant="rounded" height={96} />
        </Stack>
      ) : (
        <>
          <AccountSettings user={data.user} />
          <AppearanceSettings />
          <DateTimeSettings settings={data.settings} />

          <SettingsGroup title="Calendars and sync" footer="CalDAV accounts, local calendars and read-only feeds.">
            <SectionLink
              href="/settings/calendars"
              icon={<CloudIcon />}
              title="Calendars"
              subtitle="Accounts, colours, subscriptions"
            />
          </SettingsGroup>

          <SettingsGroup title="Notifications">
            <SectionLink
              href="/settings/notifications"
              icon={<NotificationsActiveIcon />}
              title="Push and reminders"
              subtitle={`${data.capabilities.push ? 'Push available' : 'Push not configured'} · reminders ${data.settings.notificationsEnabled ? 'on' : 'off'}`}
            />
          </SettingsGroup>

          <SettingsGroup title="Focus and data" footer="Pomodoro lengths, export and offline behaviour.">
            <SectionLink
              href="/settings/advanced"
              icon={<SpaIcon />}
              title="Focus and advanced"
              subtitle={`${data.settings.pomodoroFocus} min focus · ${data.settings.pomodoroLongBreakEvery} sessions per long break`}
            />
          </SettingsGroup>

          {/*
           * Tools is the phone's only door to the matrix, the focus timer and
           * search: they used to live behind the tab bar's "More" sheet, which
           * is gone, and the desktop sidebar is not on a phone. On mobile this
           * group is therefore load-bearing, not a convenience.
           */}
          <SettingsGroup title="Tools" footer="Also in the desktop sidebar.">
            <SectionLink
              href="/matrix"
              icon={<GridViewIcon />}
              title="Priority matrix"
              subtitle="Urgent and important, at a glance"
            />
            <SectionLink href="/pomodoro" icon={<TimerIcon />} title="Focus timer" subtitle="Pomodoro sessions" />
            <SectionLink href="/search" icon={<SearchIcon />} title="Search" subtitle="Tasks, events and habits" />
          </SettingsGroup>

          {data.user.isAdmin ? (
            <SettingsGroup title="Instance" footer="Only administrators see this section.">
              <SectionLink
                href="/settings/admin"
                icon={<ShieldIcon />}
                title="Users and invitations"
                subtitle="Invite people, promote or disable accounts"
              />
            </SettingsGroup>
          ) : null}
        </>
      )}
    </Box>
  );
}

/** One navigational settings row: an icon, two lines and a chevron. */
function SectionLink({
  href,
  icon,
  title,
  subtitle,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <ListItemButton component={Link} href={href}>
      <ListItemIcon sx={{ minWidth: 40, color: 'primary.main' }}>{icon}</ListItemIcon>
      <ListItemText primary={title} secondary={subtitle} />
      <ChevronRightIcon fontSize="small" aria-hidden sx={{ color: 'text.disabled' }} />
    </ListItemButton>
  );
}
