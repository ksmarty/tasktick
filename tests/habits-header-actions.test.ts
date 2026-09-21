/**
 * What the habits screen's header and the shell's bottom band each own.
 *
 * Two changes are pinned here, and both are the kind that decay silently:
 *
 *  1. **The archived-habits filter is a one-tap eye toggle**, not a switch inside
 *     a "list options" popover. Like the tasks screen's completed-rows control it
 *     must say which way the tap goes — "Hide archived habits" while they are
 *     showing — and expose that state through `aria-pressed`, not only through
 *     the icon and the tint. A toggle whose name is a static "Archived habits"
 *     reads as a setting with an unknown current state.
 *
 *  2. **There is exactly one "New habit" control, and it is the shell's action
 *     button.** Habits was excluded from the band while the screen carried its
 *     own `+` in the header; that `+` is gone, so the exclusion had to go too.
 *     The band renders its button off `PRIMARY_ACTION_LABEL` (one name per tab),
 *     which matters because a screen that does not subscribe to
 *     `requestPrimaryAction` renders a button that does nothing — the failure
 *     the old comment warned about. So this also pins that the habits screen
 *     subscribes, and that the callback it subscribes with opens the editor.
 *
 * The client components cannot be rendered in node, so the contract is pinned
 * from source, like the rest of this suite.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relative: string): string {
  return readFileSync(new URL(`../src/${relative}`, import.meta.url), 'utf8');
}

const PAGE = source('app/(app)/habits/page.tsx');
const SHELL = source('components/app/AppShell.tsx');

/** The band's per-tab name map, as written in `AppShell`. */
const labelMap = (() => {
  const start = SHELL.indexOf('const PRIMARY_ACTION_LABEL');
  if (start < 0) throw new Error('PRIMARY_ACTION_LABEL is gone from AppShell');
  const end = SHELL.indexOf('};', start);
  if (end < 0) throw new Error('PRIMARY_ACTION_LABEL has no end');
  return SHELL.slice(start, end);
})();

describe('the archived filter is a one-tap eye, not an overflow popover', () => {
  it('is the tasks screen’s eye control, reused rather than re-drawn', () => {
    expect(PAGE).toContain("from '@/components/tasks/HeaderActionButton'");
    expect(PAGE).toContain('icon={showArchived ? EyeOpenIcon : EyeNoneIcon}');
  });

  it('announces the action in both states, and its pressed state', () => {
    expect(PAGE).toContain(
      "aria-label={showArchived ? 'Hide archived habits' : 'Show archived habits'}",
    );
    expect(PAGE).toContain('aria-pressed={showArchived}');
    // The engaged state is painted, not only announced.
    expect(PAGE).toContain("variant={showArchived ? 'filled' : 'tinted'}");
  });

  it('no longer has a list-options popover to hold the switch', () => {
    expect(PAGE).not.toContain('Habit list options');
    expect(PAGE).not.toContain('DotsHorizontalIcon');
    expect(PAGE).not.toContain('Popover');
  });

  it('keeps the filter’s explanatory line, attached to the rows it explains', () => {
    const sentence = 'Archived habits keep their history but are not part of the daily check-ins.';
    const at = PAGE.indexOf(sentence);
    const gate = PAGE.indexOf('{showArchived ? (');
    const list = PAGE.indexOf('<HabitList');
    // It exists, it sits under the `showArchived` gate, and it is above the list
    // it describes — not in the header, where a one-tap toggle has no room, and
    // not shown permanently, where it would explain rows that are not there.
    expect(at).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(at);
    expect(at).toBeLessThan(list);
  });
});

describe('habits has one create affordance: the shell’s action button', () => {
  it('drops the header’s own + and everything else in the bar', () => {
    expect(PAGE).not.toContain('aria-label="New habit"');
    // The empty state keeps its own "Add your first habit" button, so the icon
    // itself stays imported; only the header's copy is gone.
    expect(PAGE).toContain('Add your first habit');
  });

  it('names the habit action for the habits tab, and only for a tab that listens', () => {
    expect(labelMap).toContain("habits: 'New habit'");
    expect(labelMap).toContain("tasks: 'Add a task'");
    expect(labelMap).toContain("calendar: 'New event'");
    // Settings subscribes to nothing, so it must have no entry: an entry there
    // would render a button that does nothing.
    expect(labelMap).not.toContain('settings');
  });

  it('renders the button from that one map, so name and existence cannot disagree', () => {
    expect(SHELL).toContain('const primaryActionLabel = PRIMARY_ACTION_LABEL[activeTab];');
    expect(SHELL).toContain('{primaryActionLabel ? <QuickAddFab label={primaryActionLabel} /> : null}');
    // The old hand-written per-tab ternary is what drifted.
    expect(SHELL).not.toContain("activeTab === 'calendar' ? (");
  });

  it('subscribes to the event the button fires, opening the habit editor', () => {
    const at = PAGE.indexOf('usePrimaryAction(');
    expect(at).toBeGreaterThan(-1);
    const body = PAGE.slice(at, PAGE.indexOf('),', at));
    // The same two writes `openEditor(null)` makes: no habit, editor open.
    expect(body).toContain('setEditing(null)');
    expect(body).toContain('setEditorOpen(true)');
  });
});

describe('the band still clears the habits pane', () => {
  it('keeps the shared reservation the FAB is smaller than', () => {
    // The pill is 58px and the reservation is 86px; the FAB is 56px, so the
    // number the six panes share does not move for this change.
    expect(PAGE).toContain('pb-[calc(env(safe-area-inset-bottom)_+_5.375rem)] lg:pb-0');
  });
});
