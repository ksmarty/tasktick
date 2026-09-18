'use client';

/**
 * The calendars panel: one row per calendar with a visibility switch.
 *
 * Visibility is a per-user preference stored on the calendar itself, so the
 * switch PATCHes `/api/calendars/[id]` and the *query* is what changes — the
 * client never filters another calendar's events out of a payload it already
 * received, which is what keeps "what is on screen" equal to "what was asked
 * for". The colour dot is resolved with the calendar's `colorOverride`.
 *
 * It is not mounted by the calendar screen (the shell's sidebar and the filter
 * chip cover the same ground), but it is part of the feature's public surface
 * and is kept on Material like the rest of it.
 */
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Check from '@mui/icons-material/Check';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import Add from '@mui/icons-material/Add';
import { accentHex, resolveCalendarColor } from '@/lib/colors';
import type { Calendar } from '@/lib/types';
import type { CalendarFilter } from './types';

export interface CalendarSidebarProps {
  calendars: Calendar[];
  /** Effective visibility per calendar id (local override wins until saved). */
  visibility: Record<string, boolean>;
  onToggleVisibility: (calendar: Calendar, visible: boolean) => void;
  /** Pins the view to one calendar (`?calendar=`). */
  onFocusCalendar: (calendar: Calendar) => void;
  filter: CalendarFilter | null;
  onClearFilter: () => void;
  onCreateEvent: () => void;
}

export function CalendarSidebar({
  calendars,
  visibility,
  onToggleVisibility,
  onFocusCalendar,
  filter,
  onClearFilter,
  onCreateEvent,
}: CalendarSidebarProps) {
  return (
    <Box sx={{ display: 'grid', gap: 2, py: 2 }}>
      <Box sx={{ mx: 2 }}>
        <Typography variant="overline" component="h2" color="text.secondary" sx={{ display: 'block', pb: 0.5 }}>
          Calendars
        </Typography>
        <List disablePadding>
          {calendars.map((calendar) => {
            const color = resolveCalendarColor(calendar.color, calendar.colorOverride);
            const visible = visibility[calendar.id] ?? calendar.isVisible;
            const focused = filter?.id === calendar.id;

            return (
              <ListItem
                key={calendar.id}
                disablePadding
                secondaryAction={
                  <Switch
                    size="small"
                    checked={visible}
                    onChange={(input) => onToggleVisibility(calendar, input.target.checked)}
                    slotProps={{ input: { 'aria-label': `Show ${calendar.name}` } }}
                  />
                }
                sx={{ minHeight: 44 }}
              >
                <Box
                  aria-hidden
                  sx={{ width: 10, height: 10, ml: 2, mr: 1.5, flexShrink: 0, borderRadius: '50%', bgcolor: accentHex(color) }}
                />
                <ListItemButton
                  onClick={() => (focused ? onClearFilter() : onFocusCalendar(calendar))}
                  aria-pressed={focused}
                  sx={{ minWidth: 0, borderRadius: 1, pr: 7 }}
                >
                  <Typography
                    variant="body2"
                    noWrap
                    sx={{ flex: 1, fontWeight: focused ? 600 : 400, color: focused ? 'primary.main' : 'text.primary' }}
                  >
                    {calendar.name}
                  </Typography>
                  {focused ? <Check aria-hidden sx={{ fontSize: 16, color: 'primary.main' }} /> : null}
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>
        {calendars.length === 0 ? (
          <Typography variant="body2" color="text.disabled" sx={{ px: 0.5, py: 1 }}>
            No calendars yet.
          </Typography>
        ) : null}
      </Box>

      <Box sx={{ mx: 2 }}>
        <Button variant="contained" fullWidth startIcon={<Add />} onClick={onCreateEvent}>
          New event
        </Button>
      </Box>
    </Box>
  );
}
