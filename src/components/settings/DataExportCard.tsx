'use client';

/**
 * Data export.
 *
 * Both links hit `/api/export`, which sets `Content-Disposition` and streams the
 * file — so they are plain anchors with `download`, not `next/link`s: a routed
 * navigation would try to render a JSON dump as a page. The JSON export is the
 * complete copy (tasks, habits with their history, events, settings); the ICS
 * export is for calendar apps and deliberately cannot carry habit history, which
 * is why both are offered.
 *
 * Each row is the link itself — the whole row is the touch target, as it was
 * when these were `ListItemButton component="a"` — and it borrows the area's row
 * padding from `SETTINGS_ROW_CLASS` rather than restating it, so an export row
 * lines up with every other row on the screen.
 */
import { CalendarIcon } from '@svg-animated-icons/react/calendar';
import { DownloadIcon } from '@svg-animated-icons/react/download';
import { FileTextIcon } from '@svg-animated-icons/react/file-text';
import { cn } from '@/lib/utils';
import { SETTINGS_ROW_CLASS, SettingsGroup } from './SettingsGroup';

function ExportRow({
  href,
  icon: Icon,
  title,
  subtitle,
}: {
  href: string;
  icon: typeof FileTextIcon;
  title: string;
  subtitle: string;
}) {
  return (
    <a
      href={href}
      download
      className={cn(SETTINGS_ROW_CLASS, 'flex items-center gap-3 transition-colors hover:bg-accent/50')}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
        <Icon />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
      </span>
      <DownloadIcon className="text-muted-foreground" />
    </a>
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
        icon={FileTextIcon}
        title="Download everything (JSON)"
        subtitle="Tasks, lists, tags, habits and their history, events and settings"
      />
      <ExportRow
        href="/api/export?format=ics"
        icon={CalendarIcon}
        title="Download calendars (ICS)"
        subtitle="For Apple Calendar, Google Calendar or Thunderbird"
      />
    </SettingsGroup>
  );
}
