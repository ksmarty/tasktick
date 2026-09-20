'use client';

/**
 * The agenda for one day — the bottom region of the calendar screen.
 *
 * It renders exactly the bucket the server sent for the selected date
 * (`payload.days[date]`), already ordered all-day-first. No filtering, no
 * sorting and no recurrence work happens here: the day's contents are whatever
 * the single `/api/calendar/items` response said they were.
 *
 * A row is `[time gutter] │ [card]`. The gutter is a fixed column, right-aligned
 * against a hairline rule, so the times form a clean edge down the left of the
 * list; an all-day item reads `all day` in that same column rather than being
 * indented somewhere else. The card then leads with the time range in the
 * calendar's accent colour and the title beneath it — the reading order the
 * reference uses, and the reason the range is set apart from the title: the eye
 * lands on the time first and the name second.
 *
 * ## The timeline
 *
 * The hairline is a *timeline*: the rule runs the full height of each row and,
 * except on the last row, reaches one `gap-stack` into the gap below it
 * (`-bottom-3`, the same 0.75rem the list's own gap uses), so consecutive
 * entries are joined by one continuous rule instead of each row drawing an
 * isolated tick. The rule is never split around the entries — each item overlays
 * a node on the same run — so the line connects *through* the circles rather
 * than stopping at each one. A timed item hangs a filled disc on the line; an
 * all-day item, which has no clock position, hangs a hollow ring in the same
 * calendar colour, so the gutter alone tells the two apart at a glance. The
 * first row starts its rule at its own node and the last stops at its node, so
 * the line neither dangles above the first entry nor past the final one; a day
 * with a single item carries no rule at all, only its node, and an empty agenda
 * draws nothing. The gutter label is set one step below `text-xs` to leave that
 * rule its own clearance while staying legible; the values stay right-aligned
 * against the rule.
 *
 * The node and the gutter label share one anchor: a fixed `top-3.5` (14px) from
 * the entry's top, so both sit on the entry's first line whether the title runs
 * to one line or two. It is deliberately a distance from the top rather than a
 * centring, because a two-line title makes the entry taller and a centred node
 * would slide down with it — the timeline would then point at the middle of the
 * card instead of at where the item starts. The offset is the entry's `pt-1.5`
 * (6px) plus half the 16px box of the `text-xs` range line the timed rows lead
 * with.
 *
 * Colour is never the only signal. A task is drawn with a checkbox glyph and a
 * softer card surface than an event's, so "a to-do I scheduled" is never
 * mistaken for "a meeting I was invited to".
 *
 * The whole row is one real `button` whose accessible name carries the time, the
 * title and the item's kind, because the visual layout (a gutter, a rule and a
 * two-line card) does not survive as a linear reading order on its own.
 *
 * ## The stripe
 *
 * The per-calendar stripe is a real element — a fixed-width rectangle painted
 * with the item's resolved hex — and the entry is a `rounded-sm overflow-hidden`
 * frame around it. The colour is a runtime accent lookup, so it is the one thing
 * here that genuinely cannot be a class. The same colour is reused for the range
 * line, so stripe and time always agree.
 *
 * The frame is what makes the shape work, and it is why this does not use the
 * left border that preceded it. A left border is painted *inside* the entry's
 * rounded border box, so its inner (right) edge is that corner's curve pushed
 * inward: the stripe reads as a lozenge at its ends, which is the report this
 * fixes. A separate square element fails the other way — flush it squares the
 * entry's own left silhouette, and inset 4px it floats off the edge, which the
 * user has already rejected.
 *
 * Clipping a straight strip with the entry's own radius has neither problem: the
 * strip's *outer* corners are cut by the frame's rounding, so it reads as part
 * of the card, while its *inner* edge is a plain vertical line whose ends are
 * square, because the clip only reaches the corners the strip actually touches.
 * The strip is `w-1` (4px — the width the border had), flush at the frame's left
 * edge; `pl-3` (0.75rem) beside it puts the text back at the same 16px the
 * border's 4px plus 12px did, so the reading line does not move.
 *
 * Dragging a row horizontally moves the item by whole days. It goes through the
 * same `useItemDrag` hook as before, so the lift threshold, the click-swallow
 * and the Escape-to-cancel behaviour are identical everywhere in the calendar.
 * The drag measures `listRef`, so that ref stays on the `<ul>` node.
 *
 * ## Who scrolls
 *
 * The list is no longer a scroller itself: the `section[aria-label="Day
 * agenda"]` that wraps it carries the screen's single `overflow-y-auto`, which
 * is what keeps the month grid above fixed while the agenda below moves. The
 * list still carries `touch-pan-y`, because touch-action is read from the
 * element a touch starts on and its ancestors, and the horizontal day-swipe
 * (handled on that same section) needs the pointer series to survive.
 *
 * The bottom reservation for the fixed tab band lives here too: in full-height
 * mode the shell's `main` no longer reserves it, so the list states it once —
 * `pb-[calc(env(safe-area-inset-bottom)_+_6.125rem)]`, the same expression the
 * shell's own pane used, grown by the 14px the band was lifted off the bottom
 * edge — and the last row can always be scrolled clear of the band on a phone.
 * On `lg` the band is hidden, so the reservation drops to a plain `pb-2`.
 *
 * There is no "New event" affordance here at all: creating an event is the
 * shell's action button (which the calendar screen answers through
 * `usePrimaryAction`), or the day detail sheet. A create button inside the
 * agenda was a third way in for a job that already had two, and it sat under the
 * last row where it read as part of the day's contents.
 *
 * The agenda also carries no header. The selected day used to be repeated here
 * directly under a grid that already shows which day is selected; the
 * screen-reader announcement of the selected day lives in `CalendarToolbar`,
 * where it belongs.
 */
