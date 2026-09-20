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
     * The anchor is the centre of a **one-line** entry, not its first text line:
     * a one-line entry renders 52px tall (`pt-1.5` 6px + the `text-xs` range line
     * 16px + `mt-0.5` 2px + the `text-sm` title line 20px + `pb-2` 8px), so the
     * centre is 26px — `6.5` on the spacing scale. Keeping it a fixed offset,
     * rather than a `top-1/2` centring, is what lets a two-line entry anchor the
     * same distance from the top. The offset lives in one constant so the node
     * and the gutter label cannot disagree.
     */
    expect(AGENDA).toContain("const TIMELINE_ANCHOR_TOP = 'top-6.5';");
    expect(AGENDA).toContain("const TIMELINE_ANCHOR_HEIGHT = 'h-6.5';");
    expect(AGENDA).toContain('const TIMELINE_ANCHOR = `${TIMELINE_ANCHOR_TOP} -translate-y-1/2`;');
    expect(AGENDA).toContain('absolute left-1/2 size-2.5 -translate-x-1/2 rounded-full');
    expect(AGENDA).toContain('style={item.isAllDay ? { borderColor: hex } : { backgroundColor: hex }}');
  });

  it('anchors the gutter time to the node, not to the row centre', () => {
    // The label used to be `items-center` on a stretched column, which is the
    // node's offset only while the entry is one line tall. It now shares
    // `TIMELINE_ANCHOR` with the node, so a two-line title moves neither.
    expect(AGENDA).toContain('TIMELINE_ANCHOR,');
    expect(AGENDA).not.toContain('items-center justify-end text-right');
  });

  it('reads an all-day node as a hollow ring rather than a filled disc', () => {
    expect(AGENDA).toContain("item.isAllDay && 'border-2 bg-background'");
  });

  it('trims the rule to the first and last nodes so it does not dangle', () => {
    // First row starts its rule at the node's own top-aligned offset, last row
    // stops there (`TIMELINE_ANCHOR_HEIGHT`, the same 26px as the node), and a
    // single item (both first and last) draws no rule at all. Fixed offsets now
    // that the node is anchored to the top; they still meet the node at any row
    // height, because the node no longer moves with it.
    expect(AGENDA).toContain("index === 0 ? TIMELINE_ANCHOR_TOP : 'top-0'");
    expect(AGENDA).toContain("index === items.length - 1 ? TIMELINE_ANCHOR_HEIGHT : '-bottom-3'");
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
     * `pt-1.5 pb-2` (6px top, 8px bottom) is the `py-2` step below the `py-3`
     * (0.75rem) that raised the entries, with 2px shaved off the top so the
     * optically-lower equal padding reads as centred. `pl-3` (0.75rem) plus the
     * `w-1` (4px) strip is exactly where the old border put the text — 16px in —
     * so the stripe returning to the entry's edge does not move the reading
     * line. The right edge keeps the row token.
     */
    expect(AGENDA).toContain('justify-center pt-1.5 pb-2 pr-row pl-3');
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

describe('the title may run to two lines, and the description yields', () => {
  it('clamps the title to two lines', () => {
    // The user asked for the title to be allowed two lines. `truncate` pinned it
    // to one and would also have fought the wrap (`white-space: nowrap`), so it
    // is gone; the full title still travels in the button's accessible name.
    expect(AGENDA).toContain('mt-0.5 line-clamp-2 text-sm text-foreground');
    expect(AGENDA).not.toContain("'mt-0.5 block truncate text-sm text-foreground'");
  });

  it('lets the description share the clamp so it cannot add a third line', () => {
    // Title and location are one `line-clamp-2` block: the second line belongs
    // to the title whenever the title needs it, and the location only shows
    // while the title fits on one. The location itself is still a single
    // ellipsised line; it does not get a line of its own on top of two.
    expect(AGENDA).toContain('<span className="mt-0.5 line-clamp-2 text-sm text-foreground">');
    expect(AGENDA).toContain('block truncate text-xs text-muted-foreground');
    expect(AGENDA).not.toContain('mt-0.5 block truncate text-xs text-muted-foreground');
  });
});

/* -------------------------------------------------------------------------- */
/* the old description-clamp test, ported                                         */
/* -------------------------------------------------------------------------- */

describe('the description is clamped to one line', () => {
  it('keeps the location a single ellipsised line inside the shared clamp', () => {
    // The user asked for the card's description on one line. The location still
    // carries `truncate`; it now lives inside the title's two-line clamp rather
    // than under it, so a two-line title does not push it onto a third line.
    expect(AGENDA).toContain('block truncate text-xs text-muted-foreground');
    expect(AGENDA).toContain('line-clamp-2');
  });
});

describe('a tap opens the preview, and Edit opens the editor', () => {
  it('routes an agenda tap to the preview state, not an editor', () => {
    expect(SCREEN).toContain('setDetail(item)');
    expect(SCREEN).toContain('<AgendaItemPreview');
    expect(SCREEN).toContain('onEdit={editDetail}');
  });

  it('still reaches both editors from the preview’s Edit action', () => {
    // The event editor is opened with the item's own projection, so a mirrored
    // event carries its read-only flag into the editor as well as the preview.
    expect(SCREEN).toContain('eventId: item.id');
    expect(SCREEN).toContain('defaults: defaultsFor(item, prefs)');
    expect(SCREEN).toContain('readOnly: Boolean(item.readonly)');
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
