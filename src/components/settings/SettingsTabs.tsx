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
 * ## One shell
 *
 * The arrangement lives in `SettingsNav`, and `SettingsTabs` is its configuration
 * (the app's groups, routes, labels and admin filter), so the ARIA decisions
 * above are made once.
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
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useResource } from '@/lib/store';
import type { BootstrapPayload } from '@/lib/view-types';
import { cn } from '@/lib/utils';
import { SettingsScroll } from './SettingsScroll';
import { searchSettings } from './filter';
import { SECTION_GROUPS, TAB_HREF, sectionForPath, type SettingsTab } from './sections';

/* The shell's public type still lives here for the barrel, but its definition is
 * now data-shaped and testable in `sections.ts` — see that file's header. */
export type { SettingsTab };

export interface SettingsNavSection {
  value: string;
  label: string;
  /** Hidden from accounts that are not administrators. */
  adminOnly?: boolean;
  /**
   * Words the settings search matches but the navigation never shows — the
   * vocabulary someone uses when they do not know the section's name
   * ("push" for Notifications, "backup" for Data).
   */
  keywords?: string[];
}

/** One primary group of sections. */
export interface SettingsNavGroup {
  /** The primary tab's label, e.g. `Personal`. */
  label: string;
  sections: SettingsNavSection[];
}

export interface SettingsNavProps {
  /** The groups, in the order the primary and sub rows show them. */
  groups: SettingsNavGroup[];
  /** The route each section value points at. */
  href: Record<string, string>;
  /** The section value the current route represents. */
  active: string;
  /** Administrators keep every group; everyone else loses `adminOnly` sections. */
  isAdmin?: boolean;
  /** Accessible name for the primary row. */
  primaryLabel: string;
  /** Accessible name for the sub tablist. */
  subLabel: string;
  /** Warm every section route on mount (the shell prefetches only tab roots). */
  prefetch?: boolean;
  children: ReactNode;
}

/**
 * The pinned two-row settings navigation and its one scroll pane.
 *
 * The shell supplies the arrangement; the caller supplies its `groups`, `href`
 * map, active value and labels. See the file comment for why the primary row is
 * links and the sub row is a tablist.
 */
export function SettingsNav({
  groups,
  href,
  active,
  isAdmin = false,
  primaryLabel,
  subLabel,
  prefetch = false,
  children,
}: SettingsNavProps) {
  const router = useRouter();

  /* Administrators keep every group; everyone else loses only Admin, which never
   * empties a group — but a future admin-only group would be dropped, not left
   * as a bare tab. */
  const visibleGroups = useMemo(
    () =>
      groups
        .map((group) => ({
          label: group.label,
          sections: group.sections.filter((section) => !section.adminOnly || isAdmin),
        }))
        .filter((group) => group.sections.length > 0),
    [groups, isAdmin],
  );

  /*
   * The search over the sections themselves.
   *
   * Two rows of pills is a good browse and a poor search: on a phone, finding
   * "quiet hours" meant guessing that it lives under Notifications inside
   * Scheduling. Typing narrows the *navigation* instead of the panel, so a hit is
   * one tap whatever group it was in — and the group is printed on the hit, which
   * quietly teaches where things live. See `filter.ts` for the ranking.
   */
  const [query, setQuery] = useState('');
  const searching = query.trim().length > 0;
  const matches = useMemo(
    () => searchSettings(visibleGroups, href, query, isAdmin),
    [visibleGroups, href, query, isAdmin],
  );

  /*
   * Which primary tab is current. Looked up in the *unfiltered* groups so that
   * `/settings/admin` still reads as Advanced for a non-administrator even
   * though the Admin sub-tab is hidden from them.
   */
  const activeGroup =
    groups.find((group) => group.sections.some((section) => section.value === active))?.label ??
    visibleGroups[0]?.label;

  /** The last-resort destination: a real route, never an empty string. */
  const fallbackHref = Object.values(href)[0] ?? '/';

  const activeSections = visibleGroups.find((group) => group.label === activeGroup)?.sections ?? [];

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
    if (!prefetch) return;
    for (const route of Object.values(href)) router.prefetch(route);
  }, [prefetch, href, router]);

  return (
    <Tabs
      value={active}
      onValueChange={(value) => router.push(href[value] ?? href[active] ?? '')}
      className="min-h-0 flex-1"
    >
      {/*
       * The pinned chrome. It is a sibling of the scroll pane, not a sticky child
       * of it, so the pane's `fade-y` mask can never fade it. `bg-background` and
       * the bottom border separate it from the content scrolling beneath.
       */}
      <div
        data-settings-nav
        className="flex shrink-0 flex-col gap-1.5 bg-background px-gutter pt-3 pb-2"
      >
        {/*
         * Always visible, above both rows. A search that lives behind an icon is
         * a search nobody finds; this is the second thing on the screen, and it
         * is the escape hatch from the grouping rather than a replacement for it
         * — clearing it puts the two rows straight back.
         */}
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a setting"
          aria-label="Find a setting"
          autoComplete="off"
          className="h-9"
        />

        {searching ? (
          /* The navigation *becomes* the result list: each hit is a section, and
           * the group it belongs to is printed beside it. */
          <nav aria-label={subLabel} className="flex flex-col">
            {matches.length ? (
              <ul className="flex flex-col">
                {matches.map((match) => (
                  <li key={match.value}>
                    <Link
                      href={match.href}
                      onClick={() => setQuery('')}
                      aria-current={match.value === active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors hover:bg-muted',
                        match.value === active ? 'bg-muted font-medium' : 'text-muted-foreground',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{match.label}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{match.group}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-2 py-2 text-sm text-muted-foreground">
                No setting matches “{query.trim()}”.
              </p>
            )}
          </nav>
        ) : (
          <>
        {/*
         * Three links, not tabs: each changes the group and navigates to a real
         * route, so it is navigation. `aria-current="page"` marks the group the
         * current section belongs to.
         */}
        <nav
          data-settings-primary
          aria-label={primaryLabel}
          className="flex items-center gap-1 rounded-lg bg-muted p-1"
        >
          {visibleGroups.map((group) => {
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
                /*
 * Never an empty href. `?? ''` used to be the fallback, and a `<Link` with an
 * empty href is a navigation to a URL that matches no route — which renders the
 * App Router's not-found page. Falling back to the current path is always a real
 * route, so a group whose section is somehow unresolvable cannot 404. The floor
 * is the first href in the map, which is always a route that exists.
 */
href={(current ? href[active] : first && href[first.value]) ?? fallbackHref}
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
        <TabsList aria-label={subLabel} className="h-9 w-full">
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
                if (section.value === active && href[section.value]) router.push(href[section.value]);
              }}
            >
              <span className="min-w-0 truncate">{section.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>
          </>
        )}
      </div>

      {/* The panel is the one scroller; `min-h-0` lets it shrink and scroll. */}
      <TabsContent value={active} className="flex min-h-0 flex-1 flex-col">
        <SettingsScroll>{children}</SettingsScroll>
      </TabsContent>
    </Tabs>
  );
}

export interface SettingsTabsProps {
  children: ReactNode;
}

export function SettingsTabs({ children }: SettingsTabsProps) {
  const pathname = usePathname();
  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');
  const isAdmin = bootstrap.data?.user.isAdmin ?? false;

  const active = sectionForPath(pathname) ?? 'account';

  return (
    <SettingsNav
      groups={SECTION_GROUPS}
      href={TAB_HREF}
      active={active}
      isAdmin={isAdmin}
      primaryLabel="Settings groups"
      subLabel="Settings sections"
      prefetch
    >
      {children}
    </SettingsNav>
  );
}