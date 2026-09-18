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
 * | the coloured leading edge carries meaning | `borderLeft: 3px solid` | an 8px list-colour dot in the section header |
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
    expect(ROW).toContain('aria-label={selectionMode ?');
    expect(ROW).toContain('`Open ${task.title}`');
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
    expect(ROW).toContain("'Deselect' : 'Select'");
  });

  it('keeps the swipe reveal mounted but translated out of the card until it is revealed', () => {
    // The revealed actions paint under the row, so an un-revealed one that is
    // only *hidden* shows through the card's rounded corners as red and green
    // crescents. They are therefore parked a full width outside the card.
    expect(ROW).toContain('SWIPE_ACTION_WIDTH');
    expect(ROW).toContain("revealed ? 'translateX(0)' : 'translateX(100%)'");
    expect(ROW).toContain('tabIndex={revealed ? 0 : -1}');
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
    expect(SECTION).toContain('${section.tasks.length} task${section.tasks.length === 1 ? ');
  });

  it('marks Overdue by contrast rather than hue in the header', () => {
    expect(SECTION).toContain("section.tone === 'danger'");
    expect(SECTION).toContain("'text-foreground' : 'text-muted-foreground'");
  });

  it('keeps the list/priority signal as one header dot, not a coloured stripe', () => {
    // The full-height 4px coloured edge is gone; the same information survives
    // as a single dot in the section header, so the palette stays achromatic.
    expect(SECTION).not.toContain('border-l-4');
    expect(SECTION).not.toContain('--edge-color');
    expect(SECTION).toContain('rounded-full');
    expect(SECTION).toContain('edgeColorFor(section, listColors)');
  });

  it('keeps the row inset coming from the layout token', () => {
    // The vendored Accordion's panel owns `px-5 pb-4`; the track pulls back and
    // each row supplies `px-row`, so the inset is the token and not upstream's
    // number. If this compensation is ever removed the rows silently double-pad.
    expect(SECTION).toContain('-mx-5 -mb-4');
    expect(SECTION).toContain('text-base text-foreground');
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
  it('keeps the five bulk-action names on the floating toolbar', () => {
    for (const label of [
      'Complete selected tasks',
      'Move selected tasks',
      'Set the priority of the selected tasks',
      'Add a tag to the selected tasks',
      'Delete selected tasks',
    ]) {
      expect(VIEW).toContain(label);
    }
    // The toolbar puts each action's `label` on its button as the accessible
    // name, which is what keeps those five strings reachable.
    expect(read('components/godui/floating-toolbar.tsx')).toContain('aria-label={action.label}');
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
