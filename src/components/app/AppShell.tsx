'use client';

/**
 * The application frame.
 *
 * Responsive by intent rather than by accident: on a phone it is the iOS shell
 * (content + translucent bottom tab bar), on a tablet and up the tab bar gives
 * way to a persistent sidebar. Both respect the safe-area insets, so the
 * Dynamic Island and the home indicator never overlap anything interactive.
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
  Hash,
  Inbox,
  ListChecks,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Sun,
  Timer,
  Trash2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useResource, useIsDesktop } from '@/lib/store';
import { accentHex } from '@/lib/colors';
import type { BootstrapPayload } from '@/lib/view-types';
import {
  Badge,
  IconButton,
  ListGroup,
  ListRow,
  SectionHeader,
  Sheet,
  Skeleton,
  TabBar,
  type TabBarItem,
} from '@/components/ui';

type TabValue = 'today' | 'calendar' | 'habits' | 'tasks' | 'more';

const TAB_ROUTES: Record<Exclude<TabValue, 'more'>, string> = {
  today: '/today',
  calendar: '/calendar',
  habits: '/habits',
  tasks: '/tasks',
};

/** Sidebar smart lists, in the order TickTick shows them. */
const SMART_LISTS = [
  { href: '/today', label: 'Today', icon: Sun, key: 'today' },
  { href: '/tasks?window=next7days', label: 'Next 7 days', icon: CalendarRange, key: 'next7days' },
  { href: '/tasks', label: 'All tasks', icon: ListChecks, key: 'all' },
  { href: '/tasks?window=completed', label: 'Completed', icon: CheckCircle2, key: 'completed' },
] as const;

