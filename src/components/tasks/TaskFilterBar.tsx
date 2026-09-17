'use client';

/**
 * The Tasks window filter, and the new home of what used to be the Today tab.
 *
 * Today is a filter over the same task data rather than a separate place, so it
 * sits here as one chip among four: it routes to the grouped `/today` agenda
 * (Overdue / Today / Tomorrow / Next 7 days), which is genuinely different from
 * the flat list, while the other three set `?window=` on `/tasks`. The active
 * chip is read back out of the current route and query, so the bar always
 * describes the list under it.
 *
 * These are `<Link>`s, not buttons calling a router: that is what lets Next
 * prefetch them, and a chip that takes a second to respond would defeat the
 * point of a filter. They scroll sideways on a narrow phone but never wrap — a
 * quiet row of chips, not a second navigation bar.
 */
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/cn';
import { parseTaskView, type TaskWindow } from './filters';

interface WindowChip {
  /** The window the chip selects; `today` is the grouped `/today` agenda. */
  window: Extract<TaskWindow, 'today' | 'next7days' | 'all' | 'completed'>;
  label: string;
  href: string;
}

export const TASK_WINDOW_CHIPS: readonly WindowChip[] = [
  { window: 'today', label: 'Today', href: '/today' },
  { window: 'next7days', label: 'Next 7 days', href: '/tasks?window=next7days' },
  { window: 'all', label: 'All', href: '/tasks' },
  { window: 'completed', label: 'Done', href: '/tasks?window=completed' },
];

/**
 * Active state is derived, never stored: `usePathname` says whether we are on
 * the Today agenda, and the `window` param says which slice of `/tasks` is
 * showing. The parser supplies the default (`all`) when the param is absent,
 * which is exactly what the `All` chip means.
 */
export function TaskFilterBar({ className }: { className?: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const onToday = pathname === '/today';
  const window = parseTaskView(searchParams.toString()).window;

  return (
    <div
      className={cn(
        'no-scrollbar flex flex-nowrap items-center gap-1.5 overflow-x-auto px-4',
        className,
      )}
    >
      {TASK_WINDOW_CHIPS.map((chip) => {
        const active = onToday ? chip.window === 'today' : chip.window === window;
        return (
          <Link
            key={chip.window}
            href={chip.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-footnote pressable',
              active ? 'bg-tint font-semibold text-on-tint' : 'bg-tint-soft font-medium text-tint',
            )}
          >
            {chip.label}
          </Link>
        );
      })}
    </div>
  );
}
