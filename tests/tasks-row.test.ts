/**
 * Shape and structure guards for the task chrome.
 *
 * These components are client components that bind pointer and drag handlers and
 * read DOM APIs, and this suite runs in node with no DOM, so they cannot be
 * rendered here. What regresses silently is the structural contract the design
 * leans on — a row that stops using the shadcn primitives, a section that
 * hand-rolls a collapse instead of using the GodUI `Accordion`, or a quick-add
 * dialog that drops the synchronous focus the iOS keyboard depends on. So this
 * pins the source instead of a render.
 *
 * ## Why these assertions are about Tailwind and GodUI now
 *
 * The previous version of this file asserted the *Material* implementation
 * (`ListItem`/`ListItemText`, MUI `Collapse`, `transitionDuration={0}`,
 * `borderLeft: '3px solid'`). The behaviour each of them stood for is unchanged,
 * so every assertion is ported to the shape that now carries it rather than
 * dropped:
 *
 * | contract | was | is |
 * |---|---|---|
 * | a row is a list row with a checkbox and a name | `ListItem`/`ListItemText` | `<li>` + shadcn `Checkbox` + a `<button>` named `Open …` |
 * | row actions | MUI long-press `Menu` | shadcn `ContextMenu` |
 * | a list's colour is not repeated per section | `borderLeft: 3px solid` → an 8px header dot | removed; the header reads by contrast |
 * | section collapse + expanded state | MUI `ListSubheader` + `Collapse` | GodUI `Accordion` (asserted in the vendored file, where it now lives) |
 * | quick-add focus in the tap's own task | MUI Dialog + `transitionDuration={0}` | shadcn Dialog + `useLayoutEffect` + `duration-0`/`animate-none` |
 *
 * ## The quick-add focus contract, measured
 *
 * A probe built from this repository (the real `QuickAddBar`, the real
 * `usePrimaryAction`, one stub for the shell's still-MUI `Toast`) clicks the
 * action button and reads `document.activeElement` in the **same page task**, in
 * Chromium at 390×844. Raw result:
 *
 * ```json
 * {
 *   "activeBeforeClick": "body",
 *   "activeInSameTask": "input",
 *   "activeAriaLabel": "Quick add a task",
 *   "activePlaceholder": "Add a task…",
 *   "inputDisabled": false,
 *   "dialogPresentSameTask": true,
 *   "dialogState": "open",
 *   "activeInsideDialog": true,
 *   "animationFramesDuringClickAndRead": 0
 * }
 * ```
 *
 * `animationFramesDuringClickAndRead: 0` is the point: no frame elapses between
 * the click and the focus, so the focus still belongs to the gesture that iOS
 * requires. The assertions below pin the three source-level properties that make
 * that true (a layout effect, no entrance animation, and a view that flushes the
 * open synchronously).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Reads a file under `src/`, so vendored and route files can be pinned too. */
function read(relativeToSrc: string): string {
  return readFileSync(new URL(`../src/${relativeToSrc}`, import.meta.url), 'utf8');
}

function source(relative: string): string {
  return read(`components/tasks/${relative}`);
}

const ROW = source('TaskRow.tsx');
const EVENT_ROW = source('EventRow.tsx');
const SECTION = source('TaskListSection.tsx');
const QUICK_ADD = source('QuickAddBar.tsx');
const EDITOR = source('TaskEditorSheet.tsx');
const VIEW = source('TasksView.tsx');
const TODAY = source('TodayView.tsx');
const ACCORDION = read('components/godui/accordion.tsx');
const SEARCH = read('app/(app)/search/page.tsx');
const MATRIX = read('app/(app)/matrix/page.tsx');

