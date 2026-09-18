'use client';

/**
 * The application frame.
 *
 * ## Layout contract
 *
 * The frame is a fixed-height box (`100dvh`, `overflow: hidden`) whose children
 * own their own scrolling. Nothing scrolls the document. That is what makes the
 * chrome behave like a native nav bar, stops iOS rubber-banding the whole page,
 * and keeps the sidebar and the content column scrolling independently.
 *
 * Desktop is a row: sidebar + content column. Mobile is just the content column,
 * with the bottom navigation pinned over the bottom.
 *
 * ## Breakpoints are CSS, not JavaScript
 *
 * The sidebar and the bottom band use `sx` breakpoints (`display: { xs, lg }`)
 * rather than `useMediaQuery`, for the same reason the previous version used
 * `hidden lg:flex`: the hook resolves after hydration, so a desktop visitor
 * would paint the mobile layout first and then snap to the desktop one. A media
 * query is applied by the engine before first paint, so there is nothing to
 * flash.
 *
 * ## The page header
 *
 * The header belongs to the screen, not to the shell. Every route renders its
 * own Material `AppBar` + `Toolbar` — `TasksView`, `TodayView` and
 * `CalendarToolbar` already do, and the remaining screens replace their old
 * `NavBar` the same way. A second bar up here would stack two titles on every
 * page.
 *
 * What the shell does own is the *contract* for that bar: a screen that would
 * rather have the shell render it publishes its title, leading control and
 * actions through `PageHeader` (see `./PageHeader`), and the shell renders the
 * single `AppBar` below, safe-area inset included. That is the supported path
 * for a screen with a simple header, and it is exactly what the shell's own
 * header is for — a screen must do one or the other, never both.
 */
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import AppBar from '@mui/material/AppBar';
import Badge from '@mui/material/Badge';
import BottomNavigation from '@mui/material/BottomNavigation';
import BottomNavigationAction from '@mui/material/BottomNavigationAction';
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { keyframes } from '@emotion/react';

import AddIcon from '@mui/icons-material/Add';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ChecklistIcon from '@mui/icons-material/Checklist';
import DateRangeIcon from '@mui/icons-material/DateRange';
import GridViewIcon from '@mui/icons-material/GridView';
import ListAltIcon from '@mui/icons-material/ListAlt';
import SearchIcon from '@mui/icons-material/Search';
import SettingsIcon from '@mui/icons-material/Settings';
import TimerIcon from '@mui/icons-material/Timer';
import WbSunnyIcon from '@mui/icons-material/WbSunny';

import { accentHex } from '@/lib/colors';
import { useResource } from '@/lib/store';
import type { BootstrapPayload } from '@/lib/view-types';
import { PageHeaderContext, type PageHeaderContent } from './PageHeader';
import { QuickAddFab } from './QuickAddFab';

type TabValue = 'tasks' | 'calendar' | 'habits' | 'settings';

/** Width of the desktop sidebar. */
const DRAWER_WIDTH = 280;

/**
 * The four destinations, in order.
 *
 * Tasks leads because it is the thing a task app is opened for, and it absorbs
 * the old Today tab: Today is a filter over that list rather than a separate
 * place, so it lives in the list's own filter bar. More is gone too — with
 * four tabs there is nothing left to overflow, and Settings is a destination
 * people actually visit rather than a drawer.
 */
const TAB_ROUTES: Record<TabValue, string> = {
  tasks: '/tasks',
  calendar: '/calendar',
  habits: '/habits',
  settings: '/settings',
};

/** Smart lists, in the order TickTick shows them. */
const SMART_LISTS = [
  { href: '/today', match: '/today', label: 'Today', Icon: WbSunnyIcon, key: 'today' },
  { href: '/tasks?window=next7days', match: '/tasks', label: 'Next 7 days', Icon: DateRangeIcon, key: 'next7days' },
  { href: '/tasks', match: '', label: 'All tasks', Icon: ListAltIcon, key: 'all' },
  { href: '/tasks?window=completed', match: '', label: 'Completed', Icon: CheckCircleIcon, key: 'completed' },
] as const;

const TOOL_LINKS = [
  { href: '/matrix', label: 'Priority matrix', Icon: GridViewIcon },
  { href: '/pomodoro', label: 'Focus timer', Icon: TimerIcon },
  { href: '/search', label: 'Search', Icon: SearchIcon },
] as const;

