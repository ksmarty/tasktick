'use client';

/**
 * The settings section navigation.
 *
 * ## Why this is a navigation list, not a tab strip
 *
 * Settings grew past the four concerns the old horizontal `Tabs` strip was built
 * for. A horizontal strip of nine sections does not fit 390px, and the old answer
 * — let it scroll sideways — hides the sections past the fold, which is exactly
 * the problem the extra sections were meant to solve. The design here is
 * therefore a **vertical list of sections** that becomes a compact wrapping set
 * of pills on a phone:
 *
 * - At `lg` and up, the sections are a column beside the panel, which is how the
 *   app's own sidebar already reads.
 * - Below `lg`, the same list wraps onto as many rows as it needs at 390px with
 *   no horizontal scrollbar, so every section is visible.
 *
 * The list stays on the shadcn `Tabs` primitive (Radix), so `role="tablist"`,
 * `role="tab"`, `aria-selected`, the roving `tabindex` and the arrow-key handler
 * are unchanged. Radix drives left/right for its horizontal orientation; an extra
 * handler on the wrapper adds up/down for the column layout. The panel is still
 * rendered by the route, and `onValueChange` still pushes a real route, so the
 * URL remains the single source of truth and no sub-route is orphaned.
 *
 * The Admin section is filtered out for non-administrators: a tab that only some
 * accounts can use is worse than one the rest never see, which is the rule the
 * old Advanced page followed for its admin link.
 */
import { useRouter } from 'next/navigation';
import { BellIcon } from '@svg-animated-icons/react/bell';
import { CalendarIcon } from '@svg-animated-icons/react/calendar';
import { ClockIcon } from '@svg-animated-icons/react/clock';
import { ColorWheelIcon } from '@svg-animated-icons/react/color-wheel';
import { DownloadIcon } from '@svg-animated-icons/react/download';
import { LockClosedIcon } from '@svg-animated-icons/react/lock-closed';
import { PersonIcon } from '@svg-animated-icons/react/person';
import { ReloadIcon } from '@svg-animated-icons/react/reload';
import { TimerIcon } from '@svg-animated-icons/react/timer';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useResource } from '@/lib/store';
import type { BootstrapPayload } from '@/lib/view-types';
import type { KeyboardEvent, ReactNode } from 'react';

export type SettingsTab =
  | 'account'
  | 'appearance'
  | 'date-time'
  | 'notifications'
  | 'calendars'
  | 'integrations'
  | 'focus'
  | 'data'
  | 'admin';

/** The route each section points at. */
const TAB_HREF: Record<SettingsTab, string> = {
  account: '/settings',
  appearance: '/settings/appearance',
  'date-time': '/settings/date-time',
  notifications: '/settings/notifications',
  calendars: '/settings/calendars',
  integrations: '/settings/integrations',
  focus: '/settings/focus',
  data: '/settings/data-export',
  admin: '/settings/admin',
};

interface SettingsSection {
  value: SettingsTab;
  label: string;
  icon: ReactNode;
  /** Hidden from accounts that are not administrators. */
  adminOnly?: boolean;
}

/** Every section, in the order the list shows them. */
const SECTIONS: SettingsSection[] = [
  { value: 'account', label: 'Account', icon: <PersonIcon /> },
  { value: 'appearance', label: 'Appearance', icon: <ColorWheelIcon /> },
  { value: 'date-time', label: 'Date & time', icon: <ClockIcon /> },
  { value: 'notifications', label: 'Notifications', icon: <BellIcon /> },
  { value: 'calendars', label: 'Calendars', icon: <CalendarIcon /> },
  { value: 'integrations', label: 'Integrations', icon: <ReloadIcon /> },
  { value: 'focus', label: 'Focus', icon: <TimerIcon /> },
  { value: 'data', label: 'Data', icon: <DownloadIcon /> },
  { value: 'admin', label: 'Admin', icon: <LockClosedIcon />, adminOnly: true },
];

export interface SettingsTabsProps {
  /** The section the current route represents. */
  active: SettingsTab;
  children: ReactNode;
}

export function SettingsTabs({ active, children }: SettingsTabsProps) {
  const router = useRouter();
  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');
  const isAdmin = bootstrap.data?.user.isAdmin ?? false;

  const sections = SECTIONS.filter((section) => !section.adminOnly || isAdmin);

  /**
   * Up/down move between the sections when the list is a column. Radix's own
   * handler already covers left/right for the horizontal orientation, so this
   * only adds the pair a vertical list needs.
   */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const triggers = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
    if (triggers.length === 0) return;
    event.preventDefault();
    const current = triggers.indexOf(document.activeElement as HTMLElement);
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    const next = (((current < 0 ? 0 : current) + delta) % triggers.length + triggers.length) % triggers.length;
    triggers[next]?.focus();
  }

  return (
    <Tabs
      value={active}
      onValueChange={(value) => router.push(TAB_HREF[value as SettingsTab])}
      className="gap-stack"
    >
      {/*
       * The nested wrapper carries the responsive layout. It is separate from
       * the Radix root because the primitive hard-codes `flex-col` for its
       * horizontal orientation at a specificity a plain `lg:flex-row` could not
       * beat; one layer down, the list and panel are just two flex children.
       */}
      <div
        className="flex flex-col gap-stack lg:flex-row lg:items-start lg:gap-gutter"
        onKeyDown={onKeyDown}
      >
        <div className="lg:w-56 lg:shrink-0">
          {/*
           * `h-auto` (and its variant-qualified twin) undoes the primitive's
           * fixed `h-9`, which would clip the list once it wraps.
           */}
          <TabsList
            aria-label="Settings sections"
            className="h-auto w-full flex-wrap justify-start gap-1 group-data-[orientation=horizontal]/tabs:h-auto lg:w-full lg:flex-col lg:items-stretch"
          >
            {sections.map((section) => (
              <TabsTrigger
                key={section.value}
                value={section.value}
                className="flex-none gap-2 lg:w-full lg:justify-start"
                /*
                 * Radix only calls `onValueChange` when the value actually
                 * changes, so a section that is already selected but lives at a
                 * different URL (e.g. the legacy `/settings/advanced`) would do
                 * nothing on click. Pushing from the trigger turns it back into a
                 * working link; on a normal switch the router receives the same
                 * URL twice, which is a no-op.
                 */
                onClick={() => {
                  if (section.value === active) router.push(TAB_HREF[section.value]);
                }}
              >
                <span aria-hidden className="shrink-0 text-muted-foreground [&_svg]:size-4">
                  {section.icon}
                </span>
                {section.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* The panel keeps the area's `gap-stack` rhythm, so a section that holds
            several groups spaces them exactly like a standalone screen does. */}
        <TabsContent value={active} className="min-w-0 flex-1">
          <div className="flex flex-col gap-stack">{children}</div>
        </TabsContent>
      </div>
    </Tabs>
  );
}
