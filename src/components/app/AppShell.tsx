'use client';

/**
 * The application frame.
 *
 * ## Layout contract
 *
 * The frame is a fixed-height box (`100dvh`, `overflow-hidden`) whose children
 * own their own scrolling. Nothing scrolls the document. That is what makes the
 * chrome behave like a native nav bar, stops iOS rubber-banding the whole page,
 * and keeps the sidebar and the content column scrolling independently.
 *
 * Desktop is a row: sidebar + content column. Mobile is just the content column,
 * with the bottom band — the GodUI `TabBar` and the action button — pinned over
 * the bottom. The desktop sidebar is `lg` and up, and the band is everything
 * below it.
 *
 * ## Breakpoints are CSS, not JavaScript
 *
 * The sidebar and the bottom band are hidden with `hidden lg:flex` / `lg:hidden`
 * rather than with `useMediaQuery`, deliberately: a media query is applied by
 * the engine before first paint, so a desktop visitor never paints the mobile
 * layout and then snaps to the desktop one. There is nothing to flash.
 *
 * ## Safe-area insets
 *
 * The app runs installed, under `viewport-fit=cover`, so the viewport starts at
 * the physical screen edge. The top app bar carries
 * `pt-[env(safe-area-inset-top)]` and the bottom band carries
 * `pb-[env(safe-area-inset-bottom)]`; without them the header slides under the
 * Dynamic Island and the tab bar under the home indicator. The insets resolve
 * to `0px` off-device, so they are safe to apply unconditionally, and they live
 * on the chrome — not on the scroll pane — so a screen that renders its own
 * header can never be pushed twice.
 *
 * ## The page header
 *
 * The header belongs to the screen, not to the shell. A screen publishes its
 * title, leading control and actions through `PageHeader` (see `./PageHeader`)
 * and the shell renders the single top app bar below. That is how the inset,
 * the border and the title position stay identical everywhere. A screen that
 * would rather render its own header simply publishes nothing, and the shell
 * renders no bar at all — a screen must do one or the other, never both, or two
 * titles stack on every page.
 *
 * ## Spacing
 *
 * Every margin, padding and gap below comes from the layout tokens (`px-gutter`,
 * `gap-stack`, `px-row`, `h-appbar`) or from Tailwind's own scale. Nothing is
 * invented, which is the point of the migration — see `GODUI-CONVENTIONS.md`.
 * The sidebar's sections are one `flex flex-col gap-stack`, so the rhythm
 * between them is stated once rather than repeated as a bottom margin on each.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { BarChartIcon } from '@svg-animated-icons/react/bar-chart';
import { CalendarIcon } from '@svg-animated-icons/react/calendar';
import { CheckCircledIcon } from '@svg-animated-icons/react/check-circled';
import { CheckboxIcon } from '@svg-animated-icons/react/checkbox';
import { DashboardIcon } from '@svg-animated-icons/react/dashboard';
import { GearIcon } from '@svg-animated-icons/react/gear';
import { HeartIcon } from '@svg-animated-icons/react/heart';
import { ListBulletIcon } from '@svg-animated-icons/react/list-bullet';
import { MagnifyingGlassIcon } from '@svg-animated-icons/react/magnifying-glass';
import { PlusIcon } from '@svg-animated-icons/react/plus';
import { SunIcon } from '@svg-animated-icons/react/sun';
import { TimerIcon } from '@svg-animated-icons/react/timer';

import { requestSectionReset } from '@/components/calendar/section-reset';
import { TabBar } from '@/components/godui/tab-bar';
import { useServiceWorkerControl } from '@/components/pwa/useServiceWorkerControl';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { accentHex } from '@/lib/colors';
import { whenScopeReady } from '@/lib/session-scope';
import { useResource } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { BootstrapPayload } from '@/lib/view-types';
import { DemoModeBanner } from '@/components/settings/DemoModeCard';
import { PageHeaderContext, type PageHeaderContent } from './PageHeader';
import { ShellPaneContext } from './ShellPane';
import { QuickAddFab } from './QuickAddFab';
import { BOTTOM_BAND_CLEARANCE } from './chrome';

/** The app's four destinations. */
type AppTabValue = 'tasks' | 'calendar' | 'habits' | 'settings';

