/**
 * The settings surface for editing subscriptions and the task-list switch,
 * pinned from source.
 *
 * There is no jsdom here, so — as with `settings-ical.test.ts` — the contract is
 * pinned structurally: the controls the user asked for exist, they are wired to
 * the right endpoints, and the copy that distinguishes the two visibility flags
 * is present. The behaviour behind the endpoints is covered separately in
 * `ical-subscription-edit.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(relativeToSrc: string): string {
  return readFileSync(new URL(`../src/${relativeToSrc}`, import.meta.url), 'utf8');
}

const SECTION = read('components/settings/IcalSubscribeSection.tsx');
const DIALOG = read('components/settings/IcalSubscriptionDialog.tsx');
const EDITOR = read('components/settings/CalendarListEditor.tsx');

describe('editing an iCal subscription', () => {
  it('exposes edit and remove on every row', () => {
    expect(SECTION).toContain('aria-label={`Edit ${calendar.name}`}');
    expect(SECTION).toContain('aria-label={`Unsubscribe from ${calendar.name}`}');
    expect(SECTION).toContain('aria-label={`Refresh ${calendar.name}`}');
  });

  it('confirms removal, because it deletes the mirrored events', () => {
    expect(SECTION).toContain('`Unsubscribe from ${removeTarget?.name ?? \'this feed\'}?`');
    expect(SECTION).toContain('/api/ical/subscriptions/${calendar.id}');
  });

  it('opens the create/edit dialog from the group action and the row pencil', () => {
    expect(SECTION).toContain("from './IcalSubscriptionDialog'");
    expect(SECTION).toContain('<IcalSubscriptionDialog');
    expect(SECTION).toContain('onClick={openCreate}');
    expect(SECTION).toContain('onClick={() => openEdit(calendar)}');
  });

  it('paints each row with the calendar colour resolver, custom hex included', () => {
    expect(SECTION).toContain("from '@/components/calendar/colors'");
    expect(SECTION).toContain('calendarColorHex(calendar)');
  });
});

describe('the subscription colour picker', () => {
  it('offers the shared palette and a custom colour control', () => {
    expect(DIALOG).toContain('AccentSwatches');
    expect(DIALOG).toContain('type="color"');
    expect(DIALOG).toContain('aria-label="Custom colour"');
  });

  it('writes a custom colour to colorOverride, the existing calendar field', () => {
    expect(DIALOG).toContain('colorOverride: customHex');
    expect(DIALOG).toContain('customCalendarHex(subscription?.colorOverride)');
    expect(DIALOG).toContain("'/api/ical/subscriptions'");
    expect(DIALOG).toContain('/api/ical/subscriptions/${subscription.id}');
  });

  it('lets a palette swatch clear the custom colour again', () => {
    expect(DIALOG).toContain('value={customHex ? null : color}');
    expect(DIALOG).toContain('setCustomHex(null)');
  });
});

describe('the task-list visibility switch', () => {
  it('sits beside the calendar visibility control with copy that separates them', () => {
    expect(EDITOR).toContain('Show in the task list');
    expect(EDITOR).toContain('Visible in the calendar');
    expect(EDITOR).toContain('Drawn on the calendar screen.');
    expect(EDITOR).toContain('Its events also appear beside your tasks.');
    expect(EDITOR).toContain('id="calendar-show-in-tasks"');
    expect(EDITOR).toContain('aria-label="Show in the task list"');
  });

  it('sends the flag with both create and edit saves', () => {
    expect(EDITOR).toContain('setShowInTasks(calendar?.showInTasks ?? true)');
    expect(EDITOR).toContain('showInTasks,\n          })');
    expect(EDITOR).toContain('{ name: trimmed, color, isVisible, showInTasks }');
  });

  it('lets a read-only calendar still save its local view preferences', () => {
    // The name/colour belong to the remote, but visibility and the task-list
    // switch do not — so the Save button cannot be dead for a synced calendar.
    expect(EDITOR).toContain('if (readOnly)');
    expect(EDITOR).toContain('{ isVisible, showInTasks }');
    expect(EDITOR).not.toContain('disabled={save.isPending || readOnly}');
  });
});

/*
 * A hidden calendar reads as dimmed in the list.
 *
 * `isVisible === false` used to render like any other row, so the only way to
 * tell a hidden calendar was to read its eye glyph. The row's content (swatch,
 * name, subtitle) is now dimmed while the eye toggle itself stays at full
 * strength, and the toggle carries `aria-pressed` so its state is announced as
 * well as its Hide/Show label.
 */
describe('a hidden calendar is dimmed, and its toggle still speaks', () => {
  it('dims the swatch and the name/subtitle block, but not the controls', () => {
    expect(EDITOR).toContain("!calendar.isVisible && 'opacity-40'");
    expect(EDITOR).toContain("!calendar.isVisible && 'opacity-60'");
    // The trailing controls are a sibling of the dimmed block, so they keep full
    // opacity and do not read as disabled.
    expect(EDITOR).toContain('<span className="flex shrink-0 items-center">');
  });

  it('names the toggle state as well as its action', () => {
    expect(EDITOR).toContain('aria-label={calendar.isVisible ? `Hide ${calendar.name}` : `Show ${calendar.name}`}');
    expect(EDITOR).toContain('aria-pressed={calendar.isVisible}');
  });
});
