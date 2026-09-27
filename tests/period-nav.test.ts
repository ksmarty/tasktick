/**
 * The period mode's navigation contract.
 *
 * This is the half of the feature the user described most concretely — "a separate
 * interface that can be enabled in the settings … replace all of the navbar options
 * with period-specific options and UI" — and it is the half whose failure is worst:
 * a mode whose navigation a user cannot get out of strands them away from their
 * tasks.
 *
 * The client components cannot be rendered in node, so — as with the rest of this
 * suite — the behavioural contract is pinned from source, plus the things that can
 * be checked for real: that the routes exist as files, and that every period screen
 * publishes a header (without which the shell's one-app-bar rule would leave the
 * screen with no exit control on it).
 *
 * Each pin below names the expression that *is* the decision, not a nearby string,
 * so changing the decision fails the test rather than sliding past it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relative: string): string {
  return readFileSync(new URL(`../src/${relative}`, import.meta.url), 'utf8');
}

function exists(relative: string): boolean {
  return existsSync(new URL(`../src/${relative}`, import.meta.url));
}

const SHELL = source('components/app/AppShell.tsx');
const EXIT = source('components/period/PeriodExitButton.tsx');
const MODE = source('components/period/mode.ts');
const LAYOUT = source('app/(app)/period/layout.tsx');
const ENTRY = source('app/page.tsx');
const SETTINGS_TABS = source('components/settings/SettingsTabs.tsx');

/** The band's per-tab action map, as written in `AppShell`. */
const actionMap = (() => {
  const start = SHELL.indexOf('const PRIMARY_ACTION_LABEL');
  const end = SHELL.indexOf('};', start);
  return SHELL.slice(start, end);
})();

