'use client';

/**
 * The settings tab bar.
 *
 * Settings used to be one long page with a row of links at the bottom, which is
 * why the user read the whole thing as one continuous block. Each tab here is a
 * coherent concern — Account, Notifications, Calendars, Advanced — and the tab
 * bar is the only way to move between them.
 *
 * ## Why the tabs navigate rather than swap in place
 *
 * Every tab already had a real route (the four settings screens), and those
 * routes have to stay reachable: they are deep links other screens and the smoke
 * tests rely on. So the tab bar drives the router — `Tabs` is controlled by the
 * route's own `active` value and `onValueChange` pushes the matching path —
 * which keeps one source of truth for "where am I" (the URL) and means nothing
 * is orphaned or duplicated. The panel below is rendered by the route itself;
 * this component only supplies the list, the active styling and the transition.
 *
 * Because the trigger is a real button with `role="tab"` (Radix supplies it),
 * `aria-selected` and arrow-key navigation work as they should, and the list is
 * named by `aria-label` rather than relying on the page heading.
 */
import { useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ReactNode } from 'react';

export type SettingsTab = 'account' | 'notifications' | 'calendars' | 'advanced';

/** The route each tab points at. `/settings/admin` deliberately maps to Advanced. */
const TAB_HREF: Record<SettingsTab, string> = {
  account: '/settings',
  notifications: '/settings/notifications',
  calendars: '/settings/calendars',
  advanced: '/settings/advanced',
};

/** The four tabs, in order. */
const TABS: { value: SettingsTab; label: string }[] = [
  { value: 'account', label: 'Account' },
  { value: 'notifications', label: 'Notifications' },
  { value: 'calendars', label: 'Calendars' },
  { value: 'advanced', label: 'Advanced' },
];

export interface SettingsTabsProps {
  /** The tab the current route represents. */
  active: SettingsTab;
  children: ReactNode;
}

export function SettingsTabs({ active, children }: SettingsTabsProps) {
  const router = useRouter();

  return (
    <Tabs
      value={active}
      onValueChange={(value) => router.push(TAB_HREF[value as SettingsTab])}
      className="gap-stack"
    >
      {/*
       * `flex-none` on the triggers is what keeps the labels on one line at
       * 390px: the primitive gives every trigger `flex-1`, and four of those
       * squeeze "Notifications" until it wraps. Sized to their content instead,
       * the four fit the phone width, and if a locale ever makes them longer the
       * list scrolls horizontally rather than wrapping or clipping.
       */}
      <TabsList
        aria-label="Settings sections"
        className="w-full justify-start overflow-x-auto"
      >
        {TABS.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            className="flex-none"
            /*
             * Radix only calls `onValueChange` when the value actually changes,
             * so on `/settings/admin` — which shows the Advanced tab but has its
             * own URL — clicking the already-selected Advanced tab would do
             * nothing. Pushing from the trigger as well turns that tab back into
             * a working link to `/settings/advanced`; on a normal switch the
             * router just receives the same URL twice, which is a no-op.
             */
            onClick={() => {
              if (tab.value === active) router.push(TAB_HREF[tab.value]);
            }}
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>

      {/* The panel keeps the area's `gap-stack` rhythm, so a tab that holds
          several groups spaces them exactly like a standalone screen does. */}
      <TabsContent value={active} className="flex flex-col gap-stack">
        {children}
      </TabsContent>
    </Tabs>
  );
}