/**
 * Period mode's four destinations.
 *
 * The values are prefixed because they share one selection model with the app's
 * tabs (`activeTab`, `pendingTab`, the roving focus), and `settings` meaning two
 * different routes depending on the mode is exactly the kind of aliasing that
 * breaks silently.
 */
type PeriodTabValue = 'period-today' | 'period-cycle' | 'period-insights' | 'period-settings';

type TabValue = AppTabValue | PeriodTabValue;

/**
 * The app's four destinations, in order.
 *
 * Tasks leads because it is the thing a task app is opened for, and it absorbs
 * the old Today tab: Today is a filter over that list rather than a separate
 * place, so it lives in the list's own filter bar. More is gone too — with four
 * tabs there is nothing left to overflow, and Settings is a destination people
 * actually visit rather than a drawer.
 */
const APP_TAB_ROUTES: Record<AppTabValue, string> = {
  tasks: '/tasks',
  calendar: '/calendar',
  habits: '/habits',
  settings: '/settings',
};

/**
 * The period interface's four destinations.
 *
 * Deliberately the same count as the app's: the pill is four slots wide at
 * 390px, and a fifth would either wrap or shrink the tap targets the bottom band
 * exists to keep large. Today leads because logging today is what the mode is
 * opened to do, and `/period` lands there.
 *
 * There is no task/calendar/habit destination here. The user was explicit that
 * enabling this *replaces* the navigation rather than extending it, so the
 * normal app is not a tab in this set — it is behind the way back on the period
 * Settings screen, which this set always reaches (the Settings tab).
 */
const PERIOD_TAB_ROUTES: Record<PeriodTabValue, string> = {
  'period-today': '/period',
  'period-cycle': '/period/calendar',
  'period-insights': '/period/insights',
  'period-settings': '/period/settings',
};

/**
 * The prefix every period route shares.
 *
 * The mode applies to these routes and no others. That is what makes the exit
 * non-destructive: leaving the period interface to look at `/tasks` shows the
 * app's own navigation on that screen, while the account's preference is
 * untouched, so the next visit (or a cold start on `/`) lands back in the mode.
 * A mode that also replaced the navigation over the task list would leave the
 * user scrolling tasks under a tab bar where nothing they can see is selected.
 */
const PERIOD_ROUTE_PREFIX = '/period';

/** The tab a pathname selects in the app's own chrome. */
function appRouteTab(pathname: string): AppTabValue {
  if (pathname.startsWith('/calendar')) return 'calendar';
  if (pathname.startsWith('/habits')) return 'habits';
  if (pathname.startsWith('/settings')) return 'settings';
  return 'tasks';
}

/** The tab a pathname selects in period mode's chrome. */
function periodRouteTab(pathname: string): PeriodTabValue {
  if (pathname.startsWith('/period/calendar')) return 'period-cycle';
  if (pathname.startsWith('/period/insights')) return 'period-insights';
  if (pathname.startsWith('/period/settings')) return 'period-settings';
  return 'period-today';
}

/** Smart lists, in the order TickTick shows them. */
const SMART_LISTS = [
  { href: '/today', match: '/today', label: 'Today', Icon: SunIcon, key: 'today' },
  { href: '/tasks?window=next7days', match: '/tasks', label: 'Next 7 days', Icon: CalendarIcon, key: 'next7days' },
  { href: '/tasks', match: '', label: 'All tasks', Icon: ListBulletIcon, key: 'all' },
  { href: '/tasks?window=completed', match: '', label: 'Completed', Icon: CheckCircledIcon, key: 'completed' },
] as const;

const TOOL_LINKS = [
  { href: '/matrix', label: 'Priority matrix', Icon: DashboardIcon },
  { href: '/pomodoro', label: 'Focus timer', Icon: TimerIcon },
  { href: '/search', label: 'Search', Icon: MagnifyingGlassIcon },
] as const;

/** The smart-list filters the Tasks screen exposes, including the old Today tab. */
export const TASK_FILTERS = [
  { value: 'today', label: 'Today' },
  { value: 'next7days', label: 'Next 7 days' },
  { value: 'all', label: 'All' },
  { value: 'completed', label: 'Done' },
] as const;

