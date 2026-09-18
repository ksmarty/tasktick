'use client';

/**
 * The day detail sheet: everything happening on one day.
 *
 * This is what a tap on a month cell opens, and it is the only place a crowded
 * day is shown in full — hence the explicit "New event" action, so the dialog is
 * also the quickest way to add something to that day.
 *
 * Material's `Dialog` replaces the hand-rolled bottom sheet, so the focus trap,
 * the scroll lock, Escape and the backdrop tap are Material's own rather than a
 * second implementation layered on top of them.
 */
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import Typography from '@mui/material/Typography';
import { useColorScheme } from '@mui/material/styles';
import Add from '@mui/icons-material/Add';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import Check from '@mui/icons-material/Check';
import { accentHex, resolveCalendarColor } from '@/lib/colors';
import { formatTime, fromDateOnly, relativeDayLabel } from '@/lib/dates';
import type { CalendarItem, DateOnly } from '@/lib/types';
import type { CalendarLookup, CalendarPrefs, ItemOpenHandler } from './types';

/** Default slot for the dialog's own "New event" action. */
export const DEFAULT_EVENT_START_MINUTE = 9 * 60;

export interface DayDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: DateOnly;
  items: CalendarItem[];
  calendars: CalendarLookup;
  prefs: CalendarPrefs;
  onOpenItem: ItemOpenHandler;
  onCreateAt: (date: DateOnly, startMinute: number) => void;
}

export function DayDetailSheet({
  open,
  onOpenChange,
  date,
  items,
  calendars,
  prefs,
  onOpenItem,
  onCreateAt,
}: DayDetailSheetProps) {
  /** The resolved appearance, so an accent token maps to the right hex. */
  const { colorScheme } = useColorScheme();
  const dark = colorScheme === 'dark';
  const title = fromDateOnly(date, prefs.zone).toFormat('cccc d LLLL');
  const description = relativeDayLabel(date, prefs.zone);

  return (
    <Dialog
      open={open}
      onClose={() => onOpenChange(false)}
      fullWidth
      maxWidth="xs"
      aria-labelledby="day-detail-title"
      aria-describedby="day-detail-description"
    >
      <DialogTitle id="day-detail-title">{title}</DialogTitle>
      <DialogContent dividers sx={{ px: 2 }}>
        <Typography id="day-detail-description" variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {description}
        </Typography>

        {items.length === 0 ? (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 1,
              px: 2,
              py: 3,
              textAlign: 'center',
            }}
          >
            <CalendarMonthOutlined aria-hidden sx={{ fontSize: 32, color: 'text.disabled' }} />
            <Typography variant="subtitle2">Nothing scheduled</Typography>
            <Typography variant="body2" color="text.secondary">
              This day is clear. Add an event, or drag one here from another day.
            </Typography>
          </Box>
        ) : (
          <List disablePadding>
            {items.map((item) => {
              const calendar = item.calendarId ? calendars.get(item.calendarId) : undefined;
              const color = resolveCalendarColor(calendar?.color ?? null, calendar?.colorOverride ?? null);
              const time = item.isAllDay
                ? 'All day'
                : `${formatTime(item.startMs, prefs)} – ${formatTime(item.endMs, prefs)}`;

              return (
                <ListItem key={item.key} disablePadding>
                  <ListItemButton
                    onClick={() => onOpenItem(item)}
                    sx={{ gap: 1.5, minHeight: 44, borderRadius: 1 }}
                  >
                    <Box
                      aria-hidden
                      sx={{ width: 10, height: 10, flexShrink: 0, borderRadius: '50%', bgcolor: accentHex(color, dark) }}
                    />
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography
                        variant="body2"
                        noWrap
                        sx={{
                          color: item.completed ? 'text.secondary' : 'text.primary',
                          textDecoration: item.completed ? 'line-through' : 'none',
                        }}
                      >
                        {item.kind === 'task' ? (
                          <Box component="span" aria-hidden sx={{ mr: 0.5 }}>
                            {item.completed ? '☑' : '☐'}
                          </Box>
                        ) : null}
                        {item.title}
                      </Typography>
                      {item.location ? (
                        <Typography variant="caption" noWrap component="div" color="text.secondary">
                          {item.location}
                        </Typography>
                      ) : null}
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                      {time}
                    </Typography>
                    {item.completed ? <Check aria-hidden sx={{ fontSize: 16, color: 'success.main' }} /> : null}
                  </ListItemButton>
                </ListItem>
              );
            })}
          </List>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 2, py: 1.5 }}>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => onCreateAt(date, DEFAULT_EVENT_START_MINUTE)}
        >
          New event
        </Button>
      </DialogActions>
    </Dialog>
  );
}