import { useRef } from 'react';
import { CalendarIcon } from '@svg-animated-icons/react/calendar';
import { useAppearance } from '@/app/providers';
import { addDaysToDateOnly, formatTime, fromDateOnly, toDateOnly } from '@/lib/dates';
import { cn } from '@/lib/utils';
import type { CalendarItem } from '@/lib/types';
import { itemHex } from './colors';
import { DragGhostLabel } from './DragGhostLabel';
import { minuteOfDay } from './geometry';
import { allDayDateLabel } from './item-labels';
import { useItemDrag } from './use-item-drag';
import type { CalendarInteraction, CalendarLookup, CalendarPrefs, ItemOpenHandler, RescheduleHandler } from './types';

/**
 * Columns the horizontal drag lattice pretends to have.
 *
 * The agenda is a list, not a grid, so there is no column to measure against.
 * Seven imaginary columns spanning the row width makes a ~55px drag equal one
 * day, and the index sits in the middle so the item can move either way.
 */
const DRAG_COLUMNS = 7;

/** The gutter column's width; the times are right-aligned inside it. */
const GUTTER_WIDTH_CLASS = 'w-14';

/**
 * The timeline's anchor, stated once so the node and the gutter time cannot
 * drift apart: 14px below the entry's top — the entry's `pt-1.5` (6px) plus half
 * the 16px line box of the `text-xs` range row. `-translate-y-1/2` puts each
 * element's own centre on that offset, whatever its height, which is what makes
 * a one-line and a two-line entry anchor identically.
 */
const TIMELINE_ANCHOR_TOP = 'top-3.5';
const TIMELINE_ANCHOR = `${TIMELINE_ANCHOR_TOP} -translate-y-1/2`;

export interface DayAgendaProps {
  /** `payload.days[date] ?? []`, straight from the server. */
  items: CalendarItem[];
  prefs: CalendarPrefs;
  calendars: CalendarLookup;
  interaction: CalendarInteraction;
  onOpenItem: ItemOpenHandler;
  onReschedule: RescheduleHandler;
}