/**
 * The four tabs, declared outside the component so the icon elements keep a
 * stable identity across renders.
 *
 * The icons are the animated set. Those paint at `1em`, so a font-size utility
 * is what actually sizes them; `size-5` is carried alongside as the same 20px,
 * so the glyph is 20px whichever declaration the cascade picks. `TabBar`
 * reserves exactly `h-5 w-5` for the glyph, so 20px is the size that fits.
 */
const APP_TABS: { value: AppTabValue; label: string; icon: React.ReactNode }[] = [
  { value: 'tasks', label: 'Tasks', icon: <CheckboxIcon className="size-5 text-xl" /> },
  { value: 'calendar', label: 'Calendar', icon: <CalendarIcon className="size-5 text-xl" /> },
  { value: 'habits', label: 'Habits', icon: <CheckCircledIcon className="size-5 text-xl" /> },
  { value: 'settings', label: 'Settings', icon: <GearIcon className="size-5 text-xl" /> },
];

/**
 * Period mode's tabs — the same four slots, a different interface.
 *
 * Same icon sizing contract as `APP_TABS`: the animated icons paint at `1em`, so
 * the font-size utility is what sizes them and `size-5` names the same 20px the
 * `TabBar` reserves.
 *
 * The labels are the interface's own words: "Today" is the log screen (not the
 * app's Today filter), "Cycle" is the month, "Insights" is the predictions. The
 * second tab is not called "Calendar" because tapping it does not give you the
 * calendar — it gives you the cycle month, and the user should be able to tell
 * the two apart from the label alone.
 */
const PERIOD_TABS: { value: PeriodTabValue; label: string; icon: React.ReactNode }[] = [
  { value: 'period-today', label: 'Today', icon: <SunIcon className="size-5 text-xl" /> },
  { value: 'period-cycle', label: 'Cycle', icon: <CalendarIcon className="size-5 text-xl" /> },
  { value: 'period-insights', label: 'Insights', icon: <BarChartIcon className="size-5 text-xl" /> },
  { value: 'period-settings', label: 'Settings', icon: <GearIcon className="size-5 text-xl" /> },
];

/**
 * Period mode's destinations as the desktop rail states them.
 *
 * The rail has room for a second line, so it uses the fuller name than the
 * band's one-word label. Same four values, so the two can never disagree about
 * where a destination points.
 */
const PERIOD_RAIL: { value: PeriodTabValue; label: string; Icon: typeof SunIcon }[] = [
  { value: 'period-today', label: 'Log today', Icon: SunIcon },
  { value: 'period-cycle', label: 'Cycle calendar', Icon: CalendarIcon },
  { value: 'period-insights', label: 'Insights', Icon: BarChartIcon },
];

/**
 * The primary action the bottom band offers, per tab.
 *
 * Only a tab whose screen subscribes to `requestPrimaryAction` appears here: an
 * entry without a listener is a button that renders and does nothing, which is
 * the failure this map exists to prevent. Settings has no entry — nothing on
 * that tab subscribes — so there the band falls back to the tab bar alone.
 *
 * Habits was missing from this for a while on purpose: the screen carried its
 * own "New habit" button in its header, so the band's was a duplicate. The
 * header's is gone, so the entry is back and the action is stated once.
 */
/**
 * Period mode has no entry, and that is the decision rather than an omission.
 *
 * Everything the mode creates is created on the screen that shows it: a day's
 * log is the Today screen itself, and a past day is opened by tapping it in the
 * cycle month. A floating "+ " over the bottom of a one-handed form would cover
 * the controls it is supposed to complement, and a button that only re-opens the
 * screen you are already on is the dead button this map exists to prevent. So in
 * period mode the band falls back to the tab bar alone, exactly as Settings does
 * today.
 */