describe('the tab set is a function of the mode', () => {
  it('declares both sets, with the period routes under /period', () => {
    expect(SHELL).toContain('const APP_TAB_ROUTES: Record<AppTabValue, string> = {');
    expect(SHELL).toContain('const PERIOD_TAB_ROUTES: Record<PeriodTabValue, string> = {');
    for (const route of ["'/period'", "'/period/calendar'", "'/period/insights'", "'/period/settings'"]) {
      expect(SHELL).toContain(route);
    }
    // Four period destinations, the same count as the app's — the band is four
    // slots wide at 390px.
    expect(SHELL.match(/period-(today|cycle|insights|settings)':/g)).toHaveLength(4);
  });

  it('picks the tabs, the routes and the active tab from the one mode flag', () => {
    expect(SHELL).toContain('const tabs = periodMode ? PERIOD_TABS : APP_TABS;');
    expect(SHELL).toContain('const tabRoutes: Record<string, string> = periodMode ? PERIOD_TAB_ROUTES : APP_TAB_ROUTES;');
    expect(SHELL).toContain('const routeTab: TabValue = periodMode ? periodRouteTab(pathname) : appRouteTab(pathname);');
  });

  it('derives the chrome from the route, so it can never lag the page inside it', () => {
    expect(SHELL).toContain('const periodMode = pathname.startsWith(PERIOD_ROUTE_PREFIX);');
    expect(SHELL).toContain("const PERIOD_ROUTE_PREFIX = '/period';");
    // The shell must not consult the switch: a cached `enabled: false` painted the
    // task tabs over the period screen the user had just opened.
    expect(SHELL).not.toContain('usePeriodMode');
    expect(SHELL).not.toContain('usePeriodSettings');
  });

  it('feeds the chosen set to the one tab bar, without touching its ARIA', () => {
    expect(SHELL).toContain('tabs={tabs}');
    expect(SHELL).toContain('value={activeTab}');
    expect(SHELL).toContain("role=\"tablist\"");
    expect(SHELL).toContain("aria-label={periodMode ? 'Period sections' : 'Main sections'}");
    // The roving tabindex still walks the rendered buttons in the rendered order.
    expect(SHELL).toContain('const active = tabs[index]?.value === activeTab;');
  });

  it('drops a half-committed tap when the chrome swaps', () => {
    expect(SHELL).toContain('setPendingTab(null);\n  }, [periodMode]);');
  });
});

describe('the way out is impossible to lose', () => {
  it('renders the exit as the leading control of the one app bar', () => {
    expect(SHELL).toContain('{published || periodMode ? (');
    expect(SHELL).toContain('{periodMode ? <PeriodExitButton /> : null}');
  });

  it('also carries it in the desktop rail, where Settings used to be', () => {
    expect(SHELL).toContain('href={PERIOD_EXIT_HREF}');
    expect(SHELL).toContain('label="Back to tasks"');
  });

  it('points the exit at the task list, as a real link', () => {
    expect(EXIT).toContain("export const PERIOD_EXIT_HREF = '/tasks';");
    expect(EXIT).toContain("import Link from 'next/link';");
    expect(EXIT).toContain('aria-label="Back to tasks and the rest of the app"');
  });

  it('leaves the mode on when the user leaves for the task list', () => {
    // The exit is a plain link with no write, so nothing is turned off by stepping
    // out; turning it off is the switch on the settings screen.
    expect(EXIT).not.toContain('useUpdatePeriodSettings');
    expect(EXIT).not.toContain('api.patch');
  });
});

describe('period mode has no action button of its own', () => {
  it('names an action only for the app tabs', () => {
    expect(actionMap).toContain("tasks: 'Add a task'");
    expect(actionMap).toContain("calendar: 'New event'");
    expect(actionMap).toContain("habits: 'New habit'");
    // A period entry would render a button with no subscriber, or float a "+"
    // over a one-handed form. The band falls back to the tab bar alone.
    expect(actionMap).not.toContain('period');
  });

  it('still reads the name and the decision from the one map', () => {
    expect(SHELL).toContain('const primaryActionLabel = PRIMARY_ACTION_LABEL[activeTab];');
    expect(SHELL).toContain('{primaryActionLabel ? <QuickAddFab label={primaryActionLabel} /> : null}');
  });
});

describe('the mode is persisted, reversible and guarded', () => {
  it('reads the switch from the feature’s own settings endpoint', () => {
    const hook = source('components/period/usePeriodMode.ts');
    expect(hook).toContain("useResource<PeriodSettings>('/api/period/settings')");
    expect(hook).toContain('enabled: data?.enabled === true');
    // "off" must be distinguishable from "not answered yet", and a cached answer
    // from the previous second must be distinguishable from a confirmed one.
    expect(hook).toContain('loaded: data !== undefined');
    expect(hook).toContain('confirmed: sawRequest');
  });

  it('writes the intended value through before navigating, so no reader is stale', () => {
    const card = source('components/period/PeriodModeCard.tsx');
    expect(card).toContain('settings.mutate({ ...before, enabled: next })');
    // The list and the "open" row read the same cache, so they cannot disagree.
    expect(card).toContain('if (!saved) {\n        if (before) settings.mutate(before);');
  });

  it('mirrors it into a display cookie so the entry redirect can read it', () => {
    expect(MODE).toContain("export const PERIOD_MODE_COOKIE = 'tasktick-period-mode';");
    expect(MODE).toContain("return enabled ? 'on' : 'off';");
    expect(ENTRY).toContain('periodModeFromCookie(store.get(PERIOD_MODE_COOKIE)?.value)');
    expect(ENTRY).toContain("redirect(periodMode ? '/period' : '/tasks');");
  });

  it('bounces a stale deep link to the task list, but only on a confirmed answer', () => {
    expect(LAYOUT).toContain('if (!confirmed || !loaded) return;');
    // A failed read must not evict the user: a network problem is not "the mode is
    // off".
    expect(LAYOUT).toContain('if (error !== null) return;');
    expect(LAYOUT).toContain("router.replace('/tasks');");
    expect(LAYOUT).toContain('if (denied) return null;');
  });

  it('is reachable from the app’s own settings, as its own section', () => {
    expect(SETTINGS_TABS).toContain("period: '/settings/period',");
    expect(SETTINGS_TABS).toContain("{ value: 'period', label: 'Period' }");
    expect(exists('app/(app)/settings/period/page.tsx')).toBe(true);
  });
});

describe('the period screens exist and publish their header', () => {
  const routes: [string, string][] = [
    ['app/(app)/period/page.tsx', 'components/period/TodayLogScreen.tsx'],
    ['app/(app)/period/calendar/page.tsx', 'components/period/PeriodCalendarScreen.tsx'],
    ['app/(app)/period/insights/page.tsx', 'components/period/InsightsScreen.tsx'],
    ['app/(app)/period/settings/page.tsx', 'components/period/PeriodSettings.tsx'],
  ];

  it('has a route and a screen for all four destinations', () => {
    for (const [route, screen] of routes) {
      expect(exists(route), route).toBe(true);
      expect(exists(screen), screen).toBe(true);
    }
  });

  it('publishes exactly one header per screen, so the shell renders one bar', () => {
    for (const [, screen] of routes) {
      expect(source(screen), screen).toContain('<PageHeader');
    }
    // The layout must not publish one as well, or the title would double.
    expect(LAYOUT).not.toContain('PageHeader');
  });

  it('uses the one shared day form rather than a second one', () => {
    expect(source('components/period/TodayLogScreen.tsx')).toContain('<DayLogForm');
    expect(source('components/period/DayLogSheet.tsx')).toContain('<DayLogForm');
    expect(exists('components/period/DayLogForm.tsx')).toBe(true);
  });

  it('reuses the calendar month grid rather than drawing a second lattice', () => {
    const calendar = source('components/period/PeriodCalendarScreen.tsx');
    expect(calendar).toContain("from '@/components/calendar'");
    expect(calendar).toContain('<MonthGrid');
    // Through the established seam, not a fork of the grid.
    expect(calendar).toContain('renderDayMarker={renderDayMarker}');
    expect(calendar).toContain('dayMarkerLabel={dayMarkerLabel}');
  });

  it('keeps one scroller and the edge fade on the month screen', () => {
    const calendar = source('components/period/PeriodCalendarScreen.tsx');
    expect(calendar).toContain('useShellPane({ fullHeight: true })');
    expect(calendar).toContain('fade-y');
    expect(calendar).toContain('min-h-0 flex-1 overflow-y-auto');
  });
});
