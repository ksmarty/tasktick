/**
 * The calendar agenda's reading rules, pinned from source.
 *
 * The client components cannot be rendered in node, so the behaviours that were
 * asked for explicitly are pinned structurally — the same approach as
 * `tasks-detail.test.ts`. Each pin stands for something that regressed silently
 * before: an all-day row printing a date where "all day" belongs, a gutter with
 * no connecting rule, and a tap that opened the editor instead of the preview.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relative: string): string {
  return readFileSync(new URL(`../src/components/${relative}`, import.meta.url), 'utf8');
}

const AGENDA = source('calendar/DayAgenda.tsx');
const DAY_SHEET = source('calendar/DayDetailSheet.tsx');
const SCREEN = source('calendar/CalendarScreen.tsx');
const PREVIEW = source('calendar/AgendaItemPreview.tsx');

describe('an all-day item reads “all day”, not its date', () => {
  it('uses the phrase in the agenda gutter', () => {
    expect(AGENDA).toContain("const gutterLabel = item.isAllDay ? 'all day' : formatTime(item.startMs, prefs);");
  });

  it('uses the same phrase in the day detail sheet', () => {
    expect(DAY_SHEET).toContain("? 'all day'");
    expect(DAY_SHEET).not.toContain('allDayDateLabel');
  });

  it('still gives a screen reader the date span', () => {
    // The visible slot drops the date because the agenda is grouped under it,
    // but a multi-day item must still announce which days it covers.
    expect(AGENDA).toContain('allDayDateLabel(item, prefs.zone)');
  });
});

describe('the gutter timeline', () => {
  it('draws one rule through the rows and bridges the gap between them', () => {
    // The rule is a child of the full-height column and overruns it into the
    // list gap, so consecutive rows meet instead of each drawing a tick.
    expect(AGENDA).toContain('absolute left-0 w-px bg-border');
    expect(AGENDA).toContain("'-bottom-3'");
  });

  it('sets the gutter label below text-xs and keeps it right-aligned', () => {
    expect(AGENDA).toContain('text-right text-[0.6875rem] text-muted-foreground tabular-nums');
  });

  it('hangs a node on the rule for every item, in the row’s own colour', () => {
    // The node sits over the rule in the same full-height column, so the rule
    // is never split around it — the line connects through rather than stopping
    // at each circle.
    /*
     * Centred on the row, not pinned to a fixed offset from the top. A two-line
     * entry is taller than a one-line entry, so `top-3` put the node, the time
     * and the item in three different places on exactly the rows where they most
     * need to agree.
     */
    expect(AGENDA).toContain(
      'absolute top-1/2 left-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full',
    );
    expect(AGENDA).toContain('flex shrink-0 items-center justify-end text-right');
    expect(AGENDA).toContain('style={item.isAllDay ? { borderColor: hex } : { backgroundColor: hex }}');
  });

  it('reads an all-day node as a hollow ring rather than a filled disc', () => {
    expect(AGENDA).toContain("item.isAllDay && 'border-2 bg-background'");
  });

  it('trims the rule to the first and last nodes so it does not dangle', () => {
    // First row starts its rule at the node's centre, last row stops there, and
    // a single item (both first and last) draws no rule at all. Fractions of the
    // row, not fixed pixels: the entry's vertical padding moved, and a fixed
    // offset tuned to the old height left the rule short of the node.
    expect(AGENDA).toContain("index === 0 ? 'top-1/2' : 'top-0'");
    expect(AGENDA).toContain("index === items.length - 1 ? 'h-1/2' : '-bottom-3'");
    expect(AGENDA).toContain('items.length > 1 ? (');
  });
});

describe('the agenda entry radius', () => {
  it('is a step on the radius scale, below the card radius', () => {
    /*
     * `rounded-r-sm`: a radius on the left corners curves the 4px colour stripe
     * with them, so the strip ends up with rounded ends rather than being the
     * clean bar it is meant to be.
     */
    expect(AGENDA).toContain('rounded-r-sm border-l-4');
    expect(AGENDA).not.toContain('rounded-sm border-l-4');
    expect(AGENDA).not.toContain('rounded-lg border-l-4');
  });
});

describe('the agenda entry’s padding', () => {
  it('gives the entry more vertical air and brings the text in from the stripe', () => {
    /*
     * `py-3` (0.75rem) up from `py-2`, and `pl-3` (0.75rem) down from `px-row`
     * (1rem) so the text starts closer to the 4px colour stripe without
     * crowding it. The right edge keeps the row token.
     */
    expect(AGENDA).toContain('bg-accent py-3 pr-row pl-3');
    expect(AGENDA).not.toContain('px-row py-2');
  });

  it('keeps the entry classes out of a comment string', () => {
    // A block comment inside the `className` string compiled (a string is a
    // string) but made the class list `/* … */ 'flex …'`, so `'flex` and
    // `py-2'` never matched and the entry lost its padding and its flex box.
    expect(AGENDA).not.toContain('className="/*');
    expect(AGENDA).toContain('className="flex min-w-0 flex-1 flex-col justify-center');
  });
});

describe('a tap opens the preview, and Edit opens the editor', () => {
  it('routes an agenda tap to the preview state, not an editor', () => {
    expect(SCREEN).toContain('setDetail(item)');
    expect(SCREEN).toContain('<AgendaItemPreview');
    expect(SCREEN).toContain('onEdit={editDetail}');
  });

  it('still reaches both editors from the preview’s Edit action', () => {
    expect(SCREEN).toContain('setEditor({ open: true, eventId: item.id, defaults: defaultsFor(item, prefs) })');
    expect(SCREEN).toContain('setTaskEditor({ open: true, taskId: item.id })');
  });

  it('reuses the shared detail sheet for events and tasks', () => {
    expect(PREVIEW).toContain("from '@/components/tasks/ItemDetailSheet'");
    expect(PREVIEW).toContain('ItemDetailSheet');
    expect(PREVIEW).toContain('useResource<Task>');
  });
});
