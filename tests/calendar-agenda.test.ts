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
    expect(AGENDA).toContain('w-px shrink-0 self-stretch bg-border');
    expect(AGENDA).toContain("index < items.length - 1 && '-mb-3'");
  });

  it('sets the gutter label below text-xs and keeps it right-aligned', () => {
    expect(AGENDA).toContain('text-right text-[0.6875rem] text-muted-foreground tabular-nums');
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