/** The smart-list filters the Tasks screen exposes, including the old Today tab. */
export const TASK_FILTERS = [
  { value: 'today', label: 'Today' },
  { value: 'next7days', label: 'Next 7 days' },
  { value: 'all', label: 'All' },
  { value: 'completed', label: 'Done' },
] as const;

/**
 * Opacity only, deliberately.
 *
 * Any transform on this wrapper — including the identity matrix a finished
 * animation leaves behind with `fill-mode: both` — makes it the containing block
 * for `position: fixed` descendants. A docked bar inside a route then positions
 * against the content box instead of the viewport. The movement is not worth
 * breaking every fixed element inside it.
 */
const pageIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const { data, isInitialLoading } = useResource<BootstrapPayload>('/api/bootstrap');

  const lists = data?.lists ?? [];
  const calendars = data?.calendars ?? [];
  const agendaCounts = useMemo(() => {
    const agenda = data?.agenda;
    if (!agenda) return { today: 0 };
    return { today: agenda.today.length + agenda.overdue.length };
  }, [data]);

  /** Header content published by the mounted screen, if any. */
  const [published, setPublished] = useState<PageHeaderContent | null>(null);

  const activeTab: TabValue = pathname.startsWith('/calendar')
    ? 'calendar'
    : pathname.startsWith('/habits')
      ? 'habits'
      : pathname.startsWith('/settings')
        ? 'settings'
        : 'tasks';

  /*
   * Prefetch every tab once the shell mounts.
   *
   * The bar used to call `router.push` with nothing prefetched, so every tap was a
   * cold server render — the dynamic route, the session lookup and the RSC
   * payload all had to come back before anything moved. Warm them up and the
   * switch is immediate.
   */
  useEffect(() => {
    for (const href of Object.values(TAB_ROUTES)) router.prefetch(href);
  }, [router]);

  function onTabChange(value: TabValue) {
    router.push(TAB_ROUTES[value]);
  }

  /*
   * Arrow keys move between the tabs, as they did in the previous tab bar.
   * Material's `BottomNavigation` has no built-in roving focus, so the shell
   * keeps it: one tab is in the tab order (the active one) and the arrows move
   * focus between the four.
   */
  function onTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
    if (tabs.length === 0) return;
    event.preventDefault();
    const current = tabs.indexOf(document.activeElement as HTMLElement);
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const next = (((current < 0 ? 0 : current) + delta) % tabs.length + tabs.length) % tabs.length;
    tabs[next]?.focus();
  }

  return (
    <PageHeaderContext.Provider value={setPublished}>
      <Box sx={{ display: 'flex', height: '100dvh', overflow: 'hidden', bgcolor: 'background.default' }}>
        {/* -------------------------------------------------------------- */}
        {/* Sidebar — desktop only, CSS-driven so desktop never flashes mobile */}
        {/* -------------------------------------------------------------- */}
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', lg: 'block' },
            width: DRAWER_WIDTH,
            flexShrink: 0,
            '& .MuiDrawer-paper': {
              position: 'relative',
              width: DRAWER_WIDTH,
              height: '100%',
              boxSizing: 'border-box',
              bgcolor: 'background.paper',
              borderColor: 'divider',
              pt: 'env(safe-area-inset-top, 0px)',
              pb: 'env(safe-area-inset-bottom, 0px)',
            },
          }}
        >
          <Box
            component="aside"
            aria-label="Navigation"
            sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 2, pt: 1.5, pb: 1 }}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 32,
                  height: 32,
                  borderRadius: 1,
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                }}
              >
                <ChecklistIcon fontSize="small" />
              </Box>
              <Typography variant="h6" sx={{ fontWeight: 600, letterSpacing: '-0.01em' }}>
                TaskTick
              </Typography>
            </Box>

            <Box
              component="nav"
              aria-label="Smart lists"
              sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 1, pb: 2 }}
            >
              <List sx={{ py: 0 }}>
                {SMART_LISTS.map((item) => (
                  <SidebarLink
                    key={item.key}
                    href={item.href}
                    label={item.label}
                    icon={<item.Icon fontSize="small" />}
                    active={item.match === pathname && item.key === 'today'}
                    badge={item.key === 'today' && agendaCounts.today ? agendaCounts.today : undefined}
                  />
                ))}
              </List>

              <SidebarSection
                title="Lists"
                action={
                  <IconButton
                    aria-label="New list"
                    size="small"
                    onClick={() => router.push('/tasks?new=list')}
                  >
                    <AddIcon fontSize="small" />
                  </IconButton>
                }
              >
                {isInitialLoading ? (
                  <>
                    <Skeleton variant="rounded" height={32} sx={{ mx: 1, my: 0.5 }} />
                    <Skeleton variant="rounded" height={32} sx={{ mx: 1, my: 0.5 }} />
                  </>
                ) : (
                  lists.map((list) => (
                    <SidebarLink
                      key={list.id}
                      href={`/tasks?list=${list.id}`}
                      label={list.name}
                      icon={
                        list.emoji ? (
                          <Box component="span" sx={{ fontSize: 16, lineHeight: 1 }} aria-hidden>
                            {list.emoji}
                          </Box>
                        ) : (
                          <Box
                            aria-hidden
                            sx={{
                              width: 10,
                              height: 10,
                              borderRadius: '50%',
                              bgcolor: accentHex(list.color),
                            }}
                          />
                        )
                      }
                      badge={list.openTaskCount || undefined}
                    />
                  ))
                )}
              </SidebarSection>

              <SidebarSection title="Calendars">
                {calendars.map((calendar) => (
                  <SidebarLink
                    key={calendar.id}
                    href={`/calendar?calendar=${calendar.id}`}
                    label={calendar.name}
                    icon={
                      <Box
                        aria-hidden
                        sx={{
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          bgcolor: accentHex(calendar.color),
                        }}
                      />
                    }
                    muted={!calendar.isVisible}
                  />
                ))}
              </SidebarSection>

              <SidebarSection title="Tools">
                {TOOL_LINKS.map((item) => (
                  <SidebarLink
                    key={item.href}
                    href={item.href}
                    label={item.label}
                    icon={<item.Icon fontSize="small" />}
                    active={pathname.startsWith(item.href)}
                  />
                ))}
              </SidebarSection>
            </Box>

            <Box sx={{ flexShrink: 0, p: 1, borderTop: 1, borderColor: 'divider' }}>
              <SidebarLink
                href="/settings"
                label="Settings"
                icon={<SettingsIcon fontSize="small" />}
                active={pathname.startsWith('/settings')}
              />
            </Box>
          </Box>
        </Drawer>

        {/* -------------------------------------------------------------- */}
        {/* Content column — its own scroll pane, so the chrome stays put   */}
        {/* -------------------------------------------------------------- */}
        <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
          {/*
           * The header, when the screen asked the shell to render it.
           *
           * `pt` carries the Dynamic Island inset: the app runs installed under
           * `viewport-fit=cover`, so without it the bar slides under the island.
           * The inset is on the bar rather than on the pane below, so a screen
           * that renders its own `AppBar` can never be pushed twice.
           */}
          {published ? (
            <AppBar
              position="static"
              color="default"
              elevation={0}
              sx={{
                flexShrink: 0,
                bgcolor: 'background.default',
                backgroundImage: 'none',
                borderBottom: 1,
                borderColor: 'divider',
                pt: 'env(safe-area-inset-top, 0px)',
              }}
            >
              <Toolbar sx={{ gap: 1 }}>
                {published.leading}

                <Typography variant="h6" component="h1" noWrap sx={{ flex: 1, minWidth: 0 }}>
                  {published.title}
                </Typography>

                {published.actions ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                    {published.actions}
                  </Box>
                ) : null}
              </Toolbar>

              {/* Everything below the title row belongs to the screen. */}
              {published.children}
            </AppBar>
          ) : null}

          <Box
            component="main"
            id="main"
            sx={{
              flex: 1,
              minHeight: 0,
              // `relative` makes the pane the containing block for anything a
              // screen positions absolutely. Without it such an element resolves
              // against the viewport, escapes this box entirely and hands the
              // whole document a horizontal scrollbar. It cannot disturb a
              // screen's `position: fixed` chrome: the pane carries no transform,
              // filter or backdrop-filter, so fixed stays viewport-anchored.
              position: 'relative',
              overflowY: 'auto',
              overscrollBehaviorY: 'contain',
              // Clearance for the floating bottom band on a phone.
              pb: { xs: 'calc(env(safe-area-inset-bottom, 0px) + 5.25rem)', lg: 0 },
            }}
          >
            {/*
             * Keyed on the pathname so React remounts this wrapper on every
             * navigation and the entrance animation replays. Without the key the
             * element persists across routes and the animation runs exactly
             * once, ever — which is the opposite of what it is for.
             *
             * `minHeight: calc(100% + 3rem)` guarantees the pane can always
             * scroll a little, even when the content is shorter than the screen.
             * The search field on the task lists is revealed by an upward
             * scroll, so on a list with three items there was no gesture
             * available to bring it back — the reveal depended on the user
             * having enough tasks, which is not something a control should ever
             * depend on. A small guaranteed overscroll means the gesture exists
             * on every screen at every length.
             */}
            <Box
              key={pathname}
              sx={{ minHeight: 'calc(100% + 3rem)', animation: `${pageIn} 340ms ease-out both` }}
            >
              {children}
            </Box>
          </Box>
        </Box>

        {/*
         * The floating bottom band: bottom navigation and action button sharing
         * one row.
         *
         * One fixed container holding both means they cannot overlap, and it sits
         * just clear of the home indicator rather than floating high above it.
         */}
        <Box
          sx={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 2px)',
            zIndex: (theme) => theme.zIndex.appBar + 1,
            display: { xs: 'flex', lg: 'none' },
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
            px: 1.5,
          }}
        >
          <Paper
            elevation={3}
            sx={{ flex: 1, minWidth: 0, maxWidth: '26.25rem', borderRadius: 4, overflow: 'hidden' }}
          >
            <BottomNavigation
              value={activeTab}
              onChange={(_event, value) => onTabChange(value as TabValue)}
              showLabels
              role="tablist"
              aria-label="Main sections"
              onKeyDown={onTabKeyDown}
              sx={{
                bgcolor: 'transparent',
                height: 64,
                '& .MuiBottomNavigationAction-root': { minWidth: 0, maxWidth: 'none', px: 0.5 },
              }}
            >
              {TABS.map(({ value, label, Icon }) => {
                const active = value === activeTab;
                // The count pill the Tasks tab has always carried: the agenda's
                // today + overdue. Absent on every other tab.
                const badge = value === 'tasks' ? agendaCounts.today || undefined : undefined;
                return (
                  <BottomNavigationAction
                    key={value}
                    value={value}
                    label={label}
                    role="tab"
                    aria-selected={active}
                    tabIndex={active ? 0 : -1}
                    icon={
                      <Badge badgeContent={badge ?? 0} color="error" overlap="circular">
                        <Icon fontSize="small" />
                      </Badge>
                    }
                  />
                );
              })}
            </BottomNavigation>
          </Paper>

          {/*
           * The button is contextual, so its name has to be too. It sits on the
           * calendar and opens the event editor; announcing that as "Add a task"
           * is simply wrong, and now that the agenda's own create button is gone
           * this is the only create affordance on a phone.
           */}
          <QuickAddFab
            label={
              activeTab === 'calendar'
                ? 'New event'
                : activeTab === 'habits'
                  ? 'New habit'
                  : 'Add a task'
            }
          />
        </Box>
      </Box>
    </PageHeaderContext.Provider>
  );
}

