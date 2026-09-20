/**
 * The floating bottom band's offset, and the space the panes reserve for it.
 *
 * The band sits `bottom-0.5` (2px) off the viewport edge, on top of the 2px
 * minimum its own clearance class already carries (`max(0.125rem, …)`), which is
 * a measured **4px** gap between the pill and the bottom of the screen. It was
 * `bottom-0` (a 2px gap) and was briefly `bottom-3.5` (a 16px gap) after "move
 * the navbar up by about 25%" was read as 25% of the pill's own height; the
 * figure the user gave is a 4px gap, which is 2px more than the original rather
 * than 14px more. The offset is on the container rather than folded into the
 * padding, because padding of `max(1rem, env(safe-area-inset-bottom))` is
 * swallowed by the inset on a device with a home indicator, so the bar would not
 * move there at all.
 *
 * The scroll panes that paint under the band restate the same clearance the
 * shell's own `<main>` uses; if the band moves and they do not, the last row of
 * every list sits under it. This pins the arithmetic: the original 5.25rem
 * (84px) plus the 2px the band moved is 5.375rem (86px), and the pill is 58px
 * (44px button + 2 × 6px padding + 2 × 1px border) so the reservation still
 * clears it with the design's 24px of breathing room.
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
const SETTINGS = source('components/settings/SettingsScroll.tsx');

/** The panes that scroll under the fixed band and must move with it. */
const PANES: [string, string][] = [
  ['shell', SHELL],
  ['tasks', TASKS],
  ['today', TODAY],
  ['agenda', AGENDA],
  ['habits', HABITS],
  ['settings', SETTINGS],
];

const RESERVATION = 'pb-[calc(env(safe-area-inset-bottom)_+_5.375rem)]';
/** The 16px-gap value this pass backed out, and the pre-lift original. */
const SUPERSEDED = [
  'pb-[calc(env(safe-area-inset-bottom)_+_6.125rem)]',
  'pb-[calc(env(safe-area-inset-bottom)_+_5.25rem)]',
];

describe('the bottom band sits 4px off the viewport edge', () => {
  it('uses a container offset, not extra safe-area padding', () => {
    expect(SHELL).toContain('fixed inset-x-0 bottom-0.5 z-appbar');
    expect(SHELL).not.toContain('fixed inset-x-0 bottom-0 z-appbar');
    expect(SHELL).not.toContain('fixed inset-x-0 bottom-3.5 z-appbar');
  });

  it('leaves the safe-area handling and the lg breakpoint untouched', () => {
    // The band is still hidden at `lg`, and its own clearance class still
    // combines the home-indicator inset; only the 2px lift on the container is
    // new.
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

  it('moves the agenda, habits and settings panes too', () => {
    expect(AGENDA).toContain(RESERVATION);
    expect(HABITS).toContain(RESERVATION);
    expect(SETTINGS).toContain(RESERVATION);
  });

  it('drops the reservation at lg, where there is no band', () => {
    expect(TASKS).toContain(`${RESERVATION} lg:pb-0`);
    expect(AGENDA).toContain(`${RESERVATION} lg:pb-2`);
  });

  it('no longer carries either of the superseded clearances anywhere', () => {
    for (const [name, file] of PANES) {
      for (const superseded of SUPERSEDED) {
        expect(file, `${name} still carries ${superseded}`).not.toContain(superseded);
      }
    }
  });
});