const TOOL_LISTS = [
  { href: '/matrix', label: 'Priority matrix', icon: Grid2x2 },
  { href: '/pomodoro', label: 'Focus timer', icon: Timer },
  { href: '/search', label: 'Search', icon: Search },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isDesktop = useIsDesktop();
  const [moreOpen, setMoreOpen] = useState(false);

  const { data, isInitialLoading } = useResource<BootstrapPayload>('/api/bootstrap');

  const lists = data?.lists ?? [];
  const calendars = data?.calendars ?? [];
  const agendaCounts = useMemo(() => {
    const agenda = data?.agenda;
    if (!agenda) return { today: 0, overdue: 0 };
    return { today: agenda.today.length + agenda.overdue.length, overdue: agenda.overdue.length };
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
    <div className="flex min-h-dvh flex-col bg-bg">
      {isDesktop ? (
        <div className="flex flex-1">
          <aside className="sticky top-0 hidden h-dvh w-72 shrink-0 flex-col overflow-y-auto border-r border-separator bg-bg px-3 pb-6 pt-safe lg:flex scroll-ios">
            <div className="flex items-center gap-2 px-2 py-4">
              <div className="flex size-8 items-center justify-center rounded-ios bg-tint text-tint-contrast">
                <ListChecks className="size-5" aria-hidden />
              </div>
              <span className="text-headline font-semibold">TaskTick</span>
            </div>

            <nav aria-label="Smart lists" className="space-y-0.5">
              {SMART_LISTS.map((item) => (
                <SidebarLink
                  key={item.key}
                  href={item.href}
                  label={item.label}
                  icon={<item.icon className="size-[18px]" aria-hidden />}
                  active={pathname === item.href.split('?')[0] && !item.href.includes('?')}
                  badge={item.key === 'today' && agendaCounts.today ? agendaCounts.today : undefined}
                />
              ))}
            </nav>

            <SectionHeader
              title="Lists"
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
                <Skeleton variant="rect" className="h-8" />
                <Skeleton variant="rect" className="h-8" />
              </div>
            ) : (
              <nav aria-label="Lists" className="space-y-0.5">
                {lists.map((list) => (
                  <SidebarLink
                    key={list.id}
                    href={`/tasks?list=${list.id}`}
                    label={list.name}
                    icon={
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
                    badge={list.openTaskCount || undefined}
                  />
                ))}
              </nav>
            )}

            <SectionHeader title="Calendars" />
            <nav aria-label="Calendars" className="space-y-0.5">
              {calendars.map((calendar) => (
                <SidebarLink
                  key={calendar.id}
                  href={`/calendar?calendar=${calendar.id}`}
                  label={calendar.name}
                  icon={<span className="size-2.5 rounded-full" style={{ backgroundColor: accentHex(calendar.color) }} aria-hidden />}
                  muted={!calendar.isVisible}
                />
              ))}
            </nav>

            <SectionHeader title="Tools" />
            <nav aria-label="Tools" className="space-y-0.5">
              {TOOL_LISTS.map((item) => (
                <SidebarLink
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={<item.icon className="size-[18px]" aria-hidden />}
                  active={pathname.startsWith(item.href)}
                />
              ))}
            </nav>

            <div className="mt-auto pt-4">
              <ListGroup>
                <ListRow
                  title="Settings"
                  leading={<Settings className="size-[18px]" aria-hidden />}
                  trailing={<ChevronRight className="size-4 text-tertiary" aria-hidden />}
                  href="/settings"
                />
              </ListGroup>
            </div>
          </aside>
        </div>
      ) : null}

      {/* The scroll container. On mobile it is the whole viewport; the tab bar
          overlays the bottom, so content pads itself clear with `pb-tabbar`. */}
      <main id="main" className="flex-1 pb-tabbar lg:pb-0">
        {children}
      </main>

      {!isDesktop ? <TabBar items={tabs} value={activeTab} onChange={onTabChange} label="Main sections" /> : null}

      <Sheet open={moreOpen} onOpenChange={setMoreOpen} title="More">
        <div className="space-y-4 px-4 pb-4">
          <ListGroup>
            {TOOL_LISTS.map((item) => (
              <ListRow
                key={item.href}
                title={item.label}
                leading={<item.icon className="size-5 text-tint" aria-hidden />}
                trailing={<ChevronRight className="size-4 text-tertiary" aria-hidden />}
                onClick={() => {
                  setMoreOpen(false);
                  router.push(item.href);
                }}
              />
            ))}
          </ListGroup>

          <ListGroup>
            <ListRow
              title="Settings"
              leading={<Settings className="size-5 text-tint" aria-hidden />}
              trailing={<ChevronRight className="size-4 text-tertiary" aria-hidden />}
              onClick={() => {
                setMoreOpen(false);
                router.push('/settings');
              }}
            />
            <ListRow
              title="Trash and completed"
              leading={<Trash2 className="size-5 text-tint" aria-hidden />}
              onClick={() => {
                setMoreOpen(false);
                router.push('/tasks?window=completed');
              }}
            />
          </ListGroup>

          <SectionHeader title="Lists" className="px-1" />
          <ListGroup>
            {lists.map((list) => (
              <ListRow
                key={list.id}
                title={list.name}
                leading={
                  <span className="flex size-6 items-center justify-center rounded-full text-caption-1" aria-hidden>
                    {list.emoji ?? <span className="size-2.5 rounded-full" style={{ backgroundColor: accentHex(list.color) }} />}
                  </span>
                }
                trailing={
                  <span className="flex items-center gap-2">
                    {list.openTaskCount ? <Badge value={list.openTaskCount} /> : null}
                    <ChevronRight className="size-4 text-tertiary" aria-hidden />
                  </span>
                }
                onClick={() => {
                  setMoreOpen(false);
                  router.push(`/tasks?list=${list.id}`);
                }}
              />
            ))}
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
        'flex min-h-9 items-center gap-2.5 rounded-ios px-2 text-subhead pressable-row',
        active ? 'bg-tint-soft font-medium text-tint' : muted ? 'text-tertiary' : 'text-label',
      )}
    >
      <span className="flex size-5 shrink-0 items-center justify-center">{icon}</span>
      <span className="truncate">{label}</span>
      {badge ? <span className="ml-auto text-caption-1 text-secondary tnum">{badge}</span> : null}
    </Link>
  );
}

/** Kept for the "no lists yet" empty state used by the tasks view. */
export function NoListsHint() {
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-footnote text-tertiary">
      <Hash className="size-4" aria-hidden />
      No lists yet
      <button type="button" className="ml-auto inline-flex items-center gap-1 text-tint" onClick={() => undefined}>
        <Plus className="size-3.5" aria-hidden /> Add
      </button>
    </div>
  );
}

export { X as CloseIcon };