export function DayAgenda({
  items,
  prefs,
  calendars,
  interaction,
  onOpenItem,
  onReschedule,
}: DayAgendaProps) {
  const listRef = useRef<HTMLUListElement>(null);
  /** The resolved appearance, so an accent token maps to the right hex. */
  const dark = useAppearance().resolvedTheme === 'dark';

  const drag = useItemDrag({
    hourHeight: 0,
    gridRef: listRef,
    interaction,
    axis: (init) => {
      const rect = listRef.current?.getBoundingClientRect();
      if (!rect) return null;
      return {
        columns: DRAG_COLUMNS,
        index: init.cellIndex,
        count: DRAG_COLUMNS,
        cellWidth: rect.width / DRAG_COLUMNS,
        rowHeight: 0,
      };
    },
    formatLabel: (item, target) =>
      fromDateOnly(addDaysToDateOnly(toDateOnly(item.startMs, prefs.zone), target.dayDelta, prefs.zone), prefs.zone).toFormat(
        'ccc LLL d',
      ),
    onDrop: onReschedule,
  });

  return (
    <div className="flex flex-col">
      <ul
        ref={listRef}
        /*
         * `touch-pan-y` belongs on the list the touch starts on, and the actual
         * scrolling belongs to the section around it: `overflow-y-auto` here as
         * well would be a second scroller, and the top one would never move —
         * the agenda is the only region that scrolls on this screen.
         *
         * Without `pan-y` the browser claims a horizontal touch as a pan and
         * cancels the pointer series, which killed the day-swipe; with it,
         * vertical scrolls still pass through to the section and the horizontal
         * drag stays ours.
         *
         * The scrollbar is hidden on the section, which is the element that
         * scrolls — see `CalendarScreen`.
         */
        className="flex flex-col gap-stack touch-pan-y px-2 pb-[calc(env(safe-area-inset-bottom)_+_6.125rem)] lg:pb-2"
      >
        {items.map((item, index) => {
          const hex = itemHex(item, calendars, dark);
          const isTask = item.kind === 'task';
          const done = Boolean(item.completed);
          // The gutter carries the start of the row; the card carries the range.
          // An all-day item has no clock time, so it reads "all day" in that slot
          // — the date is already the day the agenda is grouped under. The full
          // date span still travels in the accessible name below, where a
          // multi-day item would otherwise lose it.
          const gutterLabel = item.isAllDay ? 'all day' : formatTime(item.startMs, prefs);
          const rangeLabel = item.isAllDay
            ? // The gutter already reads "all day". Repeating it on the card
              // would be the kind of duplication that makes a dense list feel
              // noisy, so the card carries only the title for an all-day row.
              null
            : `${formatTime(item.startMs, prefs)} – ${formatTime(item.endMs, prefs)}`;
          const accessibleName = [
            item.isAllDay
              ? `All-day, ${allDayDateLabel(item, prefs.zone)}`
              : `${formatTime(item.startMs, prefs)} to ${formatTime(item.endMs, prefs)}`,
            item.title,
            isTask ? 'task' : 'event',
            done ? 'completed' : null,
            item.location ? `at ${item.location}` : null,
          ]
            .filter(Boolean)
            .join(', ');
          const dragging = drag.ghost?.item.key === item.key;

          return (
            <li key={item.key}>
              <button
                type="button"
                data-item-block="true"
                aria-label={accessibleName}
                onClick={() => onOpenItem(item)}
                onPointerDown={(event) =>
                  drag.begin(item, event, {
                    startMinute: item.isAllDay ? 0 : minuteOfDay(item.startMs, prefs.zone),
                    durationMinutes: 0,
                    cellIndex: Math.floor(DRAG_COLUMNS / 2),
                  })
                }
                className={cn(
                  'flex w-full cursor-pointer items-stretch gap-3 text-left',
                  // Tasks read softer than events — together with the checkbox
                  // glyph it is what keeps the two kinds apart at a glance.
                  done && 'opacity-60',
                  dragging && 'relative z-40',
                )}
                style={dragging ? { transform: `translate3d(${drag.ghost?.offsetX ?? 0}px, 0, 0)` } : undefined}
              >
                {/*
                 * The gutter label shares the node's anchor: `TIMELINE_ANCHOR`
                 * (14px from the entry's top) centres the label on the same
                 * offset the node is drawn at, so the time and the dot agree on
                 * a one-line entry and stay agreed when the title wraps to two.
                 * The label used to be centred on the whole entry, which is the
                 * same pixel only while the entry is exactly one line tall —
                 * every taller row put the time and the node 13-21px apart.
                 * Absolute inside the full-height gutter column, so it never
                 * depends on the row's height.
                 */}
                <span className={cn(GUTTER_WIDTH_CLASS, 'relative shrink-0')}>
                  <span
                    className={cn(
                      'absolute inset-x-0 text-right text-[0.6875rem] text-muted-foreground tabular-nums',
                      TIMELINE_ANCHOR,
                    )}
                  >
                    {gutterLabel}
                  </span>
                </span>

                {/*
                 * The timeline: a hairline the times are right-aligned
                 * against, with each item's node laid on top of it.
                 *
                 * The rule is an absolutely-positioned child of a full-height
                 * column rather than the column itself, so the node can sit at a
                 * fixed offset from the row while the rule starts and stops
                 * where it needs to. On every row but the last it runs one
                 * `gap-stack` past the bottom (`-bottom-3`, the list's own gap),
                 * so the segments meet and the entries are connected rather than
                 * each floating on its own tick. The node is drawn *over* the
                 * unbroken rule — never between two segments — which is what
                 * keeps the line continuous through every circle.
                 *
                 * First and last are trimmed to their nodes rather than the row
                 * edges: the first row starts its rule at the node's own offset
                 * (`TIMELINE_ANCHOR_TOP`, exactly where the node is drawn) and
                 * the last stops there (`h-3.5`, no bridge), so nothing dangles
                 * above the first entry or past the final one. The offset is a
                 * fixed distance from the top now that the node is anchored
                 * there rather than centred on a row whose height varies — it
                 * tracks the first line of text at any row height. A single-item
                 * day is both first and last and draws no rule at all, only its
                 * node.
                 */}
                <span aria-hidden className="relative w-px shrink-0 self-stretch">
                  {items.length > 1 ? (
                    <span
                      className={cn(
                        'absolute left-0 w-px bg-border',
                        index === 0 ? TIMELINE_ANCHOR_TOP : 'top-0',
                        index === items.length - 1 ? 'h-3.5' : '-bottom-3',
                      )}
                    />
                  ) : null}
                  {/*
                   * Anchored to the top of the entry, not centred on it: the
                   * timeline reads as "the item starts here", so the node sits on
                   * the first line of text. `top-3.5` (14px) is the entry's
                   * `pt-1.5` (6px) plus half the 16px box of the `text-xs` range
                   * line the timed rows lead with — anchored to the top, a fixed
                   * offset tracks the first line instead of drifting with the
                   * row's height the way the old `top-1/2` did. It uses the same
                   * `TIMELINE_ANCHOR` the gutter label does, so the two cannot
                   * disagree.
                   *
                   * The circle on the line. A timed item is a filled disc in
                   * the item's own colour; an all-day item is a hollow ring of
                   * the same colour, because it has no moment to point at. The
                   * colour is `hex` — the value `itemHex` already resolved for
                   * the row — so dot, stripe and range always agree.
                   */}
                  <span
                    className={cn(
                      'absolute left-1/2 size-2.5 -translate-x-1/2 rounded-full',
                      TIMELINE_ANCHOR,
                      item.isAllDay && 'border-2 bg-background',
                    )}
                    style={item.isAllDay ? { borderColor: hex } : { backgroundColor: hex }}
                  />
                </span>

                {/*
                 * The stripe is its own element, clipped by the entry's rounded
                 * frame (`overflow-hidden`), rather than the entry's left border.
                 * A border's inner edge follows the corner, so the stripe bowed
                 * into a lozenge at its ends; a plain strip clipped by the frame
                 * keeps the stripe's outer corners on the card's curve while its
                 * inner edge stays a straight, square-ended line. See "The
                 * stripe" at the top of this file.
                 *
                 * The padding is asymmetric on purpose. `pt-1.5 pb-2` (6px top,
                 * 8px bottom) is the `py-2` step below the `py-3` that made the
                 * entries too tall, with 2px shaved off the top: equal padding
                 * reads as sitting low, so the optical correction lifts the text
                 * block without the geometric centre changing much. The bottom
                 * keeps the full 8px. `pl-3` (0.75rem) plus the `w-1` (4px)
                 * strip is the same 16px the old border put the text at, so the
                 * reading line does not move. The right edge keeps `pr-row` — it
                 * is the far side of that line and had no reason to move.
                 */}
                <span className="flex min-w-0 flex-1 overflow-hidden rounded-sm bg-accent">
                  <span aria-hidden className="w-1 shrink-0 self-stretch" style={{ backgroundColor: hex }} />

                  <span className="flex min-w-0 flex-1 flex-col justify-center pt-1.5 pb-2 pr-row pl-3">
                    {/* An all-day row has no range to show; the gutter says it. */}
                    {rangeLabel ? (
                      <span className="block truncate text-xs font-semibold" style={{ color: hex }}>
                        {rangeLabel}
                      </span>
                    ) : null}

                    {/*
                     * The title may wrap to two lines now, and the location
                     * below it shares this clamp: the second line belongs to the
                     * title whenever the title needs it, and the location only
                     * appears while the title fits on one. The card therefore
                     * never exceeds two text lines below the range — the
                     * description yields to the title instead of stacking a
                     * third line under it. `-webkit-line-clamp` counts the
                     * location's own line as the second, so this needs no
                     * measurement and no JavaScript; the full title still travels
                     * in the button's accessible name above.
                     */}
                    <span className="mt-0.5 line-clamp-2 text-sm text-foreground">
                      {/*
                       * No checkbox here. The agenda is a calendar, and a calendar shows what is
                       * happening and when — a checkbox on this screen asks you to act on a task
                       * from a view that exists to read the day. The task list is one tap away and
                       * is where completing belongs.
                       */}
                      <span className={cn(done && 'line-through')}>{item.title}</span>

                      {item.location ? (
                        <span className="block truncate text-xs text-muted-foreground">{item.location}</span>
                      ) : null}
                    </span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}

          {items.length === 0 ? (
            <li className="flex flex-col items-center gap-2 py-8 text-center">
              <CalendarIcon aria-hidden className="size-8 text-3xl text-muted-foreground" disableHover />
              {/*
               * Icon and heading only. A subtitle here read "This day is clear.
               * Add an event, or drag one here from another day." It was asked to
               * be removed once already and was still present, so it goes with the
               * reason attached: the heading already says there is nothing, and two
               * lines of instruction were the noisiest thing on an empty screen.
               */}
              <p className="text-sm font-semibold text-foreground">Nothing scheduled</p>
            </li>
          ) : null}
      </ul>

      {drag.ghost ? <DragGhostLabel ghost={drag.ghost} /> : null}
    </div>
  );
}
