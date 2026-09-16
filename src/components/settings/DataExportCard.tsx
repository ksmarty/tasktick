'use client';

/**
 * Data export.
 *
 * Both links hit `/api/export`, which sets `Content-Disposition` and streams the
 * file — so they are plain anchors, not `next/link`s: a routed navigation would
 * try to render a JSON dump as a page. The JSON export is the complete copy
 * (tasks, habits with their history, events, settings); the ICS export is for
 * calendar apps and deliberately cannot carry habit history, which is why both
 * are offered.
 */
import { Download, FileJson, CalendarDays } from 'lucide-react';
import { SettingsGroup } from './SettingsGroup';

function ExportRow({
  href,
  icon: Icon,
  title,
  subtitle,
}: {
  href: string;
  icon: typeof Download;
  title: string;
  subtitle: string;
}) {
  return (
    <a
      href={href}
      download
      className="hairline-t flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left first:border-t-0 pressable-row"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-ios bg-tint-soft text-tint">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body text-label">{title}</span>
        <span className="mt-0.5 block text-footnote text-secondary">{subtitle}</span>
      </span>
      <Download className="size-4 shrink-0 text-tertiary" aria-hidden />
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
        icon={FileJson}
        title="Download everything (JSON)"
        subtitle="Tasks, lists, tags, habits and their history, events and settings"
      />
      <ExportRow
        href="/api/export?format=ics"
        icon={CalendarDays}
        title="Download calendars (ICS)"
        subtitle="For Apple Calendar, Google Calendar or Thunderbird"
      />
    </SettingsGroup>
  );
}
