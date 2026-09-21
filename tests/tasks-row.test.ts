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
    // The 200ms settle is disabled while the finger is down, or the trio would
    // lag behind the row it is being revealed by.
    expect(ROW).toMatch(/transition: swiping \? 'none' : 'transform 200ms/);
    expect(ROW).toMatch(/transition: swiping \|\| lifted \? 'none' : 'transform 220ms/);
  });

  it('reveals a Complete / Pin / Delete trio of 76px buttons', () => {
    // Three actions at the same 76px each: `SWIPE_ACTION_WIDTH` grows from
    // 152 (2 × 76, `w-38`) to 228 (3 × 76, `w-57`). The row translate and the
    // action translate are both derived from it, so growing it is the only
    // change the tracking needs — it stays 1:1.
    expect(ROW).toContain('SWIPE_ACTION_WIDTH = 228');
    expect(ROW).toContain('w-57');
    expect(ROW).not.toContain('w-38');
    // The three reachable actions, named.
    expect(ROW).toContain('`Complete ${task.title}`');
    expect(ROW).toContain('`Pin ${task.title}`');
    expect(ROW).toContain('`Unpin ${task.title}`');
    expect(ROW).toContain('`Delete ${task.title}`');
    // The label tracks the task's state, not a fixed string.
    expect(ROW).toContain("{task.isPinned ? 'Unpin' : 'Pin'}");
    expect(ROW).toContain("task.isPinned ? `Unpin ${task.title}` : `Pin ${task.title}`");
  });

  it('sets the checkbox/icon-to-title gap to the glyph-to-strip gap', () => {
    // Measured from the row's padding edge: the 4px colour strip runs 0–4px;
    // the 20px checkbox glyph is centred in the 44px target that begins flush
    // with the strip, so the glyph runs 16–36px and the strip-to-glyph gap is
    // 12px. The title used to start at 56px — 20px from the glyph — because the
    // 4px track gap plus the button's 4px left padding added to the glyph's own
    // 12px of centring. `-ml-2` cancels those 8px, bringing the title to 48px,
    // i.e. 12px from the glyph, so the two gaps match. Both row shapes carry it.
    expect(ROW).toContain('-ml-2');
    expect(EVENT_ROW).toContain('-ml-2');
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

  it('rounds only the last row, which is the row on the card\'s corner', () => {
    // The first row sits under the header, mid-card, so its strip must stay
    // square; only the last row follows the card's bottom corner. `rounded-b-lg`
    // is the theme's `--radius` (10px), which is the section card's own radius,
    // so the strip meets the card exactly.
    expect(ROW).toContain('first');
    expect(ROW).toContain('last');
    expect(ROW).toMatch(/last && 'rounded-b-lg'/);
    expect(ROW).not.toContain("first && 'rounded-t-xl'");
    expect(EVENT_ROW).toMatch(/last && 'rounded-b-lg'/);
    expect(EVENT_ROW).not.toContain("first && 'rounded-t-xl'");
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
    // The row's left inset is the layout token; its right is that token halved
    // (`pr-1.5`) so the trailing date/time sits the same 10px from the section's
    // edge as the collapse arrow does. Neither is a number.
    expect(ROW).toContain('pl-row pr-1.5');
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

describe('Pin/Unpin — the swipe action is wired to the mutation path', () => {
  it('toggles the pin through the existing patch write, not just visually', () => {
    // Both screens set `isPinned` optimistically and send the same `{ isPinned }`
    // PATCH the editor's "Pin to top" toggle uses, so the swipe cannot drift
    // away from the record. The row exposes the handler as `onPin`.
    expect(VIEW).toContain('function pinTask(task: Task)');
    expect(VIEW).toContain('actions.patch(task.id, { isPinned })');
    expect(VIEW).toContain('patchById(current, task.id, { isPinned })');
    expect(VIEW).toContain('onPin={pinTask}');
    expect(TODAY).toContain('function pinTask(task: Task)');
    expect(TODAY).toContain('actions.patch(task.id, { isPinned })');
    expect(TODAY).toContain('setAgendaPinned(agenda, task.id, isPinned)');
    expect(TODAY).toContain('onPin={pinTask}');
    expect(SECTION).toContain('onPin={onPin}');
  });
});

describe('the pin marker lives on the Pinned section header', () => {
  it('draws the glyph once, on the header, and not beside every title', () => {
    // The header states it once, to the left of the section title.
    expect(SECTION).toContain("section.id === 'pinned'");
    expect(SECTION).toContain('<DrawingPinIcon className="size-4" />');
    expect(SECTION).toContain('<span aria-hidden className="inline-flex shrink-0 text-primary">');
    // The per-row glyph is gone — the old title-side block is what disappeared,
    // not the swipe/context glyphs, which still name Pin/Unpin.
    expect(ROW).not.toContain('inline-flex shrink-0 items-center text-primary');
    expect(ROW).toContain('`Unpin ${task.title}`');
  });

  it('keeps a pinned row identifiable to a screen reader without the glyph', () => {
    // The marker that stays is text, and it sits *outside* the `Open …` button:
    // that button carries an `aria-label`, which overrides its contents in the
    // accessible-name computation, so an `sr-only` marker inside it is announced
    // to nobody. Its accessible name is therefore untouched.
    expect(ROW).toContain('{task.isPinned ? <span className="sr-only">Pinned</span> : null}');
    expect(ROW.match(/sr-only">Pinned/g)?.length).toBe(1);
    expect(ROW).toContain('aria-label={`Open ${task.title}`}');
  });

  it('keeps the header\'s own accessible name and expanded state', () => {
    // The glyph is decorative, so the name still comes from `section.title`
    // ("Pinned") via the Accordion trigger's `aria-labelledby`, and `aria-expanded`
    // is untouched. The icon is inside the header's existing `-mx-1` span, so the
    // title's left axis does not move.
    expect(SECTION).toContain('<span aria-hidden className="inline-flex shrink-0 text-primary">');
    expect(SECTION).toContain('{section.title}');
    expect(SECTION).toContain('className="-mx-1 flex min-w-0 flex-1 items-center gap-2"');
    expect(ACCORDION).toContain('aria-expanded={isOpen}');
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
      expect(view).toContain('pb-[calc(env(safe-area-inset-bottom)_+_5.375rem)] lg:pb-0');
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

  it('does animate the sheet out — the entrance argument does not apply to the exit', () => {
    /*
     * The panel used to be switched off in both directions, so Radix saw no
     * animation on close, kept it mounted for nothing and removed it a frame
     * after the tap: the bottom sheet blinked out while its scrim was still
     * fading. `slide-out-to-bottom` is the mirror of the GodUI `Drawer`'s exit
     * — 100% of the panel's own height, off the bottom edge.
     */
    expect(QUICK_ADD).toContain('data-[state=closed]:animate-out');
    expect(QUICK_ADD).toContain('data-[state=closed]:slide-out-to-bottom');
    expect(QUICK_ADD).toContain('data-[state=closed]:duration-200');
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

  it('names the time fields with an in-field label and keeps the date on the same scale', () => {
    // The start and end time inputs and the date button are all `h-9`, i.e.
    // 36.0px, and sit in one `5fr 4fr 4fr` grid, so the three read as one row
    // while the date gets a quarter more room than a time field — the times are
    // narrower, the date correspondingly wider, and a long date label is no
    // longer ellipsised. A native time input ignores `placeholder`, so the
    // field's name is an overlay label shown while it is empty, not an attribute
    // nothing renders. The date button keeps the inputs' own `text-base
    // md:text-sm` scale.
    expect(EDITOR).toContain('type="time"');
    expect(EDITOR).toContain('aria-label={`${label} time`}');
    expect(EDITOR).toContain('{label}');
    expect(EDITOR).not.toContain('placeholder="Start"');
    expect(EDITOR).not.toContain('placeholder="End"');
    expect(EDITOR).toContain('grid grid-cols-[5fr_4fr_4fr] items-center gap-1');
    expect(EDITOR).toContain('justify-start text-base md:text-sm');
  });

  it('gives every schedule field a clear control', () => {
    // The date has its own clear inside the field (plus the popover's Clear); the
    // time fields' clear is what makes an empty state reachable without fighting
    // the native picker's segments.
    expect(EDITOR).toContain('<ClearFieldButton');
    expect(EDITOR).toContain('label="Clear due date"');
    expect(EDITOR).toContain('label={`Clear ${label.toLowerCase()} time`}');
    expect(EDITOR).toContain('onClick={() => edit({ clearDue: true, dueDate: null, dueTime: null })}');
    expect(EDITOR).toContain('onClear={() => edit({ dueTime: null, clearDue: false })}');
    expect(EDITOR).toContain('onClear={() => edit({ estimateMinutes: null })}');
  });

  it('puts every field and every row on one content axis', () => {
    // Measured at 390px from the panel's 16px gutter, content-box left:
    // title/notes text 29.0px, date glyph 25.0px, date value 49.0px, start time
    // text 145.7px, and the Repeat/Reminder/Priority/List/Tags/Estimated/Link/
    // Pin rows plus the Subtasks heading 28.0px. So the rows were **not** inset:
    // they sat 1.0px *left* of the title's text (the inputs' own 1px border) and
    // 3.0px right of the date field's glyph (the date button's smaller `px-2`).
    // All three axes are now one 29.0px line: `pl-3` on the date button and the
    // time inputs, and a 1px *transparent* border beside each borderless row's
    // `px-3`, which lifts 28.0 to 29.0 exactly the way an input's visible border
    // already does.
    expect(EDITOR).not.toContain('px-row py-2');
    expect(EDITOR).not.toContain('className="px-row');
    expect(EDITOR).toContain('rounded-md px-3 py-2 text-left text-sm');
    // The transparent frame that makes a borderless button match a bordered input.
    expect(EDITOR).toContain('border border-transparent');
    // The date button carries `pl-3` and the time inputs `pl-2`, both not the
    // old `px-2`: the native time control adds 2.5px of leading of its own, so
    // `pl-2` lands the value nearer the 29.0px axis than `pl-3` did, and the
    // narrowed time column needs the 4px.
    expect(EDITOR).toContain('gap-1 pl-3 pr-6 justify-start text-base md:text-sm');
    expect(EDITOR).toContain('border-0 bg-transparent pl-2 pr-6 text-base outline-none md:text-sm');
    expect(EDITOR).not.toContain('items-center gap-2 px-2 justify-start');
    expect(EDITOR).not.toContain('bg-transparent px-2 text-base outline-none');
    // The overlay label of the empty time fields sits on the same axis.
    expect(EDITOR).toContain('absolute inset-y-0 left-3 flex items-center');
    expect(EDITOR).toContain('<h3 className="px-3 text-sm font-medium border border-transparent">Subtasks</h3>');
    const subtasks = source('SubTaskList.tsx');
    expect(subtasks).toContain('pr-1 pl-3');
    expect(subtasks).toContain('gap-2 px-3');
    expect(subtasks).toContain('rounded-lg px-3 text-primary');
    expect(subtasks).toContain('border border-transparent');
  });

  it('reserves the clear control\'s 20px so a long value cannot run under the cross', () => {
    // Measured at 390px with "Tue Sep 30" in the date field: the value's box
    // ended at 123.7px against a clear button starting at 111.7px — 12.0px of
    // overlap, and `scrollWidth` 86 against a 75px box, so the ellipsis itself
    // was painted under the glyph. The control is 16px at `right-1`, i.e. the
    // last 20px of the field; the date button and both time inputs now reserve
    // `pr-6` (24px = the 20px control + a 4px gap), putting the value's box 4.0px
    // clear of it. Padding, not a moved button or a reserved flex column: a time
    // field is 107.7px wide at 390px and a column would spend the same 20px out
    // of the value anyway.
    expect(EDITOR).toMatch(/pl-3 pr-6/);
    expect(EDITOR).toContain(
      "'absolute right-1 top-1/2 inline-flex size-4 -translate-y-1/2 items-center justify-center rounded-full'",
    );
    // Both field shapes carry it — the date button with its own `pl-3`, the two
    // time inputs through the shared `TimeField` — so neither can reach its cross.
    expect(EDITOR.match(/pl-3 pr-6/g)?.length).toBe(1);
    expect(EDITOR.match(/pl-2 pr-6/g)?.length).toBe(1);
  });

  it('moves Delete to the bottom of the form and puts Cancel in the footer', () => {
    // The footer is Cancel (left, outlined) + Save (right, filled, `flex-1`), so
    // Save stays the dominant action by colour *and* by area. Delete is the last
    // row of the scrollable content, below the subtasks, and keeps the same
    // confirmation dialog.
    expect(EDITOR).toContain(
      '<Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>',
    );
    expect(EDITOR).toContain('min-h-12 w-full justify-start gap-3 rounded-md px-3 text-destructive');
    expect(EDITOR).toContain('<HoldConfirmButton');
    // Cancel comes before Save in the footer, and Save keeps `flex-1`.
    expect(EDITOR.indexOf('>\n                Cancel')).toBeLessThan(EDITOR.indexOf("'Save'"));
    expect(EDITOR).toContain('className="flex-1"');
    // The destructive trigger is inside the scroller, before the footer's border.
    expect(EDITOR.indexOf('Delete task')).toBeLessThan(
      EDITOR.indexOf('border-t px-gutter pt-stack'),
    );
    // The footer's own action row holds the two buttons and nothing destructive.
    const footer = EDITOR.slice(
      EDITOR.indexOf('border-t px-gutter pt-stack'),
      EDITOR.indexOf('</DialogContent>'),
    );
    expect(footer).toContain('Cancel');
    expect(footer).toContain("'Save'");
    expect(footer).not.toContain('Delete task');
    expect(footer).not.toContain('<HoldConfirmButton');
  });

  it('builds the schedule row from a date, a start and an end, deriving the duration', () => {
    // Duration is no longer a preset list: the end time is the control, the same
    // native time field the start uses, and the span is written to
    // `estimateMinutes` — the field the record already has and the stepper below
    // already edits. The record has no end-time column, so the end is derived
    // from `dueTime + estimateMinutes` (`addMinutesToTime`) and never stored.
    expect(EDITOR).toContain('label="Start"');
    expect(EDITOR).toContain('label="End"');
    expect(EDITOR).toContain('minutesBetweenTimes');
    expect(EDITOR).toContain('addMinutesToTime');
    expect(EDITOR).toContain('edit({ estimateMinutes: diff > 0 ? diff : null })');
    expect(EDITOR).not.toContain('DURATION_PRESETS');
    expect(EDITOR).not.toContain('SegmentedControl');
    // The stepper still writes the same field, so the two controls agree.
    expect(EDITOR).toContain('edit({ estimateMinutes: Math.min(1440, estimateMinutes + 5) })');
  });

  it('opens the list manager from the list picker', () => {
    // Lists are managed where they are already visible: the picker inside the
    // editor, plus the sidebar's `?new=list` route handled by `TasksView`.
    expect(EDITOR).toContain('<ListManagerDialog');
    expect(EDITOR).toContain('onManage={() => setManageLists(true)}');
    const picker = source('ListPicker.tsx');
    expect(picker).toContain('onManage');
    expect(picker).toContain('Manage lists');
  });

  it('puts Today, Tomorrow and Next week above the calendar', () => {
    // The request read "add today and tomorrow sections"; inside the editor's
    // date popover these are the quick picks that set the day directly. The task
    // list already groups by urgency and Today already has its own sections, so
    // new *list* sections would have duplicated both.
    expect(EDITOR).toContain("{ label: 'Today', day: today }");
    expect(EDITOR).toContain("{ label: 'Tomorrow', day: addDaysToDateOnly(today, 1, zone) }");
    expect(EDITOR).toContain("{ label: 'Next week', day: addDaysToDateOnly(today, 7, zone) }");
    // The anchor day is one memoized Luxon call keyed on the zone, not six calls
    // on every render of the screen that owns this sheet — the sheet's element
    // tree, closed dialog children included, is built on each of them.
    expect(EDITOR).toContain('const today = useMemo(() => todayIn(zone), [zone]);');
    expect(EDITOR).toContain('const quickPicks = useMemo(');
    expect(EDITOR).toContain('{quickPicks.map((pick) => (');
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

  it('draws no border on a section card at all', () => {
    // The user asked for the section border gone. `border-0` overrides the
    // vendored glass card's `border`, so only the tinted surface and its shadow
    // separate a section from the page.
    expect(SECTION).toContain('className="border-0 shadow-sm"');
    expect(SECTION).not.toContain('className="border-border shadow-sm"');
  });

  it('manages task lists through the API the server already exposes', () => {
    // The server has had POST/PATCH/DELETE `/api/lists` all along; the manager
    // paints them and refreshes the bootstrap resource so the new list appears
    // without a reload. `?new=list` — the sidebar's "New list" route — opens it
    // in create mode and is stripped from the URL.
    const manager = source('ListManagerDialog.tsx');
    expect(manager).toContain('actions.createList(trimmed, color)');
    expect(manager).toContain('actions.updateList(formList.id, { name: trimmed, color })');
    expect(manager).toContain('actions.removeList(formList.id)');
    expect(manager).toContain('void bootstrap.refresh()');
    expect(manager).toContain('id="task-list-name"');
    expect(manager).toContain('AccentSwatches');
    expect(VIEW).toContain("searchParams.get('new') !== 'list'");
    expect(VIEW).toContain('startInForm={listManager.creating}');
  });

  it('removes the hairlines between rows and under the section header', () => {
    // The user asked for both lines gone; separation is spacing now (the header's
    // own `py-2.5` and the rows' 44px boxes). There is deliberately no `gap-1`
    // between rows: that gap is exactly where the per-row colour strips broke, so
    // removing it makes the strip continuous down the section.
    expect(SECTION).not.toContain('divide-y');
    expect(SECTION).not.toContain('border-t border-border/70');
    expect(SECTION).toContain('flex flex-col text-base text-foreground');
    expect(SECTION).not.toContain('flex flex-col gap-1');
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

describe('the search field draws no focus ring', () => {
  it('scopes the override to this one Input and leaves the primitive alone', () => {
    // Scoped through `className` on this single `Input`, which `cn()` merges over
    // the primitive's own `focus-visible:ring-[3px]` — same tailwind-merge group,
    // so it wins here and nowhere else. No global `focus-visible` rule is touched.
    expect(VIEW).toContain('className="pr-10 pl-9 focus-visible:ring-0"');
    const input = read('components/ui/input.tsx');
    expect(input).toContain('focus-visible:ring-[3px]');
  });

  it('keeps the field visibly focused and named', () => {
    // The primitive's own `focus-visible:border-ring` is left in place, so focus
    // still repaints the border (plus the caret) — only the ring is suppressed,
    // never the border. The accessible name is intact.
    expect(VIEW).toContain('aria-label="Search tasks"');
    expect(VIEW).not.toContain('focus-visible:border-0');
    expect(VIEW).not.toContain('outline-transparent');
  });
});

describe('section-aware trailing label', () => {
  const META = source('TaskMeta.tsx');

  it('is told its section by the only component that knows it', () => {
    // The rows are presentational; TaskListSection is what holds the section id,
    // so it derives the flag once and passes it down rather than each screen
    // remembering which labels need a date.
    expect(SECTION).toContain("const showDate = section.id !== 'today';");
    expect(SECTION).toContain('showDate={showDate}');
  });

  it('renders the absolute date outside Today for both row shapes', () => {
    // A task goes through DueDateLabel -> dueLabel(..., showDate); an event
    // formats its own trailing label with the same helper.
    expect(ROW).toContain('showDate={showDate}');
    expect(META).toContain('dueLabel(task, zone, timeFormat, showDate)');
    expect(EVENT_ROW).toContain('absoluteDayLabel(toDateOnly(event.startMs, zone), zone)');
    expect(EVENT_ROW).toContain('showDate');
  });

  it('keeps Today as the one section that keeps a clock time', () => {
    // The rule keys off the section id, not a per-screen flag, so adding a new
    // non-Today section changes nothing here.
    expect(SECTION).toContain("section.id !== 'today'");
  });
});

/**
 * The swipe's closing half, and the tap that used to be mistaken for it.
 *
 * What a real touch sequence measured on the old build (Chromium 153, 390×844,
 * `hasTouch`, CDP touch events), tapping the way a thumb does rather than
 * calling `click()` from the console:
 *
 * | gesture | measured before |
 * |---|---|
 * | open a row, then drag it right by 170px | the row jumped `-228px → 0px` in one frame at the first touch, and the 9 `pointermove`s that followed moved it nowhere — the close was not a drag |
 * | open a row, then tap the revealed **Complete** | row closed, task *not* completed (the touch's click was delivered to the row behind the button) |
 * | open a row, then tap the row's own content | row closed — and the sheet opened in one probe and not in another, because the click's target is whatever happens to be under it after the row has slid away |
 * | open a row, then tap where the revealed buttons are | row closed, **and the task's detail sheet opened** |
 * | swipe 14px (one move past the slop), release | row snapped back, **and the sheet opened** |
 *
 * The old probe missed all of it because it drove the rows' own `click()` from
 * `page.evaluate`, which never runs the `pointerdown` listener the real gesture
 * goes through. These pins are on the source because the behaviour they stand
 * for needs a browser; the axis arithmetic next to the swipe is pinned by
 * resolved value in `tasks-swipe-axis.test.ts`.
 */
describe('TaskRow — closing a revealed row is the swipe in reverse', () => {
  /** The body of one handler, so a pin cannot match the same text elsewhere. */
  function handler(name: string, nextAnchor: string): string {
    const start = ROW.indexOf(`function ${name}(`);
    const end = ROW.indexOf(nextAnchor);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return ROW.slice(start, end);
  }

  it('arms the gesture from the revealed position instead of closing on press', () => {
    // Pressing an open row used to close it before the gesture was armed, so the
    // row snapped shut on the first touch and could not be swiped back at all.
    const down = handler('onPointerDown', 'function onPointerMove(');
    expect(down).toContain('state.fromRevealed = revealed;');
    expect(down).not.toContain('closeReveal');
  });

  it('still closes it on a tap, on release, with the click that follows swallowed', () => {
    const up = handler('onPointerUp', 'function onPointerCancel(');
    expect(up).toContain('} else if (state.fromRevealed) {');
    expect(up).toContain('closeReveal();');
    expect(up).toContain('if (state.axis !== null) gestureEndedAt.current = performance.now();');
    // The content button is what would otherwise open the sheet on that click.
    expect(ROW).toContain('if (clickFollowsDrag()) return;');
    expect(ROW).toContain('CLICK_AFTER_GESTURE_MS');
    expect(ROW).toContain('gestureEndedAt');
  });

  it('dismisses the reveal only for a press outside the row', () => {
    // The capture-phase `pointerdown` listener fired for presses *inside* the
    // row too, which slid the revealed buttons out from under the finger before
    // the click landed: tapping Complete closed the row instead of completing.
    expect(ROW).toContain('const row = contentRef.current?.parentElement;');
    expect(ROW).toContain('if (row && event.target instanceof Node && row.contains(event.target)) return;');
  });

  it('settles a release from the pointer, not from state that may not have rendered', () => {
    // `pointermove` is a continuous event, so its state update is not guaranteed
    // to have been committed when the lift arrives; reading `offsetX` there can
    // latch a fast drag the wrong way.
    const up = handler('onPointerUp', 'function onPointerCancel(');
    expect(up).toContain('clamp(base + (event.clientX - state.x), -SWIPE_ACTION_WIDTH, 0)');
    expect(up).not.toMatch(/const open = offsetX/);
  });

  it('gives a cancelled pointer its own settle, never the cancel event\'s 0,0', () => {
    // `pointercancel` carries `clientX`/`clientY` of zero, so running it through
    // the release maths would read as a huge leftward drag and latch the row open.
    expect(ROW).toContain('onPointerCancel={onPointerCancel}');
    const cancel = handler('onPointerCancel', 'const lifted = Boolean(');
    expect(cancel).not.toContain('clientX');
    expect(cancel).toContain('if (state.fromRevealed) closeReveal();');
    expect(ROW).not.toContain('onPointerCancel={onPointerUp}');
  });

  it('leaves the axis rule to one function, so the constants cannot drift back inline', () => {
    expect(ROW).toContain("from './swipe-axis'");
    expect(ROW).toContain('resolveSwipeAxis({ dx, dy, axis: state.axis, locked: state.locked })');
    expect(ROW).not.toMatch(/state\.axis = Math\.abs\(dx\)/);
  });
});
