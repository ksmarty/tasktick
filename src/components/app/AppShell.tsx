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
import { motion } from 'framer-motion';

import { CalendarIcon } from '@svg-animated-icons/react/calendar';
import { CheckCircledIcon } from '@svg-animated-icons/react/check-circled';
import { CheckboxIcon } from '@svg-animated-icons/react/checkbox';
import { DashboardIcon } from '@svg-animated-icons/react/dashboard';
import { GearIcon } from '@svg-animated-icons/react/gear';
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
import { PageHeaderContext, type PageHeaderContent } from './PageHeader';
import { ShellPaneContext } from './ShellPane';
import { QuickAddFab } from './QuickAddFab';
import { BOTTOM_BAND_CLEARANCE } from './chrome';

type TabValue = 'tasks' | 'calendar' | 'habits' | 'settings';

/**
 * The four destinations, in order.
 *
 * Tasks leads because it is the thing a task app is opened for, and it absorbs
 * the old Today tab: Today is a filter over that list rather than a separate
 * place, so it lives in the list's own filter bar. More is gone too — with four
 * tabs there is nothing left to overflow, and Settings is a destination people
 * actually visit rather than a drawer.
 */
const TAB_ROUTES: Record<TabValue, string> = {
  tasks: '/tasks',
  calendar: '/calendar',
  habits: '/habits',
  settings: '/settings',
};

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
const TABS: { value: TabValue; label: string; icon: React.ReactNode }[] = [
  { value: 'tasks', label: 'Tasks', icon: <CheckboxIcon className="size-5 text-xl" /> },
  { value: 'calendar', label: 'Calendar', icon: <CalendarIcon className="size-5 text-xl" /> },
  { value: 'habits', label: 'Habits', icon: <CheckCircledIcon className="size-5 text-xl" /> },
  { value: 'settings', label: 'Settings', icon: <GearIcon className="size-5 text-xl" /> },
];

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
  /* A screen has asked to own its own scrolling — see `ShellPane`. */
  const [paneFullHeight, setPaneFullHeight] = useState(false);

  /*
   * The key that drives the route fade. Settings is one destination with a
   * dozen sub-routes; keying on the full pathname replayed the whole-pane
   * fade every time a section was chosen. Over the translucent, blurred tab
   * bar that reads as the page ghosting in, which is the "blur" on settings
   * navigation. The settings sub-routes share one key, so they switch without
   * replaying the fade; a move between destinations still does.
   */
  const contentKey = pathname.startsWith('/settings') ? '/settings' : pathname;

  const routeTab: TabValue = pathname.startsWith('/calendar')
    ? 'calendar'
    : pathname.startsWith('/habits')
      ? 'habits'
      : pathname.startsWith('/settings')
        ? 'settings'
        : 'tasks';

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

  useEffect(() => {
    if (pendingTab && routeTab === pendingTab) setPendingTab(null);
  }, [pendingTab, routeTab]);

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
      for (const href of Object.values(TAB_ROUTES)) router.prefetch(href);
    });
    return () => {
      cancelled = true;
    };
  }, [workerControlled, router]);

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
      if (next === 'calendar' || next === 'habits') requestSectionReset(next);
      return;
    }
    setPendingTab(next);
    router.push(TAB_ROUTES[next]);
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
      const active = TABS[index]?.value === activeTab;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
  }, [activeTab]);

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
              <CheckboxIcon />
            </span>
            <span className="text-lg font-semibold tracking-tight">TaskTick</span>
          </div>

          {/*
           * The whole rail is one scroll pane and one vertical rhythm: the gap
           * between sections lives here, on the `gap-stack`, rather than as a
           * margin on each section's last row.
           */}
          <nav
            aria-label="Smart lists"
            className="flex min-h-0 flex-1 flex-col gap-stack overflow-y-auto px-2 pb-4"
          >
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
          </nav>

          <div className="shrink-0 border-t border-sidebar-border p-2">
            <SidebarLink
              href="/settings"
              label="Settings"
              icon={<GearIcon />}
              active={pathname.startsWith('/settings')}
            />
          </div>
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
          {published ? (
            <header className="shrink-0 bg-background pt-[env(safe-area-inset-top)]">
              <div className="flex h-appbar items-center gap-2 px-gutter">
                {published.leading}

                <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{published.title}</h1>

                {published.actions ? (
                  <div className="flex shrink-0 items-center gap-1">{published.actions}</div>
                ) : null}
              </div>

              {/* Everything below the title row belongs to the screen. */}
              {published.children}
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
                : 'overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom)_+_5.25rem)] lg:pb-0',
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
             * Opacity only, deliberately. Any transform on this wrapper makes it
             * the containing block for `position: fixed` descendants, so a
             * docked bar inside a route would position against this box instead
             * of the viewport. Animating opacity leaves it a plain block.
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
            <motion.div
              key={contentKey}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.34, ease: 'easeOut' }}
              className={cn(
                'flex flex-col gap-stack',
                paneFullHeight ? 'h-full' : 'min-h-[calc(100%_+_3rem)]',
              )}
            >
              {children}
            </motion.div>
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
         */}
        <div
          className={cn(
            'fixed inset-x-0 bottom-0 z-appbar flex items-center justify-between gap-2 px-gutter lg:hidden',
            BOTTOM_BAND_CLEARANCE,
          )}
        >
          <TabBar
            ref={tabBarRef}
            tabs={TABS}
            value={activeTab}
            onChange={onTabChange}
            role="tablist"
            aria-label="Main sections"
            onKeyDown={onTabKeyDown}
            className="min-w-0 justify-center"
          />

          {/*
           * The button is contextual, so both its name and whether it belongs
           * on the screen are.
           *
           * It dispatches `requestPrimaryAction`, which whichever screen is
           * mounted handles. Tasks and Calendar both subscribe, so there it keeps
           * its place and its per-screen name. Settings subscribes to nothing, so
           * on that tab the button was dead; Habits already carries its own "New
           * habit" control in the header, so there it was a duplicate. It is
           * therefore not rendered on those two tabs at all, and the band falls
           * back to the tab bar alone.
           */}
          {activeTab === 'tasks' ? (
            <QuickAddFab label="Add a task" />
          ) : activeTab === 'calendar' ? (
            <QuickAddFab label="New event" />
          ) : null}
        </div>
      </div>
      </ShellPaneContext.Provider>
    </PageHeaderContext.Provider>
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
