'use client';

/**
 * Data export.
 *
 * Both links hit `/api/export`, which sets `Content-Disposition` and streams the
 * file — so they are plain anchors (`ListItemButton component="a"`), not
 * `next/link`s: a routed navigation would try to render a JSON dump as a page.
 * The JSON export is the complete copy (tasks, habits with their history,
 * events, settings); the ICS export is for calendar apps and deliberately cannot
 * carry habit history, which is why both are offered.
 */
import Box from '@mui/material/Box';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import DownloadIcon from '@mui/icons-material/Download';
import DescriptionIcon from '@mui/icons-material/Description';
import type { ComponentType } from 'react';
import type { SvgIconProps } from '@mui/material/SvgIcon';
import { SettingsGroup } from './SettingsGroup';

function ExportRow({ href, icon: Icon, title, subtitle }: { href: string; icon: ComponentType<SvgIconProps>; title: string; subtitle: string }) {
  return (
    <ListItemButton component="a" href={href} download>
      <ListItemIcon sx={{ minWidth: 40 }}>
        <Box
          aria-hidden
          sx={{
            display: 'grid',
            placeItems: 'center',
            width: 32,
            height: 32,
            borderRadius: 1,
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
          }}
        >
          <Icon fontSize="small" />
        </Box>
      </ListItemIcon>
      <ListItemText primary={title} secondary={subtitle} slotProps={{ secondary: { noWrap: true } }} />
      <DownloadIcon fontSize="small" aria-hidden sx={{ color: 'text.disabled' }} />
    </ListItemButton>
  );
}

export function DataExportCard() {
  return (
    <SettingsGroup
      title="Your data"
      footer="The JSON file contains everything, including habit history, which iCalendar cannot represent. The CalDAV password is never included."
    >
      <ExportRow
        href="/api/export"
        icon={DescriptionIcon}
        title="Download everything (JSON)"
        subtitle="Tasks, lists, tags, habits and their history, events and settings"
      />
      <ExportRow
        href="/api/export?format=ics"
        icon={CalendarMonthIcon}
        title="Download calendars (ICS)"
        subtitle="For Apple Calendar, Google Calendar or Thunderbird"
      />
    </SettingsGroup>
  );
}
