/**
 * The calendar's "re-tap the Calendar tab and go back to today" contract.
 *
 * The tab bar is the shell's, so the only thing this feature can own is the
 * screen side: a window announcement the shell raises when the active tab is
 * pressed, and `CalendarScreen` answering it. These pins cover both halves of
 * that contract — the event carries the tab, and the screen listens for the
 * calendar one and resets through the same path a fresh entry uses.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { SECTION_RETAP_EVENT, requestSectionReset } from '@/components/calendar/section-reset';

const SCREEN = readFileSync(new URL('../src/components/calendar/CalendarScreen.tsx', import.meta.url), 'utf8');
const MODULE = readFileSync(new URL('../src/components/calendar/section-reset.ts', import.meta.url), 'utf8');

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe('requestSectionReset', () => {
  it('announces a re-tap on the window with the tab in the detail', () => {
    const seen: CustomEvent[] = [];
    (globalThis as unknown as { window: unknown }).window = {
      dispatchEvent: (event: CustomEvent) => {
        seen.push(event);
        return true;
      },
    };

    requestSectionReset('calendar');

    expect(seen).toHaveLength(1);
    expect(seen[0].type).toBe(SECTION_RETAP_EVENT);
    expect((seen[0] as CustomEvent<{ tab: string }>).detail).toEqual({ tab: 'calendar' });
  });

  it('is a no-op without a window, so it can be imported server-side', () => {
    expect(() => requestSectionReset('habits')).not.toThrow();
  });

  it('ignores an event addressed to the other section', () => {
    // The listener filters on the tab, so a habits re-tap can never move the
    // calendar. Pinned because a missing filter would reset both screens that
    // happen to be mounted.
    expect(MODULE).toContain('detail?.tab !== tab');
  });
});

describe('the calendar screen answers the re-tap', () => {
  it('returns to today through the same reset the route default uses', () => {
    expect(SCREEN).toContain("useSectionReset('calendar', resetToToday)");
    expect(SCREEN).toContain('const resetToToday = useCallback(');
  });

  it('still adopts the bare-route prop change', () => {
    // The `?date=` channel is the other way in; the tab tap and the route
    // default share one operation so they cannot drift apart.
    expect(SCREEN).toContain('if (initialDate !== null) return;');
    expect(SCREEN).toContain('resetToToday();');
  });
});