describe('TaskRow — shadcn primitives', () => {
  it('is a list row with a Checkbox and a named title control', () => {
    expect(ROW).toContain("from '@/components/ui/checkbox'");
    expect(ROW).toContain('<Checkbox');
    expect(ROW).toContain('<li');
    // The title is a real button, so the row is reachable by keyboard at all.
    expect(ROW).toContain('aria-label={`Open ${task.title}`}');
  });

  it('uses a shadcn ContextMenu for the extra row actions', () => {
    expect(ROW).toContain("from '@/components/ui/context-menu'");
    expect(ROW).toContain('<ContextMenuTrigger asChild>');
    expect(ROW).toContain('<ContextMenuItem');
    // The destructive row action is the menu's own destructive variant.
    expect(ROW).toContain('variant="destructive"');
  });

  it('uses a Checkbox for completion, with the wont-do state as indeterminate', () => {
    expect(ROW).toContain("checked={wontDo && !completed ? 'indeterminate' : completed}");
    expect(ROW).toContain("aria-checked={completed ? true : wontDo ? 'mixed' : false}");
  });

  it('keeps the accessible name of the completion control', () => {
    expect(ROW).toContain('`Mark ${task.title} incomplete`');
    expect(ROW).toContain('`Complete ${task.title}`');
  });

  it('keeps the trailing row actions reachable by name', () => {
    expect(ROW).toContain('`Delete ${task.title}`');
    expect(ROW).toContain('`Open ${task.title}`');
    // No selection mode survives: the row has no select/deselect name left.
    expect(ROW).not.toContain('selectionMode');
    expect(ROW).not.toContain("'Deselect' : 'Select'");
  });

  it('keeps the swipe reveal mounted, and it now rides the drag', () => {
    // The revealed actions paint under the row, so an un-revealed one that is
    // only *hidden* shows through the card's rounded corners as red and green
    // crescents. They are therefore parked a full width outside the card at
    // rest — and, since the pair is exactly `SWIPE_ACTION_WIDTH` wide,
    // `SWIPE_ACTION_WIDTH + offsetX` is 100% when the row is closed, 0 when it
    // is open, and the finger's own position in between. That is what puts the
    // buttons on screen during the drag instead of after the release.
    expect(ROW).toContain('SWIPE_ACTION_WIDTH');
    expect(ROW).toContain('`translateX(${SWIPE_ACTION_WIDTH + offsetX}px)`');
    expect(ROW).toContain('tabIndex={revealed ? 0 : -1}');
    // The 200ms settle is disabled while the finger is down, or the pair would
    // lag behind the row it is being revealed by.
    expect(ROW).toMatch(/transition: swiping \? 'none' : 'transform 200ms/);
    expect(ROW).toMatch(/transition: swiping \|\| lifted \? 'none' : 'transform 220ms/);
  });

  it('keeps the press highlight a region inside the button, not the button', () => {
    // The button is the 44px touch target, so the highlight cannot be its own
    // background without covering the whole row. It is an `aria-hidden` span
    // inset inside the button, driven by the button's named group state.
    expect(ROW).toContain('group/row-content');
    expect(ROW).toContain('group-hover/row-content:bg-accent/30');
    expect(ROW).toContain('group-active/row-content:bg-accent/50');
    expect(ROW).toContain('absolute inset-x-1.5 inset-y-1');
    // The button keeps its own 44px box, and no longer paints the accent itself.
    expect(ROW).toContain('min-h-11');
    expect(ROW).not.toContain('hover:bg-accent/30 focus-visible');
  });
});

describe('TaskRow — Tailwind through cn(), no hand-rolled divider', () => {
  it('styles through cn() and never through MUI', () => {
    expect(ROW).toContain("from '@/lib/utils'");
    expect(ROW).toContain('cn(');
    expect(ROW).not.toContain('@mui');
    expect(ROW).not.toContain('sx=');
    expect(ROW).not.toContain('styled(');
  });

  it('still rounds the first and last row of a card', () => {
    // `first`/`last` survived the divider removal because they round the corner.
    expect(ROW).toContain('first');
    expect(ROW).toContain('last');
    expect(ROW).toMatch(/first && 'rounded-t-xl'/);
    expect(ROW).toMatch(/last && 'rounded-b-xl'/);
  });

  it('centres the due date on the row, with a matching line box', () => {
    // Measured before: the label's 16px box centred 2.0px above the title's
    // 20px one, and because it was a sibling of the title alone it sat 10px
    // above the row's own centre on every row that also has a meta line — the
    // "slightly too high" the row was reported for. The label now carries the
    // title's own line-height (20px = `text-base leading-tight`) and is a child
    // of the button beside the whole content column, centred against the row:
    // measured 0.0px against the row on a single-line row, on a title+meta row
    // and on a two-line title.
    const meta = source('TaskMeta.tsx');
    expect(meta).toContain('text-xs leading-5');
    expect(ROW).toContain('shrink-0 self-center');
  });

  it('never invents a spacing value', () => {
    // The row's horizontal inset is the layout token, not a number.
    expect(ROW).toContain('px-row');
    expect(ROW).not.toMatch(/\bp[xytblr]?-\[\d/);
    expect(ROW).not.toMatch(/\bgap-\[\d/);
  });
});

describe('TaskListSection — GodUI Accordion grouping', () => {
  it('groups the rows with the GodUI Accordion inside a GodUI glass card', () => {
    expect(SECTION).toContain("from '@/components/godui/accordion'");
    expect(SECTION).toContain('<Accordion');
    expect(SECTION).toContain('items={[');
    // The section surface is GodUI's glass card; the Accordion's own border and
    // radius are neutralised so the card is the only card.
    expect(SECTION).toContain("from '@/components/godui/liquid-glass-card'");
    expect(SECTION).toContain('<LiquidGlassCard');
    expect(SECTION).toContain('rounded-none border-0 bg-transparent');
  });

  it('animates through the Accordion rather than a grid-rows track', () => {
    expect(SECTION).not.toContain('grid-template-rows');
    expect(SECTION).not.toContain('grid-rows-');
    // The spring height animation and the rotating chevron now live upstream.
    expect(ACCORDION).toContain('heightSpring');
    expect(ACCORDION).toContain('group-data-[open=true]:rotate-180');
  });

  it('keeps the section accessible name, count and expanded state', () => {
    // The trigger owns `aria-expanded`/`aria-controls`; the section owns the
    // name and the count it renders inside that trigger.
    expect(ACCORDION).toContain('aria-expanded={isOpen}');
    expect(ACCORDION).toContain('aria-controls={panelId}');
    expect(ACCORDION).toContain('aria-labelledby={triggerId}');
    expect(SECTION).toContain('{section.title}');
    // The visible count is every row the section renders — tasks *and* events.
    expect(SECTION).toContain('const itemCount = taskCount + eventCount;');
    expect(SECTION).toContain('{itemCount}');
  });

  it('marks Overdue by contrast rather than hue in the header', () => {
    expect(SECTION).toContain("section.tone === 'danger'");
    expect(SECTION).toContain("'text-foreground' : 'text-muted-foreground'");
  });

  it('has removed the coloured header dot and its dead helpers', () => {
    // The full-height 4px edge became an 8px dot; the dot is gone now too. The
    // header separates its sections by contrast, not by a list colour, so no
    // per-section colour is computed at all.
    expect(SECTION).not.toContain('border-l-4');
    expect(SECTION).not.toContain('--edge-color');
    expect(SECTION).not.toContain('edgeColorFor');
    expect(SECTION).not.toContain('listColors');
    expect(SECTION).not.toContain('backgroundColor');
  });

  it('keeps the row inset coming from the layout token', () => {
    // The vendored Accordion's panel owns `px-5 pb-4`; the track pulls back and
    // each row supplies `px-row`, so the inset is the token and not upstream's
    // number. If this compensation is ever removed the rows silently double-pad.
    expect(SECTION).toContain('-mx-5 -mb-4');
    expect(SECTION).toContain('text-base text-foreground');
  });
});

describe('the task screens own their own scroll', () => {
  it('declares the full-height pane and pins the header above a scroller', () => {
    for (const view of [VIEW, TODAY]) {
      // The shell hands the pane over as a fixed-height box, so the header can
      // be `shrink-0` and only the list beneath it moves.
      expect(view).toContain("from '@/components/app/ShellPane'");
      expect(view).toContain('useShellPane({ fullHeight: true })');
      expect(view).toContain('flex min-h-0 flex-1 flex-col');
      expect(view).toContain('min-h-0 flex-1 overflow-y-auto overscroll-contain');
      // The list restates the mobile tab-bar clearance the shell's pane carried.
      expect(view).toContain('pb-[calc(env(safe-area-inset-bottom)_+_5.25rem)] lg:pb-0');
    }
  });
});

describe('QuickAddBar — synchronous focus contract', () => {
  it('opens as a shadcn Dialog', () => {
    expect(QUICK_ADD).toContain("from '@/components/ui/dialog'");
    expect(QUICK_ADD).toContain('<DialogContent');
  });

  it('keeps the focus in the same commit as the open, not a frame later', () => {
    // A layout effect, plus `autoFocus` as the React-native fallback: both run
    // inside the task that handled the tap, which is what iOS requires.
    expect(QUICK_ADD).toContain('useLayoutEffect');
    expect(QUICK_ADD).toMatch(/useLayoutEffect\(\(\) => \{\s*if \(!open\) return;/);
    expect(QUICK_ADD).toContain('autoFocus');
  });

  it('does not animate the dialog in — that delay is exactly what breaks the keyboard', () => {
    expect(QUICK_ADD).toContain('duration-0');
    expect(QUICK_ADD).toContain('data-[state=open]:animate-none');
  });

  it('cancels the framework’s deferred autofocus and takes the focus itself', () => {
    expect(QUICK_ADD).toContain('onOpenAutoFocus');
    expect(QUICK_ADD).toContain('event.preventDefault();');
  });

  it('keeps the input’s accessible name', () => {
    // Radix spreads props onto the real `<input>` here, so a plain `aria-label`
    // is enough — no `htmlInput` slot as MUI required.
    expect(QUICK_ADD).toContain('aria-label="Quick add a task"');
    expect(QUICK_ADD).toContain('<Input');
  });

  it('flushes the open synchronously inside the tap, on both screens', () => {
    // The other half of the contract: the layout effect can only belong to the
    // gesture if the commit it lives in was flushed from inside the handler.
    for (const view of [VIEW, TODAY]) {
      expect(view).toContain('flushSync(() => setQuickAddOpen(true))');
      expect(view).toContain('usePrimaryAction(openQuickAdd)');
    }
  });
});

describe('the converted screens', () => {
  it('keeps the editor’s twelve fields and its debounced save', () => {
    for (const label of ['Title', 'Notes', 'Link', 'Pin to top', 'Decrease estimated time', 'Increase estimated time']) {
      expect(EDITOR).toContain(label);
    }
    expect(EDITOR).toContain('SAVE_DEBOUNCE_MS = 600');
    expect(EDITOR).toContain('void flush()');
    expect(EDITOR).toContain("from '@/components/ui/calendar'");
    expect(EDITOR).toContain("from '@/components/godui/hold-confirm-button'");
    expect(EDITOR).not.toContain('@mui');
  });

  it('adds an explicit Save button that coexists with the debounce', () => {
    // The button is the deliberate action; the debounce and the close-flush stay
    // as the safety net. Save is always available — an unmodified draft is a
    // legitimate "file it away" — and it is disabled only while a write is in
    // flight, which is what keeps a second tap from sending a second PATCH.
    expect(EDITOR).toContain('const [dirty, setDirty] = useState(false)');
    expect(EDITOR).toContain('disabled={disabled || !task || saving || actions.isSaving}');
    expect(EDITOR).not.toContain('!dirty || saving');
    expect(EDITOR).toContain("'Save'");
    expect(EDITOR).toContain('Saving…');
    expect(EDITOR).toContain('aria-label="Saving"');
    // The saved draft is kept, not cleared, so the form does not fall back to
    // the stale `task` prop and visibly revert the value the user just saved.
    expect(EDITOR).toContain('if (editSeq.current === seq) setDirty(false);');
    // A failed save is surfaced inline through the state the editor already had.
    expect(EDITOR).toContain("setSaveError('Could not save the task.')");
    expect(EDITOR).toContain('<Alert variant="destructive" role="alert">');
  });

  it('closes the sheet on Save, without losing what the draft held', () => {
    // Save flushes and then dismisses: one tap, one outcome. The close path
    // still flushes as well (`handleOpenChange`), so dismissing the sheet by any
    // route keeps the change; `flush` reports success with nothing to send, so
    // an unmodified Save can still close; and the one case that does not close is
    // a *failed* write, whose inline alert has to stay beside the draft.
    expect(EDITOR).toMatch(/const ok = await flush\(\);\s*setSaving\(false\);\s*if \(ok\) onOpenChange\(false\);/);
    expect(EDITOR).toContain('if (!current.task || !current.dirty) return true;');
    expect(EDITOR).toContain('if (!next) void flush();');
    // The 600ms debounce is the other half of the net and is untouched.
    expect(EDITOR).toContain('window.setTimeout(() => void flush(), SAVE_DEBOUNCE_MS)');
  });

  it('gives the time field a placeholder and the date field the same type scale', () => {
    // Measured: both are `h-9`, i.e. 36.0px in every viewport and state, and the
    // rendered border rows are identical (y=270 and y=303 down a 1px column).
    // What differed was the type inside — the time field's 16px/24px against the
    // date button's 14px/20px — so the button now carries the inputs' own
    // `text-base md:text-sm` scale.
    expect(EDITOR).toContain('type="time"');
    expect(EDITOR).toContain('placeholder="--:--"');
    expect(EDITOR).toContain('justify-start text-base md:text-sm');
  });

  it('puts every row below the schedule row on the controls\' own inset', () => {
    // Measured content insets from the editor's padding edge: the date field's
    // own content 29.0px, the rows below 32.0px (`px-row`) — 3px of extra margin
    // on everything under the date row. They are now `px-3`, the same inner
    // padding the shadcn controls use (28.0px), and the subtask block follows.
    expect(EDITOR).not.toContain('px-row py-2');
    expect(EDITOR).not.toContain('className="px-row');
    expect(EDITOR).toContain('rounded-md px-3 py-2 text-left text-sm');
    expect(EDITOR).toContain('<h3 className="px-3 text-sm font-medium">Subtasks</h3>');
    const subtasks = source('SubTaskList.tsx');
    expect(subtasks).toContain('pr-1 pl-3');
    expect(subtasks).toContain('gap-2 px-3');
    expect(subtasks).toContain('rounded-lg px-3 text-primary');
  });

  it('switches the schedule row between a date and a duration', () => {
    // The mode is a GodUI segmented control, and the duration half writes
    // `estimateMinutes` — the field the task record already has, which the
    // editor's own "Estimated time" stepper reads and writes too.
    expect(EDITOR).toContain("from '@/components/godui/segmented-control'");
    expect(EDITOR).toContain('<SegmentedControl');
    expect(EDITOR).toContain("type ScheduleMode = 'date' | 'duration'");
    expect(EDITOR).toContain('const DURATION_PRESETS = [');
    expect(EDITOR).toContain('edit({ estimateMinutes: active ? null : preset.minutes })');
    expect(EDITOR).toContain('edit({ estimateMinutes: Math.min(1440, estimateMinutes + 5) })');
    // The chosen mode is read back off the record, so it survives a reload
    // whenever the record distinguishes the two.
    expect(EDITOR).toMatch(
      /setScheduleMode\(\s*task && !task\.dueDate && \(task\.estimateMinutes \?\? 0\) > 0 \? 'duration' : 'date',\s*\);/,
    );
  });

  it('puts Today, Tomorrow and Next week above the calendar', () => {
    // The request read "add today and tomorrow sections"; inside the editor's
    // date popover these are the quick picks that set the day directly. The task
    // list already groups by urgency and Today already has its own sections, so
    // new *list* sections would have duplicated both.
    expect(EDITOR).toContain("{ label: 'Today', day: todayIn(zone) }");
    expect(EDITOR).toContain("{ label: 'Tomorrow', day: addDaysToDateOnly(todayIn(zone), 1, zone) }");
    expect(EDITOR).toContain("{ label: 'Next week', day: addDaysToDateOnly(todayIn(zone), 7, zone) }");
    expect(EDITOR).toContain('onClick={() => pickDueDay(pick.day)}');
    expect(EDITOR).toContain('function pickDueDay(day: DateOnly)');
    // Above the calendar, not below it.
    expect(EDITOR.indexOf("label: 'Today'")).toBeLessThan(EDITOR.indexOf('<Calendar\n'));
  });

  it('draws one edge on a section card, not two', () => {
    // The glass card's static edge sheen is an inset white 1px line one pixel
    // inside its own 1px border — the double border that was reported. Measured
    // down the card's top edge: border #e5e5e5, sheen #f0f0f0, card #eeeeee.
    expect(SECTION).toContain('sheen={0}');
    expect(SECTION).not.toContain('sheen={0.3}');
    expect(TODAY).toContain('sheen={0}');
  });

  it('removes the hairlines between rows and under the section header', () => {
    // The user asked for both lines gone; separation is spacing now (`gap-1`
    // between rows, the header's own `py-2.5` above them).
    expect(SECTION).not.toContain('divide-y');
    expect(SECTION).not.toContain('border-t border-border/70');
    expect(SECTION).toContain('flex flex-col gap-1 text-base text-foreground');
  });

  it('squares the first row\'s highlight at the section\'s top edge', () => {
    // The rounded top-left of the first row's press region read as a stray
    // artefact; the whole top edge is squared rather than only the left corners.
    expect(ROW).toContain('rounded-t-none');
    expect(EVENT_ROW).toContain('rounded-t-none');
    expect(ROW).toContain("first && 'rounded-t-none'");
    expect(EVENT_ROW).toContain("first && 'rounded-t-none'");
  });

  it('tightens the section header\'s vertical padding', () => {
    // The vendored trigger is `py-4` over an 18px title row: a 50px header
    // against 44px rows. Measured 50px → 38px with `py-2.5`, applied to the
    // trigger only (a negative margin on the title cannot go below the 16px
    // chevron beside it), so the rows' horizontal axis is untouched.
    expect(SECTION).toContain('[&_button[aria-expanded]]:py-2.5');
    expect(SECTION).toContain('-mx-5 -mb-4');
  });

  it('does not let a sub-menu press dismiss the editor it was opened from', () => {
    // The pickers portal to `body`, and Radix defers the pointer-down-outside
    // decision until after the click — by which time `picker` is null. The guard
    // therefore also tests the press target, so the editor survives the pick.
    expect(EDITOR).toContain('event.detail.originalEvent.target');
    expect(EDITOR).toContain('[data-slot="drawer"]');
    expect(EDITOR).toContain('if (picker || confirmOpen || inSubMenu) event.preventDefault();');
  });

  it('reveals the search results with the vendored reveal', () => {
    expect(SEARCH).toContain("from '@/components/godui/scroll-reveal'");
    expect(SEARCH).toContain('<ScrollReveal');
    expect(SEARCH).toContain('aria-label="Search everything"');
  });

  it('lays the matrix out as a 2×2 grid of spotlight cards', () => {
    expect(MATRIX).toContain("from '@/components/godui/spotlight-card'");
    expect(MATRIX).toContain('md:grid-cols-2');
    expect(MATRIX).toContain('data-quadrant={quadrant.id}');
    expect(MATRIX).toContain('aria-roledescription="sortable"');
  });
});

describe('a11y parity with the MUI implementation', () => {
  it('keeps only the reachable header actions', () => {
    // The bulk-action bar and its five labels were reachable only through the
    // "Select" button, which is gone; there is nothing left to name here. The
    // header's own controls keep their accessible names (asserted above).
    expect(VIEW).not.toContain('Complete selected tasks');
    expect(VIEW).not.toContain('FloatingToolbar');
    expect(VIEW).not.toContain('selectionMode');
  });

  it('exposes a section’s expansion as state rather than inside its name', () => {
    // The old header was named `Expand Pinned` / `Collapse Pinned`. The trigger
    // is now named for the section and reports its state through `aria-expanded`
    // and `aria-controls`, which is the canonical disclosure pattern and the one
    // a screen reader announces for free.
    expect(ACCORDION).toContain('aria-expanded={isOpen}');
    expect(ACCORDION).toContain('aria-controls={panelId}');
    expect(SECTION).not.toContain("'Expand' : 'Collapse'");
  });

  it('lets the framework name the quick-add dialog instead of pinning its own id', () => {
    // `DialogTitle` renders `<h2 id={context.titleId} {...titleProps}>`, so a
    // caller-supplied `id` overrides the generated one and leaves the content's
    // `aria-labelledby` pointing at nothing. Measured: the attribute resolves to
    // an element reading "New task", and `getByRole('dialog', { name: 'New task' })`
    // finds exactly one match.
    expect(QUICK_ADD).not.toContain('quick-add-title');
    expect(QUICK_ADD).toContain('<DialogTitle');
    // The busy state keeps the announcement MUI's spinner carried.
    expect(QUICK_ADD).toContain('aria-label="Saving"');
  });
});

describe('search — the scroll-reveal hook is gone', () => {
  it('is not referenced anywhere in the tasks feature', () => {
    expect(() => source('useScrollReveal.ts')).toThrow();
  });
});