// Declared outside the component so the icon components keep a stable identity.
const TABS: {
  value: TabValue;
  label: string;
  Icon: React.ElementType;
  badge?: number;
}[] = [
  { value: 'tasks', label: 'Tasks', Icon: ChecklistIcon },
  { value: 'calendar', label: 'Calendar', Icon: CalendarMonthIcon },
  { value: 'habits', label: 'Habits', Icon: CheckCircleIcon },
  { value: 'settings', label: 'Settings', Icon: SettingsIcon },
];

function SidebarSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <List
      sx={{ py: 0.5 }}
      subheader={
        <ListSubheader
          component="div"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            px: 1,
            bgcolor: 'transparent',
            color: 'text.secondary',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            fontSize: 12,
            fontWeight: 600,
            lineHeight: '32px',
          }}
        >
          <Box
            component="span"
            sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {title}
          </Box>
          {action}
        </ListSubheader>
      }
    >
      {children}
    </List>
  );
}

function SidebarLink({
  href,
  label,
  icon,
  active = false,
  badge,
  muted = false,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  badge?: number;
  muted?: boolean;
}) {
  return (
    <ListItemButton
      component={Link}
      href={href}
      selected={active}
      aria-current={active ? 'page' : undefined}
      sx={{ borderRadius: 1, gap: 1.25, color: muted ? 'text.disabled' : 'text.primary' }}
    >
      <ListItemIcon sx={{ minWidth: 0, width: 20, justifyContent: 'center', color: 'inherit' }}>
        {icon}
      </ListItemIcon>
      <ListItemText
        primary={label}
        sx={{
          my: 0,
          minWidth: 0,
          '& .MuiListItemText-primary': {
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          },
        }}
      />
      {badge ? (
        <Typography
          variant="caption"
          sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}
        >
          {badge}
        </Typography>
      ) : null}
    </ListItemButton>
  );
}
