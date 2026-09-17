'use client';

/**
 * The application frame.
 *
 * ## Layout contract
 *
 * The frame is a fixed-height box (`h-dvh overflow-hidden`) whose children own
 * their own scrolling. Nothing scrolls the document. That is what makes `sticky`
 * chrome behave like a native nav bar, stops iOS rubber-banding the whole page,
 * and keeps the sidebar and the content column scrolling independently.
 *
 * Desktop is a row: sidebar + main. Mobile is just main, with a translucent tab
 * bar pinned over the bottom.
 *
 * ## Why the breakpoints are CSS, not JavaScript
 *
 * `hidden lg:flex` rather than a `useMediaQuery` hook. The hook resolves after
 * hydration, so a desktop visitor would paint the mobile layout first and then
 * snap to the desktop one. CSS media queries are applied by the engine before
 * first paint, so there is nothing to flash.
 *
 * ## Why the previous version was broken
 *
 * The sidebar was wrapped in a `flex-1` div inside a **column** flex container,
 * so the wrapper took a full-width row and the `h-dvh` sidebar inside it filled
 * the viewport, pushing `<main>` below the fold. On desktop the content area was
 * literally off-screen. The nav bar being `fixed` compounded it by spanning the
 * viewport and covering the sidebar's own header.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  ChevronRight,
  Grid2x2,
  Inbox,
  ListChecks,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Sun,
  Timer,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useResource } from '@/lib/store';
import { accentHex } from '@/lib/colors';
import type { BootstrapPayload } from '@/lib/view-types';
import { IconButton, ListRow, SectionHeader, Skeleton, TabBar, type TabBarItem } from '@/components/ui';
import { QuickAddFab } from './QuickAddFab';

type TabValue = 'tasks' | 'calendar' | 'habits' | 'settings';

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
  { href: '/today', match: '/today', label: 'Today', icon: Sun, key: 'today' },
  { href: '/tasks?window=next7days', match: '/tasks', label: 'Next 7 days', icon: CalendarRange, key: 'next7days' },
  { href: '/tasks', match: '', label: 'All tasks', icon: ListChecks, key: 'all' },
  { href: '/tasks?window=completed', match: '', label: 'Completed', icon: CheckCircle2, key: 'completed' },
] as const;

const TOOL_LINKS = [
  { href: '/matrix', label: 'Priority matrix', icon: Grid2x2 },
  { href: '/pomodoro', label: 'Focus timer', icon: Timer },
  { href: '/search', label: 'Search', icon: Search },
] as const;

/** The smart-list filters the Tasks screen exposes, including the old Today tab. */
export const TASK_FILTERS = [
  { value: 'today', label: 'Today' },
  { value: 'next7days', label: 'Next 7 days' },
  { value: 'all', label: 'All' },
  { value: 'completed', label: 'Done' },
] as const;

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

  const activeTab: TabValue = pathname.startsWith('/calendar')
    ? 'calendar'
    : pathname.startsWith('/habits')
      ? 'habits'
      : pathname.startsWith('/settings')
        ? 'settings'
        : 'tasks';

  const tabs: TabBarItem<TabValue>[] = [
    { value: 'tasks', label: 'Tasks', icon: ListChecks, badge: agendaCounts.today || undefined },
    { value: 'calendar', label: 'Calendar', icon: CalendarDays },
    { value: 'habits', label: 'Habits', icon: CheckCircle2 },
    { value: 'settings', label: 'Settings', icon: Settings },
  ];

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

  return (
    // `flex-col` on mobile, `lg:flex-row` on desktop is the whole layout:
    // stacked with a tab bar on a phone, side-by-side with a sidebar on a
    // desktop. Forgetting the row override is what kept `<main>` below the fold.
    <div className="app-backdrop flex h-dvh flex-col overflow-hidden lg:flex-row">
      {/* ---------------------------------------------------------------- */}
      {/* Sidebar — desktop only, CSS-driven so desktop never flashes mobile */}
      {/* ---------------------------------------------------------------- */}
      <aside
        aria-label="Navigation"
        className="hidden w-[17.5rem] shrink-0 border-r border-separator/60 lg:flex lg:flex-col"
      >
        <div className="flex items-center gap-2.5 px-4 pb-3 pt-[calc(env(safe-area-inset-top,0px)+0.9rem)]">
          <span className="flex size-8 items-center justify-center rounded-[10px] bg-tint text-tint-contrast shadow-ios-sm">
            <ListChecks className="size-[18px]" aria-hidden />
          </span>
          <span className="text-headline font-semibold tracking-tight">TaskTick</span>
        </div>

        <nav aria-label="Smart lists" className="scroll-pane flex-1 px-2 pb-4">
          <div className="space-y-0.5">
            {SMART_LISTS.map((item) => (
              <SidebarLink
                key={item.key}
                href={item.href}
                label={item.label}
                icon={<item.icon className="size-[17px]" aria-hidden />}
                active={item.match === pathname && item.key === 'today'}
                badge={item.key === 'today' && agendaCounts.today ? agendaCounts.today : undefined}
              />
            ))}
          </div>

          <SectionHeader
            title="Lists"
            className="px-2"
            action={
              <IconButton
                aria-label="New list"
                size="sm"
                variant="plain"
                icon={Plus}
                onClick={() => router.push('/tasks?new=list')}
              />
            }
          />

          {isInitialLoading ? (
            <div className="space-y-1.5 px-2">
              <Skeleton variant="rect" className="h-7 rounded-ios" />
              <Skeleton variant="rect" className="h-7 rounded-ios" />
            </div>
          ) : (
            <div className="space-y-0.5">
              {lists.map((list) => (
                <SidebarLink
                  key={list.id}
                  href={`/tasks?list=${list.id}`}
                  label={list.name}
                  icon={
                    list.emoji ? (
                      <span className="text-[15px] leading-none" aria-hidden>
                        {list.emoji}
                      </span>
                    ) : (
                      <span
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: accentHex(list.color) }}
                        aria-hidden
                      />
                    )
                  }
                  badge={list.openTaskCount || undefined}
                />
              ))}
            </div>
          )}

          <SectionHeader title="Calendars" className="px-2" />
          <div className="space-y-0.5">
            {calendars.map((calendar) => (
              <SidebarLink
                key={calendar.id}
                href={`/calendar?calendar=${calendar.id}`}
                label={calendar.name}
                icon={
                  <span
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: accentHex(calendar.color) }}
                    aria-hidden
                  />
                }
                muted={!calendar.isVisible}
              />
            ))}
          </div>

          <SectionHeader title="Tools" className="px-2" />
          <div className="space-y-0.5">
            {TOOL_LINKS.map((item) => (
              <SidebarLink
                key={item.href}
                href={item.href}
                label={item.label}
                icon={<item.icon className="size-[17px]" aria-hidden />}
                active={pathname.startsWith(item.href)}
              />
            ))}
          </div>
        </nav>

        <div className="shrink-0 px-2 pb-3">
          {/* No `trailing` chevron here: ListRow already renders one for an href. */}
          <ListRow
            title="Settings"
            leading={<Settings className="size-[17px] text-secondary" aria-hidden />}
            href="/settings"
          />
        </div>
      </aside>

      {/* ---------------------------------------------------------------- */}
      {/* Content column — its own scroll pane, so sticky chrome works      */}
      {/* ---------------------------------------------------------------- */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <main id="main" className="scroll-pane flex-1 pb-tabbar lg:pb-0">
          {/*
           * Keyed on the pathname so React remounts this wrapper on every
           * navigation and the entrance animation replays. Without the key the
           * element persists across routes and the animation runs exactly once,
           * ever — which is the opposite of what it is for.
           */}
          {/*
           * `min-h-[calc(100%+3rem)]` guarantees the pane can always scroll a
           * little, even when the content is shorter than the screen.
           *
           * The search field on the task lists is revealed by an upward scroll,
           * so on a list with three items there was no gesture available to
           * bring it back — the reveal depended on the user having enough tasks,
           * which is not something a control should ever depend on. A small
           * guaranteed overscroll means the gesture exists on every screen at
           * every length, and short pages simply scroll by a few centimetres
           * instead of not at all.
           */}
          <div key={pathname} className="animate-page-in min-h-[calc(100%+3rem)]">
            {children}
          </div>
        </main>
      </div>

      {/*
       * The floating bottom band: tab bar and action button sharing one row.
       *
       * One fixed container holding both means they cannot overlap, and it sits
       * just clear of the home indicator rather than floating high above it.
       */}
      <div
        className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+0.125rem)] z-40 flex items-center justify-center gap-2 px-3 lg:hidden"
      >
        <TabBar items={tabs} value={activeTab} onChange={onTabChange} label="Main sections" />
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
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-8 items-center gap-2.5 rounded-[9px] px-2 text-subhead pressable-row',
        active ? 'bg-tint-soft font-medium text-tint' : muted ? 'text-tertiary' : 'text-label',
      )}
    >
      <span className="flex size-4.5 shrink-0 items-center justify-center">{icon}</span>
      <span className="truncate">{label}</span>
      {badge ? <span className="ml-auto text-caption-1 text-secondary tnum">{badge}</span> : null}
    </Link>
  );
}

export { ChevronRight as SidebarChevron };
