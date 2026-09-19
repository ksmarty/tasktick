/**
 * The habits screen's "re-tap the Habits tab and go back to today" contract.
 *
 * Habits has no `?date=` in its route, so its "today" is the screen's own two
 * pieces of date state: the day the cards are scoped to and the month the grid
 * shows. Clearing both is the reset — the same state a fresh entry to the tab
 * starts from. The screen answers the shell's re-tap announcement through the
 * shared calendar `useSectionReset`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PAGE = readFileSync(new URL('../src/app/(app)/habits/page.tsx', import.meta.url), 'utf8');

describe('the habits screen answers the re-tap', () => {
  it('listens for the habits re-tap, not the calendar one', () => {
    expect(PAGE).toContain("useSectionReset('habits', resetToToday)");
    expect(PAGE).toContain("from '@/components/calendar/section-reset'");
  });

  it('returns the selected day and the shown month to today', () => {
    // `null` is the screens' own "today" for both, so clearing them is the
    // reset — no new date arithmetic, and a day out of the month takes the
    // month with it exactly as a fresh mount does.
    expect(PAGE).toContain('const resetToToday = useCallback(() => {');
    expect(PAGE).toContain('setSelectedDay(null);');
    expect(PAGE).toContain('setAnchor(null);');
  });
});
