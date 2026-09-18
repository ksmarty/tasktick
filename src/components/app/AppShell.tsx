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

import { TabBar } from '@/components/godui/tab-bar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { accentHex } from '@/lib/colors';
import { useResource } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { BootstrapPayload } from '@/lib/view-types';
import { PageHeaderContext, type PageHeaderContent } from './PageHeader';
import { ShellPaneContext } from './ShellPane';
import { QuickAddFab } from './QuickAddFab';

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

  function onTabChange(value: string) {
    router.push(TAB_ROUTES[value as TabValue]);
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
            <header className="shrink-0 border-b border-border bg-background pt-[env(safe-area-inset-top)]">
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
             * Keyed on the pathname so React remounts this wrapper on every
             * navigation and the entrance animation replays. Without the key the
             * element persists across routes and the animation runs exactly
             * once, ever — which is the opposite of what it is for.
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
              key={pathname}
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
         * The floating bottom band: bottom navigation and action button sharing
         * one row.
         *
         * One fixed container holding both means they cannot overlap, and the
         * home-indicator inset is padding on the band rather than an offset on
         * each child, so the two stay on one baseline.
         *
         * The bar is `flex-1` and capped at the width the old nav paper used, so
         * it takes the room the action button leaves and no more; `justify-center`
         * keeps its four tabs centred inside the pill, which matters because the
         * GodUI bar reveals only the active tab's label and would otherwise
         * change width on every switch.
         */}
        <div className="fixed inset-x-0 bottom-0 z-appbar flex items-center justify-center gap-2 px-gutter pb-[env(safe-area-inset-bottom)] lg:hidden">
          <TabBar
            ref={tabBarRef}
            tabs={TABS}
            value={activeTab}
            onChange={onTabChange}
            role="tablist"
            aria-label="Main sections"
            onKeyDown={onTabKeyDown}
            className="min-w-0 max-w-105 flex-1 justify-center"
          />

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
