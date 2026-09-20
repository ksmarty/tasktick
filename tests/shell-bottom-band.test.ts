/**
 * The floating bottom band's offset, and the space the panes reserve for it.
 *
 * The band used to sit flush with the viewport edge (`bottom-0`), separated
 * from it only by the safe-area padding. It is now lifted `bottom-3.5` (14px) —
 * 25% of the pill's own 58px height, rounded to the 14px the spacing scale
 * carries. The offset is on the container rather than folded into the padding,
 * because padding of `max(1rem, env(safe-area-inset-bottom))` is swallowed by
 * the inset on a device with a home indicator, so the bar would not move there.
 *
 * The three scroll panes that paint under the band restate the same clearance
 * the shell's own `<main>` uses; if the band moves and they do not, the last
 * row of every list sits under it. This pins the arithmetic: 5.25rem (84px) plus
 * the 14px lift is 6.125rem (98px). The settings pane is another agent's file
 * and is deliberately not pinned here.
 *
 * The client components cannot be rendered in node, so the contract is pinned
 * from source, like the rest of this suite.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relative: string): string {
  return readFileSync(new URL(`../src/${relative}`, import.meta.url), 'utf8');
}

const SHELL = source('components/app/AppShell.tsx');
const TASKS = source('components/tasks/TasksView.tsx');
const TODAY = source('components/tasks/TodayView.tsx');
const AGENDA = source('components/calendar/DayAgenda.tsx');
const HABITS = source('app/(app)/habits/page.tsx');

const RESERVATION = 'pb-[calc(env(safe-area-inset-bottom)_+_6.125rem)]';

describe('the bottom band is lifted off the viewport edge', () => {
  it('uses a container offset, not extra safe-area padding', () => {
    expect(SHELL).toContain('fixed inset-x-0 bottom-3.5 z-appbar');
    expect(SHELL).not.toContain('fixed inset-x-0 bottom-0 z-appbar');
  });

  it('leaves the safe-area handling and the lg breakpoint untouched', () => {
    // The band is still hidden at `lg`, and its own clearance class still
    // combines the home-indicator inset; only the 14px lift is new.
    expect(SHELL).toContain('lg:hidden');
    expect(SHELL).toContain('BOTTOM_BAND_CLEARANCE');
  });
});

describe('every scroll pane reserves the band’s new clearance', () => {
  it('moves the shell pane and the task lists with the band', () => {
    expect(SHELL).toContain(RESERVATION);
    expect(TASKS).toContain(RESERVATION);
    expect(TODAY).toContain(RESERVATION);
  });

  it('moves the agenda and the habits pane too', () => {
    expect(AGENDA).toContain(RESERVATION);
    expect(HABITS).toContain(RESERVATION);
  });

  it('drops the reservation at lg, where there is no band', () => {
    expect(TASKS).toContain(`${RESERVATION} lg:pb-0`);
    expect(AGENDA).toContain(`${RESERVATION} lg:pb-2`);
  });

  it('no longer carries the pre-lift clearance anywhere it owns', () => {
    for (const file of [SHELL, TASKS, TODAY, AGENDA, HABITS]) {
      expect(file).not.toContain('pb-[calc(env(safe-area-inset-bottom)_+_5.25rem)]');
    }
  });
});
