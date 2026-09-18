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
 * list; an all-day item reads "all-day" in that same column rather than being
 * indented somewhere else. The card then leads with the time range in the
 * calendar's accent colour and the title beneath it — the reading order the
 * reference uses, and the reason the range is set apart from the title: the eye
 * lands on the time first and the name second.
 *
 * Colour is never the only signal. A task is drawn with a checkbox glyph and a
 * softer leading edge than an event's solid one, so "a to-do I scheduled" is
 * never mistaken for "a meeting I was invited to".
 *
 * The whole row is one focusable `ListItemButton` whose accessible name carries
 * the time, the title and the item's kind, because the visual layout (a gutter,
 * a rule and a two-line card) does not survive as a linear reading order on its
 * own.
 *
 * Dragging a row horizontally moves the item by whole days. It goes through the
 * same `useItemDrag` hook as before, so the lift threshold, the click-swallow
 * and the Escape-to-cancel behaviour are identical everywhere in the calendar.
 * The drag measures `listRef`, so that ref stays on the scrolling `List` node.
 *
 * The pane adds no bottom padding of its own. The shell's `main` already
 * reserves the tab band, and the floating action button shares that one row with
 * the tab bar instead of floating above it — so reserving the button's band
 * again inside this pane was double padding, which is what left a dead gap under
 * the last row.
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
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import Typography from '@mui/material/Typography';
import { useColorScheme } from '@mui/material/styles';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import { accentHex } from '@/lib/colors';
import { addDaysToDateOnly, formatTime, fromDateOnly, toDateOnly } from '@/lib/dates';
import type { CalendarItem } from '@/lib/types';
import { itemColor } from './colors';
import { DragGhostLabel } from './DragGhostLabel';
import { minuteOfDay } from './geometry';
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
  const { colorScheme } = useColorScheme();
  const dark = colorScheme === 'dark';

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
        'ccc d LLL',
      ),
    onDrop: onReschedule,
  });

  return (
    <Box sx={{ display: 'flex', minHeight: 0, flex: 1, flexDirection: 'column' }}>
      <List
        ref={listRef}
        /*
         * `touchAction: pan-y` belongs on the scroller, not on the section around
         * it: touch-action is resolved up to the nearest scrolling element, so a
         * value on an ancestor of this `ul` is ignored. Without it the browser
         * claims a horizontal touch as a pan and cancels the pointer series,
         * which killed the day-swipe; with it, vertical scrolls still pass
         * through to the list and the horizontal drag stays ours.
         */
        sx={{
          minHeight: 0,
          flex: 1,
          overflowY: 'auto',
          overscrollBehaviorY: 'contain',
          touchAction: 'pan-y',
          px: 1.5,
          py: 0,
          pb: 1,
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {items.map((item) => {
          const color = itemColor(item, calendars);
          const isTask = item.kind === 'task';
          const done = Boolean(item.completed);
          // The gutter carries the start of the row; the card carries the range.
          const gutterLabel = item.isAllDay ? 'all-day' : formatTime(item.startMs, prefs);
          const rangeLabel = item.isAllDay
            ? // The gutter column already says "all-day". Repeating it on the card
              // is the kind of duplication that makes a dense list feel noisy, so
              // the card carries only the title for an all-day row.
              null
            : `${formatTime(item.startMs, prefs)} – ${formatTime(item.endMs, prefs)}`;
          const accessibleName = [
            item.isAllDay ? 'All-day' : `${formatTime(item.startMs, prefs)} to ${formatTime(item.endMs, prefs)}`,
            item.title,
            isTask ? 'task' : 'event',
            done ? 'completed' : null,
            item.location ? `at ${item.location}` : null,
          ]
            .filter(Boolean)
            .join(', ');
          const dragging = drag.ghost?.item.key === item.key;

          return (
            <ListItem key={item.key} disablePadding sx={{ mb: 0.75 }}>
              <ListItemButton
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
                sx={[
                  {
                    alignItems: 'stretch',
                    gap: 1,
                    p: 0,
                    textAlign: 'left',
                    bgcolor: 'transparent',
                    // Tasks are drawn softer than events — together with the
                    // checkbox glyph it is what keeps the two kinds apart at a
                    // glance.
                    opacity: done ? 0.6 : 1,
                  },
                  dragging ? { position: 'relative', zIndex: 40 } : null,
                ]}
                style={dragging ? { transform: `translate3d(${drag.ghost?.offsetX ?? 0}px, 0, 0)` } : undefined}
              >
                <Typography
                  variant="caption"
                  sx={{
                    width: 56,
                    flexShrink: 0,
                    pt: 1,
                    textAlign: 'right',
                    color: 'text.secondary',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {gutterLabel}
                </Typography>

                {/* The hairline the times are aligned against. */}
                <Divider orientation="vertical" flexItem />

                <Box
                  sx={{
                    display: 'flex',
                    minWidth: 0,
                    flex: 1,
                    flexDirection: 'column',
                    justifyContent: 'center',
                    py: 1,
                    pr: 1.25,
                    pl: 1.5,
                    borderRadius: 2,
                    bgcolor: 'action.hover',
                    /*
                     * The leading bar: a 3px stripe the full height of the card,
                     * so the row's calendar is visible even when it is scrolled
                     * mostly out of view. Drawn as an inset shadow rather than a
                     * border so it follows the card's own corner instead of
                     * arcing away from it.
                     */
                    boxShadow: `inset 3px 0 0 0 ${accentHex(color, dark)}`,
                  }}
                >
                  {/* An all-day row has no range to show; the gutter says it. */}
                  {rangeLabel ? (
                    <Typography
                      variant="caption"
                      sx={{
                        display: 'block',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontWeight: 600,
                        color: accentHex(color, dark),
                      }}
                    >
                      {rangeLabel}
                    </Typography>
                  ) : null}
                  <Typography
                    variant="body2"
                    sx={{
                      mt: 0.5,
                      display: 'block',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: 'text.primary',
                      textDecoration: done ? 'line-through' : 'none',
                    }}
                  >
                    {isTask ? (
                      <Box component="span" aria-hidden sx={{ mr: 0.5 }}>
                        {done ? '☑' : '☐'}
                      </Box>
                    ) : null}
                    {item.title}
                  </Typography>
                  {item.location ? (
                    <Typography
                      variant="caption"
                      sx={{
                        mt: 0.5,
                        display: 'block',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        color: 'text.secondary',
                      }}
                    >
                      {item.location}
                    </Typography>
                  ) : null}
                </Box>
              </ListItemButton>
            </ListItem>
          );
        })}

        {items.length === 0 ? (
          <ListItem disablePadding>
            <Box
              sx={{
                display: 'flex',
                width: '100%',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 1,
                px: 2,
                py: 4,
                textAlign: 'center',
                color: 'text.secondary',
              }}
            >
              <CalendarMonthOutlined aria-hidden sx={{ fontSize: 32, color: 'text.disabled' }} />
              <Typography variant="subtitle2" color="text.primary">
                Nothing scheduled
              </Typography>
              <Typography variant="body2">
                This day is clear. Add an event, or drag one here from another day.
              </Typography>
            </Box>
          </ListItem>
        ) : null}
      </List>

      {drag.ghost ? <DragGhostLabel ghost={drag.ghost} /> : null}
    </Box>
  );
}
