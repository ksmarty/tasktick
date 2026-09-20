'use client';

/**
 * The settings shell: the pinned section navigation, and the panel it selects.
 *
 * ## Why this changed shape
 *
 * The previous design was a **vertical list of sections** grouped under three
 * captions. It was a deliberate answer to a horizontal `Tabs` strip that scrolled
 * the sections past the fold, and the reasoning was sound — but the user's
 * complaint is about the space it costs, not its correctness. At 390px the list
 * wrapped onto a caption row plus a wrapped pill row per group and pushed the
 * first card 210px down the screen.
 *
 * So the navigation is now **two compact rows**: three primary tabs pinned above
 * the scroll area, one per group, and the sections of the selected group on a
 * second row beneath them. The captions are gone — a pinned primary row *is* the
 * caption, and it is always on screen, which is what the vertical list was buying
 * with its height.
 *
 * ## The primary row is navigation, the sub row is a tablist
 *
 * The earlier doc comment rejected a tablist because a **nested** tablist
 * violates the ARIA tabs pattern: a `tablist` may not contain another `tablist`,
 * and a roving `tabindex` and arrow-key handler do not compose across the nesting.
 * That objection still stands and is why this is not two tablists.
 *
 * The two rows are different things, so they get different semantics:
 *
 *  - The **primary row** changes which group of sections is shown and always
 *    navigates to a real route (the group's first reachable section). It is a
 *    `<nav>` of `<Link>`s with `aria-current="page"` on the active group — the
 *    accessible half of "you are here", and natively keyboard-operable with no
 *    hand-rolled roving `tabindex`.
 *  - The **sub row** is a single-level `role="tablist"` driven by the shadcn
 *    `Tabs` primitive (Radix). The panel is the scroll pane below it, so it is a
 *    genuine tab↔tabpanel pair and Radix owns `aria-selected`, the roving
 *    `tabindex` and the arrow keys. Nothing is hand-rolled.
 *
 * The alternative — a GodUI `SegmentedControl` — was checked against the registry
 * and rejected: its source declares `role="tablist"`/`role="tab"`/`aria-selected`
 * but implements none of the keyboard pattern (every tab is tabbable, the arrow
 * keys do nothing, and no `tabpanel` is associated). Wearing the tab roles
 * without the behaviour is worse than either row being plain buttons, so the
 * primitive that actually provides the pattern is used instead.
 *
 * ## Pinned, not sticky
 *
 * "Stuck to the top" is literal: the two rows live **outside** the scroll pane
 * (`SettingsScroll`), as siblings, so they never move while the panel scrolls.
 * A `position: sticky` row inside the pane was the alternative and is wrong here
 * — `SettingsScroll` carries the `fade-y` mask, so a sticky row would be faded to
 * nothing as the pane scrolled under it. Keeping the rows out of the pane leaves
 * the single-scroller arrangement and its edge fade completely intact.
 *
 * ## The same contract as before
 *
 * Every section is still a real route and the URL is still the single source of
 * truth: the sub-tab value is derived from `usePathname`, and selecting a tab
 * pushes the route. A deep link therefore lands on the right primary row and the
 * right sub-tab with no client state to seed. The legacy `/settings/advanced`
 * alias still resolves to Focus.
 *
 * The Admin section is filtered out for non-administrators, and a group that
 * would be left with no reachable section is dropped rather than rendered as an
 * empty tab. The active group is resolved from the *unfiltered* groups so that a
 * non-administrator who opens `/settings/admin` still lands on Advanced and sees
 * the refusal the page renders, rather than being silently moved elsewhere.
 *
 * The routes are warmed on mount, exactly as before: the shell only prefetches
 * the four tab roots, so without this every section is a cold server render.
 */
import { useEffect, useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useResource } from '@/lib/store';
import type { BootstrapPayload } from '@/lib/view-types';
import { cn } from '@/lib/utils';
import { SettingsScroll } from './SettingsScroll';

export type SettingsTab =
  | 'account'
  | 'appearance'
  | 'date-time'
  | 'notifications'
  | 'calendars'
  | 'integrations'
  | 'focus'
  | 'api'
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
  api: '/settings/api',
  data: '/settings/data-export',
  admin: '/settings/admin',
};

interface SettingsSection {
  value: SettingsTab;
  label: string;
  /** Hidden from accounts that are not administrators. */
  adminOnly?: boolean;
}

interface SettingsSectionGroup {
  /** The primary tab's label, e.g. `Personal`. */
  label: string;
  sections: SettingsSection[];
}

/**
 * The sections, grouped, in the order the primary and sub rows show them.
 *
 * The split is by subject: everything about you and how the app is set up
 * personally, then everything that connects the app to calendars and
 * notifications elsewhere, then the settings that change how the app behaves or
 * hand you your data. At most four sections per group is also what keeps both
 * rows one clean line at 390px.
 */
