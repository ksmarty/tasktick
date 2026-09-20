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

describe('the agenda entry radius, and the stripe that must not follow it', () => {
  it('keeps the entry rounded on all four corners', () => {
    /*
     * The entry is the frame: `rounded-sm overflow-hidden` around the content.
     * The frame is what clips the strip's outer corners to the card's curve, so
     * the radius and the bar are one decision and both survive. Squaring the
     * left (`rounded-r-sm`, tried while the stripe was a separate flush element)
     * is not the answer and must not come back.
     */
    expect(AGENDA).toContain('flex min-w-0 flex-1 overflow-hidden rounded-sm bg-accent');
    expect(AGENDA).not.toContain('rounded-r-sm');
  });

  it('draws the stripe as a clipped strip inside the rounded frame', () => {
    /*
     * The stripe is its own fixed-width element, flush at the frame's left edge,
     * with no radius of its own — the frame's `overflow-hidden` curves only its
     * outer corners, leaving its inner edge a straight, square-ended line. The
     * two rejected shapes were a left border (its inner edge follows the corner,
     * which bows the stripe into a lozenge) and a separate square element inset
     * 4px (off the edge), so neither the border class nor `left-1` may return.
     */
    expect(AGENDA).toContain('w-1 shrink-0 self-stretch');
    expect(AGENDA).not.toContain('border-l-4');
    expect(AGENDA).not.toContain('bg-[var(--edge-color)]');
    expect(AGENDA).not.toContain('absolute inset-y-0 left-1 w-1');
  });

  it('paints the strip with the item’s resolved colour', () => {
    // The colour is a runtime accent lookup, so it genuinely cannot be a class.
    expect(AGENDA).toContain('backgroundColor: hex');
  });
});

describe('the agenda entry’s padding', () => {
  it('is a step below the value that made the entries too tall, on the same text axis', () => {
    /*
     * `py-2` (0.5rem) is the step below the `py-3` (0.75rem) that raised the
     * entries and then read as too tall. `pl-3` (0.75rem) plus the `w-1` (4px)
     * strip is exactly where the old border put the text — 16px in — so the
     * stripe returning to the entry's edge does not move the reading line. The
     * right edge keeps the row token.
     */
    expect(AGENDA).toContain('justify-center py-2 pr-row pl-3');
    expect(AGENDA).not.toContain('bg-accent py-3');
  });

  it('keeps the entry classes out of a comment string', () => {
    // A block comment inside the `className` string compiled (a string is a
    // string) but made the class list `/* … */ 'flex …'`, so `'flex` and
    // `py-2'` never matched and the entry lost its padding and its flex box.
    expect(AGENDA).not.toContain('className="/*');
    expect(AGENDA).toContain('className="flex min-w-0 flex-1 flex-col justify-center');
  });
});

describe('the description is clamped to one line', () => {
  it('truncates the title as well as the location', () => {
    // The user asked for the card's description on one line. The location
    // already carried `truncate`; the title was the last thing still wrapping
    // and keeping the rows uneven, so it is clamped too. The full text still
    // travels in the button's accessible name.
    expect(AGENDA).toContain("'mt-0.5 block truncate text-sm text-foreground'");
    expect(AGENDA).toContain('mt-0.5 block truncate text-xs text-muted-foreground');
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

  it('forwards a mirrored item’s read-only flag to the sheet', () => {
    // Both branches pass `item.readonly`; the sheet removes the Edit action when
    // it is set, so a subscribed feed or read-only collection has no way in.
    expect(PREVIEW).toContain('readOnly={item.readonly ?? false}');
  });
});
