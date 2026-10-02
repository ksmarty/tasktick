/**
 * The calendar-subscription section, pinned from source.
 *
 * The two settings cards that used to hold the outgoing feed — one listing the
 * subscriptions, one to create another — are merged into a single
 * `SettingsGroup`. There is no jsdom here, so the merge is pinned structurally:
 * one group, both halves present inside it, and every endpoint the two cards
 * used still reached.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CARD = readFileSync(new URL('../src/components/settings/IcalSubscriptionCard.tsx', import.meta.url), 'utf8');

describe('the subscription surface is one section', () => {
  it('renders exactly one SettingsGroup', () => {
    expect(CARD.match(/<SettingsGroup\b/g)?.length).toBe(1);
  });

  it('keeps both halves of the job inside it', () => {
    expect(CARD).toContain('No subscriptions yet');
    expect(CARD).toContain('New subscription');
    expect(CARD).toContain('Your new subscription URL');
  });

  it('keeps every endpoint the two cards used', () => {
    expect(CARD).toContain("useResource<IcalTokenPayload[]>('/api/ical-tokens')");
    expect(CARD).toContain("api.post<IcalTokenPayload>('/api/ical-tokens'");
    expect(CARD).toContain('/api/ical-tokens/${token.id}');
    expect(CARD).toContain('toWebcal(');
  });
});

/*
 * A subscribed calendar owns its events, not its label.
 *
 * `readOnly` means the contents are mirrored, and the calendar editor was applying
 * it to the *name* as well — so every subscribed feed opened with its name field
 * disabled and no way to rename it from Settings -> Calendars. The reported
 * symptom was a greyed-out name and a colour that would not save.
 *
 * The distinction that matters is whether anything will overwrite the value: the
 * CalDAV sync rewrites `name` on every pass, a feed refresh touches neither. A
 * chosen colour is different again — it is stored as `colorOverride`, which the
 * sync only seeds and never overwrites — so a writable CalDAV collection must
 * reach the CalDAV branch *before* `readOnly` is consulted, or its colour pick is
 * written to `color` and loses to the override the display prefers.
 *
 * Pinned from source because there is no jsdom here.
 */
const EDITOR = readFileSync(
  new URL('../src/components/settings/CalendarListEditor.tsx', import.meta.url),
  'utf8',
);

describe('a mirrored calendar can still be renamed', () => {
  it('keys the name field off the provider, not readOnly', () => {
    // The exact regression: `disabled={readOnly}` on the name input.
    expect(EDITOR).toContain('disabled={remoteOwnsIdentity}');
    expect(EDITOR).not.toMatch(/id="calendar-name"[\s\S]{0,220}disabled=\{readOnly\}/);
  });

  it('only the provider that rewrites the name is treated as owning it', () => {
    // CalDAV rewrites name and colour on every sync; iCal does not.
    expect(EDITOR).toMatch(/remoteOwnsIdentity\s*=\s*calendar\?\.provider === 'caldav'/);
  });

  it('saves the name and colour for a calendar nothing overwrites', () => {
    // A feed is not read-only to its label: its branch sends the name and colour.
    expect(EDITOR).toMatch(/if \(readOnly\) \{[\s\S]{0,600}name: label,/);
    // A CalDAV collection sends only the local preferences — never the name the
    // sync would immediately replace — and its colour only as an override.
    expect(EDITOR).toMatch(
      /if \(calendar && remoteOwnsIdentity\) \{[\s\S]{0,300}isVisible,\s*showInTasks,\s*dedupeEvents,\s*defaultReminders,\s*\.\.\.\(colorTouched \? \{ colorOverride: color \} : \{\}\),/,
    );
  });

  it('decides the CalDAV case before readOnly, so a writable collection saves its colour', () => {
    // The bug behind "I can't change the colour of a CalDAV calendar": the CalDAV
    // branch was nested inside `if (readOnly)`, so the ordinary writable case fell
    // through to the generic path and wrote `color` instead of `colorOverride`.
    const caldav = EDITOR.indexOf('if (calendar && remoteOwnsIdentity)');
    const readonly = EDITOR.indexOf('if (readOnly)');
    expect(caldav).toBeGreaterThan(-1);
    expect(readonly).toBeGreaterThan(-1);
    expect(caldav).toBeLessThan(readonly);
  });
});

/*
 * A row must let a long value shrink.
 *
 * A non-stacked `SettingsRow` is a flex row, so its children are flex items with
 * the default `min-width: auto` and refuse to shrink below their content. A feed
 * URL therefore never truncated: it kept its full width and pushed the row's
 * trailing buttons past the card, clipping the last one off the screen. The fix
 * lives on the row rather than on one child, so a row added later with long text
 * inherits it.
 */
const GROUP = readFileSync(
  new URL('../src/components/settings/SettingsGroup.tsx', import.meta.url),
  'utf8',
);

describe('a settings row lets its content shrink', () => {
  it('applies min-width: 0 to the children of a row', () => {
    expect(GROUP).toContain("export const SETTINGS_ROW_CHILDREN_CLASS = '[&>*]:min-w-0'");
  });

  it('uses it for the non-stacked row, where the overflow happened', () => {
    expect(GROUP).toMatch(/flex items-center gap-3', SETTINGS_ROW_CHILDREN_CLASS/);
  });
});

/*
 * A mirror is unsubscribed from, not deleted, and has no default.
 *
 * Both were wrong for a subscribed calendar: the button said "Delete calendar"
 * and the dialog offered "Make default" (disabled, but present). "Default" is
 * where new events and tasks are created, and nothing is ever created in a
 * feed — so the control could only ever be disabled. The wording matters too:
 * the events were never ours to delete.
 */
describe('a mirrored calendar is unsubscribed from, not deleted', () => {
  it("labels the action by what it does", () => {
    expect(EDITOR).toMatch(/readOnly \? .Unsubscribe. : .Delete calendar./);
  });

  it("asks the matching question in the confirmation", () => {
    expect(EDITOR).toContain('Unsubscribe from ');
    expect(EDITOR).toContain('The events mirrored from it are removed too.');
  });

  it("hides the default-calendar row for a mirror", () => {
    expect(EDITOR).toMatch(/\{readOnly \? null : \(/);
  });

  it("still offers Delete and Default for a calendar of ours", () => {
    // The local path must not be collateral damage.
    expect(EDITOR).toContain("'Delete calendar'");
    expect(EDITOR).toContain('Make default');
  });
});
