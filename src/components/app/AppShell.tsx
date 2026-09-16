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
import { useMemo, useState } from 'react';
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
import { Badge, IconButton, ListGroup, ListRow, SectionHeader, Sheet, Skeleton, TabBar, type TabBarItem } from '@/components/ui';
import { QuickAddFab } from './QuickAddFab';

type TabValue = 'today' | 'calendar' | 'habits' | 'tasks' | 'more';

const TAB_ROUTES: Record<Exclude<TabValue, 'more'>, string> = {
  today: '/today',
  calendar: '/calendar',
  habits: '/habits',
  tasks: '/tasks',
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

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);

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
      : pathname.startsWith('/tasks') || pathname.startsWith('/matrix') || pathname.startsWith('/search')
        ? 'tasks'
        : pathname.startsWith('/settings') || pathname.startsWith('/pomodoro')
          ? 'more'
          : 'today';

  const tabs: TabBarItem<TabValue>[] = [
    { value: 'today', label: 'Today', icon: Sun, badge: agendaCounts.today || undefined },
    { value: 'calendar', label: 'Calendar', icon: CalendarDays },
    { value: 'habits', label: 'Habits', icon: CheckCircle2 },
    { value: 'tasks', label: 'Tasks', icon: Inbox },
    { value: 'more', label: 'More', icon: MoreHorizontal },
  ];

  function onTabChange(value: TabValue) {
    if (value === 'more') {
      setMoreOpen(true);
      return;
    }
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
          {children}
        </main>
      </div>

      {/* Mobile: floating action button, then the floating tab bar under it. */}
      <QuickAddFab />
      <div className="lg:hidden">
        <TabBar items={tabs} value={activeTab} onChange={onTabChange} label="Main sections" />
      </div>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen} title="More">
        <div className="space-y-5 px-4 pb-6">
          <ListGroup>
            {TOOL_LINKS.map((item) => (
              <ListRow
                key={item.href}
                title={item.label}
                leading={<item.icon className="size-5 text-tint" aria-hidden />}
                onClick={() => {
                  setMoreOpen(false);
                  router.push(item.href);
                }}
              />
            ))}
          </ListGroup>

          <div>
            <SectionHeader title="Lists" className="px-1 pt-0" />
            <ListGroup>
              {lists.map((list) => (
                <ListRow
                  key={list.id}
                  title={list.name}
                  leading={
                    list.emoji ? (
                      <span aria-hidden>{list.emoji}</span>
                    ) : (
                      <span
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: accentHex(list.color) }}
                        aria-hidden
                      />
                    )
                  }
                  trailing={list.openTaskCount ? <Badge value={list.openTaskCount} /> : undefined}
                  onClick={() => {
                    setMoreOpen(false);
                    router.push(`/tasks?list=${list.id}`);
                  }}
                />
              ))}
            </ListGroup>
          </div>

          <ListGroup>
            <ListRow
              title="Settings"
              leading={<Settings className="size-5 text-tint" aria-hidden />}
              onClick={() => {
                setMoreOpen(false);
                router.push('/settings');
              }}
            />
          </ListGroup>
        </div>
      </Sheet>
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