const SECTION_GROUPS: SettingsSectionGroup[] = [
  {
    label: 'Personal',
    sections: [
      { value: 'account', label: 'Account' },
      { value: 'appearance', label: 'Appearance' },
      { value: 'date-time', label: 'Date & time' },
    ],
  },
  {
    label: 'Scheduling',
    sections: [
      { value: 'calendars', label: 'Calendars' },
      { value: 'integrations', label: 'Integrations' },
      { value: 'notifications', label: 'Notifications' },
    ],
  },
  {
    label: 'Advanced',
    sections: [
      { value: 'focus', label: 'Focus' },
      { value: 'data', label: 'Data' },
      { value: 'api', label: 'API' },
      { value: 'admin', label: 'Admin', adminOnly: true },
    ],
  },
];

/**
 * The section a pathname represents, or `null` when it is not a section.
 *
 * `usePathname` strips the query string and gives the canonical route, so the
 * reverse of `TAB_HREF` is all that is needed. The legacy `/settings/advanced`
 * alias has no entry in the map — it renders the Focus controls — so it is
 * mapped to Focus explicitly, which also canonicalises on click.
 */
function sectionForPath(pathname: string): SettingsTab | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (path === '/settings/advanced') return 'focus';
  const entry = (Object.entries(TAB_HREF) as [SettingsTab, string][]).find(([, href]) => href === path);
  return entry ? entry[0] : null;
}

export interface SettingsTabsProps {
  children: ReactNode;
}

export function SettingsTabs({ children }: SettingsTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');
  const isAdmin = bootstrap.data?.user.isAdmin ?? false;

  const active = sectionForPath(pathname) ?? 'account';

  /* Administrators keep every group; everyone else loses only Admin, which never
   * empties a group — but a future admin-only group would be dropped, not left
   * as a bare tab. */
  const groups = useMemo(
    () =>
      SECTION_GROUPS.map((group) => ({
        label: group.label,
        sections: group.sections.filter((section) => !section.adminOnly || isAdmin),
      })).filter((group) => group.sections.length > 0),
    [isAdmin],
  );

  /*
   * Which primary tab is current. Looked up in the *unfiltered* groups so that
   * `/settings/admin` still reads as Advanced for a non-administrator even
   * though the Admin sub-tab is hidden from them.
   */
  const activeGroup =
    SECTION_GROUPS.find((group) => group.sections.some((section) => section.value === active))?.label ??
    groups[0]?.label;

  const activeSections = groups.find((group) => group.label === activeGroup)?.sections ?? [];

  /**
   * Warm the section routes.
   *
   * `router.prefetch` issues a *full* prefetch in this build, which the client
   * router cache then reuses for the next navigation, so the tap swaps the panel
   * from the prefetched payload instead of waiting on a server render. Registered
   * as an effect rather than during render so the first paint of the settings
   * area is never held up by it.
   */
  useEffect(() => {
    for (const href of Object.values(TAB_HREF)) router.prefetch(href);
  }, [router]);

  return (
    <Tabs
      value={active}
      onValueChange={(value) => router.push(TAB_HREF[value as SettingsTab])}
      className="min-h-0 flex-1"
    >
      {/*
       * The pinned chrome. It is a sibling of the scroll pane, not a sticky child
       * of it, so the pane's `fade-y` mask can never fade it. `bg-background` and
       * the bottom border separate it from the content scrolling beneath.
       */}
      <div
        data-settings-nav
        className="flex shrink-0 flex-col gap-1.5 border-b border-border bg-background px-gutter pt-3 pb-2"
      >
        {/*
         * Three links, not tabs: each changes the group and navigates to a real
         * route, so it is navigation. `aria-current="page"` marks the group the
         * current section belongs to.
         */}
        <nav data-settings-primary aria-label="Settings groups" className="flex items-center gap-1 rounded-lg bg-muted p-1">
          {groups.map((group) => {
            const current = group.label === activeGroup;
            const first = group.sections[0];
            /*
             * The active group's link points at the section actually open, so
             * `aria-current="page"` is literally true; the other groups point at
             * their first reachable section.
             */
            return (
              <Link
                key={group.label}
                href={current ? TAB_HREF[active] : TAB_HREF[first.value]}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'flex h-7 min-w-0 flex-1 items-center justify-center truncate rounded-md px-2 text-sm font-medium transition-colors',
                  current
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <span className="min-w-0 truncate">{group.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* A single-level tablist; the panel is the scroll pane below it. */}
        <TabsList aria-label="Settings sections" className="h-9 w-full">
          {activeSections.map((section) => (
            <TabsTrigger
              key={section.value}
              value={section.value}
              className="min-w-0"
              /*
               * Radix only calls `onValueChange` when the value actually changes,
               * so a section that is already selected but lives at a different URL
               * (e.g. the legacy `/settings/advanced`) would do nothing on click.
               * Pushing from the trigger turns it back into a working link; on a
               * normal switch the router receives the same URL twice, a no-op.
               */
              onClick={() => {
                if (section.value === active) router.push(TAB_HREF[section.value]);
              }}
            >
              <span className="min-w-0 truncate">{section.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {/* The panel is the one scroller; `min-h-0` lets it shrink and scroll. */}
      <TabsContent value={active} className="flex min-h-0 flex-1 flex-col">
        <SettingsScroll>{children}</SettingsScroll>
      </TabsContent>
    </Tabs>
  );
}