const PRIMARY_ACTION_LABEL: Partial<Record<TabValue, string>> = {
  tasks: 'Add a task',
  calendar: 'New event',
  habits: 'New habit',
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const { data, isInitialLoading } = useResource<BootstrapPayload>('/api/bootstrap');

  /*
   * The mode, and where it applies.
   *
   * The chrome follows the **route**, not the account's switch. That is the
   * "separate interface" contract with nothing left to interpret: `/period/*` is
   * the period interface and every other route is the app. Leaving to `/tasks`
   * therefore shows the app's own navigation on that screen, and nothing about the
   * account's preference is touched by going there.
   *
   * It is also the honest thing to render. The shell is the frame around whatever
   * the URL resolves to, so deriving the tabs from a *setting* means the frame can
   * disagree with the page inside it — and it did: the settings read is cached, so
   * for the few hundred milliseconds after the switch was flipped the shell still
   * held `enabled: false` and painted the task tabs over the period screen the user
   * had just opened. A frame must never be a moment behind its own route.
   *
   * Whether a period route *should* be reachable is a separate question, and it is
   * the period layout's: a stale deep link into a disabled mode is bounced to
   * `/tasks` there (see `app/(app)/period/layout.tsx`) before any screen can write
   * anything.
   */
  const periodMode = pathname.startsWith(PERIOD_ROUTE_PREFIX);

  /* The destinations the band and the rail show, in the mode this screen is in. */
  const tabs = periodMode ? PERIOD_TABS : APP_TABS;
  const tabRoutes: Record<string, string> = periodMode ? PERIOD_TAB_ROUTES : APP_TAB_ROUTES;

  const lists = data?.lists ?? [];
  const calendars = data?.calendars ?? [];
  const agendaCounts = useMemo(() => {
    const agenda = data?.agenda;
    if (!agenda) return { today: 0 };
    return { today: agenda.today.length + agenda.overdue.length };
  }, [data]);

  /** Header content published by the mounted screen, if any. */
  const [published, setPublished] = useState<PageHeaderContent | null>(null);
  /* A screen has asked to own its own scrolling — see `ShellPane`. */
  const [paneFullHeight, setPaneFullHeight] = useState(false);

  /*
   * The key that drives the route fade. Settings is one destination with a
   * dozen sub-routes; keying on the full pathname replayed the whole-pane
   * fade every time a section was chosen. Over the translucent, blurred tab
   * bar that reads as the page ghosting in, which is the "blur" on settings
   * navigation. The settings sub-routes share one key, so they switch without
   * replaying the fade; a move between destinations still does.
   *
   * The period settings are the same shape — a pinned two-row nav with a
   * section per sub-route — so they share one key too. Without this the nav
   * itself would remount and replay the fade under the finger on every section
   * tap.
   */
  const contentKey = pathname.startsWith('/settings')
    ? '/settings'
    : pathname.startsWith('/period/settings')
      ? '/period/settings'
      : pathname;

  const routeTab: TabValue = periodMode ? periodRouteTab(pathname) : appRouteTab(pathname);

  /*
   * The tab responds to the tap, not to the route.
   *
   * The bar derived its active tab purely from `pathname`, so pressing a tab
   * produced *no* visible change until the navigation committed — the blob, the
   * label and the action button all moved together a beat after the press.
   * Measured locally that beat is 33-90ms; on a phone over a real network it is
   * several times that, and an interface that acknowledges a press late reads as
   * broken however fast the navigation underneath actually is.
   *
   * So a tap records the tab it asked for and the bar renders *that* until the
   * route catches up, at which point the pending value is dropped and the
   * pathname is the only source of truth again. It cannot drift: the pending
   * value is only ever the tab whose route has not committed yet.
   */
  const [pendingTab, setPendingTab] = useState<TabValue | null>(null);
  const activeTab: TabValue = pendingTab ?? routeTab;

  /*
   * The band's action for the current tab, read once so the name and the
   * decision to render it cannot disagree.
   */
  const primaryActionLabel = PRIMARY_ACTION_LABEL[activeTab];

  useEffect(() => {
    if (pendingTab && routeTab === pendingTab) setPendingTab(null);
  }, [pendingTab, routeTab]);

  /*
   * A mode change drops any half-committed tap.
   *
   * The pending value names a slot of the *other* set — it can be neither
   * rendered nor matched once the chrome swaps — so leaving it set would keep the
   * band from acknowledging the route it is actually on for as long as the
   * navigation takes.
   */
  useEffect(() => {
    setPendingTab(null);
  }, [periodMode]);

  /*
   * Prefetch every tab, but only once the worker can keep the payload.
   *
   * The bar used to call `router.push` with nothing prefetched, so every tap was a
   * cold server render — the dynamic route, the session lookup and the RSC
   * payload all had to come back before anything moved. Warm them up and the
   * switch is immediate.
   *
   * Where the warm-up happens is load-bearing for offline, though. The prefetch
   * request is what lets the worker store a route's RSC payload, and the worker
   * stores nothing until it (a) is controlling this page and (b) knows which
   * session the payload belongs to. Run on mount, as this used to, and both are
   * usually still false: the page starts before the worker claims it, and the
   * session is only announced after `/api/auth/get-session` answers. The
   * prefetches then go straight through the network without ever being cached,
   * and a tab tap with no signal has no payload to render — the URL changes and
   * the old screen stays.
   *
   * So the prefetch waits for `useServiceWorkerControl()` and `whenScopeReady()`,
   * and is deliberately NOT also run on mount: Next keeps a prefetch in its
   * router cache and a second `router.prefetch` of a fresh entry is a no-op, so
   * an early one would poison the cache and the later, cacheable prefetch would
   * never happen. It still runs at most once per control change.
   */
  const workerControlled = useServiceWorkerControl();
  useEffect(() => {
    if (!workerControlled) return;
    let cancelled = false;
    void whenScopeReady().then(() => {
      if (cancelled) return;
      for (const href of Object.values(tabRoutes)) router.prefetch(href);
    });
    return () => {
      cancelled = true;
    };
  }, [workerControlled, router, tabRoutes]);

  function onTabChange(value: string) {
    const next = value as TabValue;
    /*
     * Re-tapping the tab you are already on does not navigate, but on the two
     * sections that have a "today" it means "take me back to the start of this
     * one". The shell is the only thing that sees the tap, so the shell is what
     * announces it; whichever screen is mounted answers through
     * `useSectionReset`. Only Calendar and Habits have a today to return to —
     * Tasks and Settings ignore the event.
     *
     * This is the half that was missing twice: the screens listened, but the
     * early return below meant the announcement was never raised, so a re-tap
     * did nothing at all.
     */
    if (next === routeTab) {
      if (next === 'calendar' || next === 'habits' || next === 'period-cycle') {
        requestSectionReset(next);
      }
      return;
    }
    setPendingTab(next);
    router.push(tabRoutes[next] ?? APP_TAB_ROUTES.tasks);
  }

  /*
   * Roving tabindex.
   *
   * One tab is in the tab order — the active one — and the arrow keys move
   * focus across the four, exactly as the previous bar did. The vendored
   * `TabBar` renders its own buttons and takes no per-tab `tabIndex`, and
   * `components/godui` is upstream source we do not fork, so the index is
   * applied to the rendered buttons here. The DOM order is the `TABS` order, so
   * the two stay in step without a second source of truth.
   */
  const tabBarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const buttons = tabBarRef.current?.querySelectorAll('button');
    if (!buttons) return;
    buttons.forEach((button, index) => {
      const active = tabs[index]?.value === activeTab;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
  }, [activeTab, tabs]);

  /** Arrow keys move between the tabs, as they did in the previous tab bar. */
  function onTabKeyDown(event: KeyboardEvent<HTMLElement>) {
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
      <ShellPaneContext.Provider value={setPaneFullHeight}>
      <div className="flex h-dvh overflow-hidden bg-background text-foreground">
        {/* -------------------------------------------------------------- */}
        {/* Sidebar — desktop only, CSS-driven so desktop never flashes mobile */}
        {/* -------------------------------------------------------------- */}
        <aside
          aria-label="Navigation"
          className="hidden w-70 shrink-0 flex-col border-r border-sidebar-border bg-sidebar pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] lg:flex"
        >
          <div className="flex items-center gap-2 px-row pt-3 pb-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground [&_svg]:size-5">
              {periodMode ? <HeartIcon /> : <CheckboxIcon />}
            </span>
            <span className="text-lg font-semibold tracking-tight">{periodMode ? 'Period' : 'TaskTick'}</span>
          </div>

          {/*
           * The whole rail is one scroll pane and one vertical rhythm: the gap
           * between sections lives here, on the `gap-stack`, rather than as a
           * margin on each section's last row.
           */}
          <nav
            aria-label={periodMode ? 'Period sections' : 'Smart lists'}
            className="flex min-h-0 flex-1 flex-col gap-stack overflow-y-auto px-2 pb-4"
          >
            {/* The rail is the same shape in both modes — sections of real
                links — so the mode swaps its contents and nothing else. */}
            {periodMode ? (
              <PeriodRail activeTab={activeTab as PeriodTabValue} />
            ) : (
              <>
            <div className="flex flex-col gap-0.5">
              {SMART_LISTS.map((item) => (
                <SidebarLink
                  key={item.key}
                  href={item.href}
                  label={item.label}
                  icon={<item.Icon />}
                  active={item.match === pathname && item.key === 'today'}
                  badge={item.key === 'today' && agendaCounts.today ? agendaCounts.today : undefined}
                />
              ))}
            </div>

            <SidebarSection
              title="Lists"
              action={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="New list"
                  onClick={() => router.push('/tasks?new=list')}
                >
                  <PlusIcon className="size-4 text-base" />
                </Button>
              }
            >
              {isInitialLoading ? (
                <>
                  <Skeleton className="h-8 rounded-md" />
                  <Skeleton className="h-8 rounded-md" />
                </>
              ) : (
                lists.map((list) => (
                  <SidebarLink
                    key={list.id}
                    href={`/tasks?list=${list.id}`}
                    label={list.name}
                    icon={
                      list.emoji ? (
                        <span aria-hidden className="text-base leading-none">
                          {list.emoji}
                        </span>
                      ) : (
                        <span
                          aria-hidden
                          className="size-2.5 rounded-full"
                          style={{ backgroundColor: accentHex(list.color) }}
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
                    <span
                      aria-hidden
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: accentHex(calendar.color) }}
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
                  icon={<item.Icon />}
                  active={pathname.startsWith(item.href)}
                />
              ))}
            </SidebarSection>
              </>
            )}
          </nav>

          {/*
           * The rail's foot: the app's own Settings row, in the same place as
           * always. In period mode there is nothing here — the only way out of
           * the mode is the period Settings section (see `PeriodRail`), which is
           * one row up, exactly where the app's Settings row lives. The mode's
           * own navigation always reaches it, so the foot is never a way to
           * switch interfaces behind the user's back.
           */}
          {periodMode ? null : (
            <div className="shrink-0 border-t border-sidebar-border p-2">
              <SidebarLink
                href="/settings"
                label="Settings"
                icon={<GearIcon />}
                active={pathname.startsWith('/settings')}
              />
            </div>
          )}
        </aside>

        {/* -------------------------------------------------------------- */}
        {/* Content column — its own scroll pane, so the chrome stays put   */}
        {/* -------------------------------------------------------------- */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/*
           * The header, when the screen asked the shell to render it. `pt`
           * carries the Dynamic Island inset, so the title clears the island
           * instead of sliding under it.
           */}
          {published || periodMode ? (
            <header className="shrink-0 bg-background pt-[env(safe-area-inset-top)]">
              <DemoModeBanner />
              <div className="flex h-appbar items-center gap-2 px-gutter">
                {published ? published.leading : null}

                <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">
                  {published ? published.title : 'Period'}
                </h1>

                {published?.actions ? (
                  <div className="flex shrink-0 items-center gap-1">{published.actions}</div>
                ) : null}
              </div>

              {/* Everything below the title row belongs to the screen. */}
              {published?.children}
            </header>
          ) : null}

          <main
            id="main"
            className={cn(
              'relative min-h-0 flex-1',
              paneFullHeight
                ? // The screen scrolls its own list; the pane must not scroll too,
                  // or the grid it is keeping in place travels with the page.
                  'overflow-hidden'
                : 'overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom)_+_5.375rem)] lg:pb-0',
            )}
          >
            {/*
             * Keyed so React remounts this wrapper when the destination
             * changes and the entrance animation replays. Without the key the
             * element persists across routes and the animation runs exactly
             * once, ever — which is the opposite of what it is for. The key is
             * `contentKey` (see above): the settings sub-routes share one key,
             * so choosing a settings section swaps the page without replaying
             * the fade over the blurred chrome.
             *
             * The fade is a CSS animation, not a `motion.div`. It was a
             * framer-motion opacity animation at 0.34s, and that cost the user
             * twice over:
             *
             *  - framer-motion renders its `initial` opacity 0 as an inline
             *    `style="opacity:0"` in the server-rendered HTML, so a cold
             *    load painted the *entire page content* invisible and only
             *    revealed it once the JS had hydrated and an animation had run.
             *    A CSS animation starts with the first paint and needs no JS at
             *    all, so the content is never held hostage by the bundle. This
             *    is measurable: the wrapper is at opacity 1 about a second
             *    earlier at 6× CPU throttle on a cold load (see the item
             *    report).
             *  - an opacity animation driven from the main thread competes with
             *    the route's own first render and its effects, exactly when the
             *    main thread is busiest. `animate-in fade-in` is the same fade
             *    vocabulary the dialogs already use, and opacity runs on the
             *    compositor, so the frame budget belongs to the page.
             *
             * 150ms rather than 340ms: a destination change is the most common
             * gesture in the app and the fade is the last thing between the tap
             * and legible content. It is still a fade, just not one the user
             * waits on. Measured in the page: the opacity ramps 0 -> 1 over
             * 163ms of wall clock, and it is the same `enter` animation the
             * dialogs close and open over.
             *
             * Nothing moves: `fade-in` only sets the animation's start opacity,
             * and the keyframes leave translate and scale at their identity
             * (`matrix(1, 0, 0, 1, 0, 0)` for the 150ms it runs, `none` after).
             * An identity transform is still a transform, so for those 150ms
             * this wrapper *is* a containing block for `position: fixed`
             * descendants. The only fixed element a route can hold today is the
             * calendar's drag ghost, which exists only while an event is being
             * dragged and so can never span a navigation; the app's own fixed
             * chrome (the band, the bottom fade, the toaster) is a sibling of
             * `main`, not a descendant. If a route ever docks a fixed bar of its
             * own, this fade is what to revisit.
             *
             * `min-h-[calc(100%_+_3rem)]` guarantees the pane can always scroll
             * a little, even when the content is shorter than the screen. The
             * search field on the task lists is revealed by an upward scroll, so
             * on a list with three items there was no gesture available to bring
             * it back — the reveal depended on the user having enough tasks,
             * which is not something a control should ever depend on.
             *
             * `gap-stack` is the page's vertical rhythm, stated once here rather
             * than repeated as a bottom margin on every card a screen renders.
             * The horizontal gutter is deliberately *not* applied here: the
             * calendar grid is full-bleed and the shell cannot know which
             * screens are.
             */}
            <div
              key={contentKey}
              className={cn(
                'flex animate-in flex-col gap-stack fade-in duration-150 ease-out',
                paneFullHeight ? 'h-full' : 'min-h-[calc(100%_+_3rem)]',
              )}
            >
              {children}
            </div>
          </main>
        </div>

        {/*
         * The bottom fade. The panes above scroll their content under the fixed
         * band, and without this the last row collides with the chrome at a
         * hard edge. The gradient runs to the page background so the content
         * dissolves before it reaches the pill; it is `pointer-events-none` so
         * it never eats a tap, `z-sticky` so it sits over the content but under
         * the `z-appbar` band, and `lg:hidden` because there is no band above
         * `lg`. Sheets and popups are `z-modal`, so they are never faded.
         *
         * The timed part (`animate-in fade-in`) is `tw-animate-css`, the same
         * fade vocabulary the dialogs and popovers use; there is no persistent
         * fade utility in that package, so the gradient is what stays.
         */}
        <div
          aria-hidden
          className="pointer-events-none fixed inset-x-0 bottom-0 z-sticky h-20 animate-in bg-linear-to-t from-background to-transparent fade-in duration-200 lg:hidden"
        />

        {/*
         * The floating bottom band: bottom navigation and action button sharing
         * one row.
         *
         * One fixed container holding both means they cannot overlap, and the
         * home-indicator inset is padding on the band rather than an offset on
         * each child, so the two stay on one baseline.
         *
         * The bar now sizes to its content — no `flex-1`, no `max-w-*` — because
         * stretching it left dead space beside the icons that moved with the
         * active tab's label. `justify-between` anchors the pill to the left
         * gutter and the action button to the right one, so neither edge jumps
         * when the label changes width; `justify-center` inside the pill still
         * centres the four tabs when the widest label is selected.
         *
         * The band sits `bottom-0.5` (2px) off the viewport edge, which with the
         * pill's own 2px of padding is a **4px** visible gap.
         *
         * It was `bottom-0` — a 2px gap — and was then lifted to `bottom-3.5`, a
         * 16px gap, by a misreading of "move the navbar up by about 25%": 25% of
         * the pill's own 58px height is 14.5px, which is not what was meant and
         * was plainly too high. The figure the user gave is a 4px gap, which is
         * 2px more than the original rather than 14px more. The offset is on the
         * container, not folded into the safe-area padding: padding of
         * `max(1rem, env(...))` would be swallowed by the inset on a phone with a
         * home indicator, so the bar would not move there at all. The pane
         * reservations below move with it.
         */}
        <div
          className={cn(
            'fixed inset-x-0 bottom-0.5 z-appbar flex items-center justify-between gap-2 px-gutter lg:hidden',
            BOTTOM_BAND_CLEARANCE,
          )}
        >
          <TabBar
            ref={tabBarRef}
            tabs={tabs}
            value={activeTab}
            onChange={onTabChange}
            role="tablist"
            aria-label={periodMode ? 'Period sections' : 'Main sections'}
            onKeyDown={onTabKeyDown}
            className="min-w-0 justify-center"
          />

          {/*
           * The button is contextual, so both its name and whether it belongs
           * on the screen are — both come from `PRIMARY_ACTION_LABEL`.
           *
           * It dispatches `requestPrimaryAction`, which whichever screen is
           * mounted handles. Tasks, Calendar and Habits each subscribe and each
           * names the object it creates; Settings subscribes to nothing, so on
           * that tab the button was dead and is not rendered at all. The band
           * then falls back to the tab bar alone.
           *
           * Habits used to be excluded with Settings — see the map above for
           * why it is not any more.
           */}
          {primaryActionLabel ? <QuickAddFab label={primaryActionLabel} /> : null}
        </div>
      </div>
      </ShellPaneContext.Provider>
    </PageHeaderContext.Provider>
  );
}

/**
 * The desktop rail's period sections.
 *
 * The same four destinations as the band, in the same order, with the fuller
 * names the rail's width allows. The way back to the task interface is not a
 * separate control here — it lives on the Period settings screen, which this
 * rail always carries one row below.
 *
 * "Period settings" sits under its own caption rather than in the Period
 * section, because it is a different kind of destination — the other three are
 * places to look at the cycle, and this one is where the mode's own behaviour is
 * configured.
 */
function PeriodRail({ activeTab }: { activeTab: PeriodTabValue }) {
  return (
    <>
      <SidebarSection title="Period">
        {PERIOD_RAIL.map((item) => (
          <SidebarLink
            key={item.value}
            href={PERIOD_TAB_ROUTES[item.value]}
            label={item.label}
            icon={<item.Icon />}
            active={item.value === activeTab}
          />
        ))}
      </SidebarSection>

      <SidebarSection title="Settings">
        <SidebarLink
          href={PERIOD_TAB_ROUTES['period-settings']}
          label="Period settings"
          icon={<GearIcon />}
          active={activeTab === 'period-settings'}
        />
      </SidebarSection>
    </>
  );
}

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
    <section className="flex flex-col gap-0.5">
      <div className="flex h-8 items-center gap-1 px-row">
        <h2 className="min-w-0 flex-1 truncate text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * One sidebar row.
 *
 * A real `<a>` (`next/link`), not a button: every one of these navigates, so it
 * can be opened in a new tab, copied and read out as a link. The active row
 * carries `aria-current="page"` — the accessible half of "you are here".
 */
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
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2 rounded-md px-row py-2 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        active && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
        muted && 'text-muted-foreground',
      )}
    >
      <span className="flex w-5 shrink-0 items-center justify-center [&_svg]:size-5">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{badge}</span>
      ) : null}
    </Link>
  );
}
