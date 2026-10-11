'use client';

/**
 * Natural-language quick add.
 *
 * One presentation: a bottom sheet opened from the shell's action button, on
 * every screen alike, holding two things — the sentence, and the toolbar of
 * things a sentence cannot say. It parses on every keystroke (`parseQuickAdd`)
 * and shows exactly what was understood in place: the recognised fragments are
 * tinted behind the real input, so the confirmation is the user's own words
 * rather than a row of chips repeating them. The caret lands in the field the
 * moment the dialog opens, and a successful submit closes it — one task is one
 * gesture. A submit that *fails* leaves the dialog open with the sentence still
 * in the field, so nothing typed is lost to an error.
 *
 * ## The sentence is the state
 *
 * Every toolbar control — the calendar, the priority flag, a tag, a repeat —
 * edits the *sentence*, appending the token the parser already understands, and
 * never a field of its own. `parseQuickAdd` is therefore still the only thing
 * that decides what the task gets: there is no second source of truth that the
 * next keystroke would overwrite, and what the toolbar shows is what the tinted
 * layer shows, because both are read from the same parse. The calendar is the
 * one exception, and only because the grammar has no token for it.
 *
 * ## The highlight is the parser's own ranges, not a second regex
 *
 * The tinted layer is driven by `QuickAddResult.matches` — the character ranges
 * `@/lib/nlp` actually consumed — through `quickAddHighlights` /
 * `highlightSegments` in `./quick-add`. There is no parallel pattern in the view
 * to drift out of step with the parser: a word is tinted exactly when the parse
 * understood it. See `QuickAddField` for the mirror layer itself.
 *
 * ## Focus timing (do not "simplify" this)
 *
 * iOS raises the keyboard only when `focus()` runs in the task that handled the
 * tap. Two things keep that guarantee now that the sheet is a shadcn `Dialog`
 * (Radix) rather than a MUI one:
 *
 *   - the panel does **not** animate *in* (`data-[state=open]:duration-0` and the
 *     `animate-in` class is switched off, while the exit keeps its own 200ms
 *     slide-down). Radix mounts the panel through a portal, so the panel's
 *     presence in the DOM is what has to be immediate, and a 200ms entrance
 *     animation is exactly the delay that was fixed; the exit is unaffected by
 *     that argument and animating it is what makes the sheet leave the screen
 *     instead of vanishing. The two states are therefore written separately
 *     rather than as one undifferentiated `duration-0`; and
 *   - the focus runs in a *layout* effect, not a passive one, so it belongs to the
 *     same commit that `open` arrived in. `TasksView.openQuickAdd` flushes that
 *     commit synchronously inside the tap (see `usePrimaryAction`), and Radix's
 *     `Presence` renders its children in that same commit, so the input node
 *     exists by the time the layout effect runs.
 *
 * `autoFocus` is left on the field as a second, React-native path (ReactDOM
 * focuses an `autoFocus` node during the commit phase), and `onOpenAutoFocus`
 * cancels Radix's own deferred autofocus so nothing re-focuses a frame later. The
 * raw probe result for this is in the migration report.
 *
 * ## The `@` shortcut
 *
 * Typing `@` opens the list menu: the lists matching what has been typed into the
 * token, best match first, with the arrow keys and Enter to pick one. Choosing
 * splices the canonical token over what was typed (`listToken`) — quoted when the
 * name has a space in it, which is how `@"Reading list"` names a list the bare
 * grammar cannot. The menu is driven by the caret's own token (`listTokenAt`), so
 * it opens only while the caret is inside one and closes the moment the name is
 * complete: a shortcut, not a panel to dismiss. Escape closes the menu alone —
 * the dialog's own Escape would take the typed sentence with it.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { ArrowUpIcon } from '@svg-animated-icons/react/arrow-up';
import { CalendarIcon } from '@svg-animated-icons/react/calendar';
import { CheckIcon } from '@svg-animated-icons/react/check';
import { DotsHorizontalIcon } from '@svg-animated-icons/react/dots-horizontal';
import { LoopIcon } from '@svg-animated-icons/react/loop';
import { Flag, Tag as TagIcon } from 'lucide-react';
import { listToken, parseQuickAdd, type QuickAddResult } from '@/lib/nlp';
import { useResource } from '@/lib/store';
import type { Calendar as CalendarRecord, Task } from '@/lib/types';
import type { BootstrapPayload } from '@/lib/view-types';
import { useToast } from '@/components/app/Toast';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { calendarColorHex } from '@/components/calendar/colors';
import { dueLabel } from './TaskMeta';
import { priorityColor, priorityLabel } from './priority';
import {
  listTokenAt,
  planQuickAdd,
  quickAddChips,
  highlightSegments,
  quickAddHighlights,
  suggestLists,
  type ListLike,
  type QuickAddChip,
  type QuickAddChipKind,
  type QuickAddContext,
  type QuickAddSegment,
} from './quick-add';
import { useTaskActions } from './useTaskActions';

export interface QuickAddBarProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Dismissal (backdrop tap, Escape). */
  onOpenChange: (open: boolean) => void;
  /** The list the task lands in — the list being viewed, or the list's own row. */
  listId?: string | null;
  onCreated?: (task: Task) => void;
}

/**
 * The tint per recognised kind — two treatments, deliberately not a rainbow.
 *
 *   - the temporal kinds (date, time, repeat, estimate) take the app's primary
 *     tint, because they are the words that move the task in time and the
 *     confirmation the user is actually looking for;
 *   - the meta kinds (tag, list, priority) take an outlined primary edge instead
 *     of a fill, because they classify the task rather than schedule it.
 *
 * Both use the one accent hue — a fill and an outline, not two colours — so the
 * sentence stays legible and the resolved chips below remain the place colour is
 * allowed to do more work. A second hue here would be a rainbow the app's
 * Celestial Sapphire palette has nothing to say with.
 *
 * The alphas are set for **contrast against the field**, not for subtlety. At
 * `/15` the fill was faint enough to read as a rendering artefact rather than as
 * "this word was understood", which is the whole job of the layer; `/30` and
 * `/55` keep the tint clearly visible in both themes while leaving the input's
 * own foreground text at full strength on top of it.
 */
const HIGHLIGHT_CLASS: Record<QuickAddChipKind, string> = {
  date: 'bg-primary/30',
  time: 'bg-primary/30',
  repeat: 'bg-primary/30',
  estimate: 'bg-primary/30',
  tag: 'ring-1 ring-primary/55 ring-inset',
  list: 'ring-1 ring-primary/55 ring-inset',
  priority: 'ring-1 ring-primary/55 ring-inset',
};

/**
 * The breathing room inside a tint, per side.
 *
 * The horizontal padding is cancelled by a matching negative margin, so the tint
 * reaches past its word without moving the word — or anything after it. This
 * layer has to stay character-aligned with the input it sits behind, and padding
 * on an inline span otherwise pushes every following glyph right, which is
 * exactly the drift the mirror cannot afford. The pair is load-bearing: `px`
 * without `-mx` slides the sentence out of step with the caret.
 *
 * That cancellation is also the ceiling. A tint can only ever be as wide as the
 * gap around its word, because the gap is the whole budget — 4.80px at the
 * field's 16px size, 4.20px at `md:text-sm` (14px). Measured against the
 * neighbouring glyph's *ink* rather than its advance box (the side bearing is
 * precisely the room being spent), a word-facing side resolves to:
 *
 *   pad    16px     14px
 *   4px   +0.91    -0.32
 *   5px   -0.09    -1.32
 *   6px   -1.09    -2.32
 *
 * The values below take 6px / 4px — the roomiest a pill gets without widening
 * the gaps, at the cost of its edge landing within ~1px of the letter beside it.
 * The honest alternative is `word-spacing`, which v0.40.7 shipped at 0.165em: it
 * buys the same padding but spaces out every plain word with it, and the user
 * rejected that outright. So the edge is spent instead. There is no third lever —
 * in a mirror-behind-input field the padding has to come out of the gap.
 *
 * How much of the gap a side takes depends on what is across it:
 *
 *   - a plain word, or the edge of the field: `outer` — 3px, the same at both
 *     font sizes. It was 6px at 16px and 4px at 14px, which spent more of the
 *     gap than there is: against a 4.80px word space 6px covers the space
 *     outright and runs ~1.2px into the next word, so the tint reads as having
 *     no space after it. 3px leaves 1.8px of the 4.80px space at 16px and 1.2px
 *     of the 4.20px space at 14px, so the gap survives at both sizes and this
 *     side no longer needs a `md:` variant.
 *   - another tint: both tints reach into the same gap, so their two overhangs
 *     have to fit inside it together — `inner`, 2px at 16px and 1px at 14px,
 *     which leaves 0.8px and 2.2px of white between the pills. This one does
 *     halve at `md:`, unlike `outer`: two pills in one 4.20px gap is a tighter
 *     budget than one pill beside a word, and at 2px each the gap collapsed to
 *     0.20px — caught by scripts/smoke/highlights.mjs, not by eye.
 *
 * Sizing every side to `inner` (v0.40.3) was safe but spent half the room that
 * was there in the common case, a tint beside a plain word. Sizing every side to
 * `outer` merges two adjacent tints into one band, which is what v0.40.2
 * shipped. So the side decides.
 *
 * Vertical padding is a separate story with no such ceiling — the tint is a flex
 * item centred in the mirror, so growing it costs the line box nothing. It is
 * kept small on purpose: the tint should read as a highlight around the word,
 * not as a box filling the field.
 */
const TINT_PAD_VERTICAL = 'py-0.5';
const TINT_PAD_OUTER_LEFT = 'pl-tint -ml-tint';
const TINT_PAD_OUTER_RIGHT = 'pr-tint -mr-tint';
const TINT_PAD_INNER_LEFT = 'pl-0.5 -ml-0.5 md:pl-px md:-ml-px';
const TINT_PAD_INNER_RIGHT = 'pr-0.5 -mr-0.5 md:pr-px md:-mr-px';

/**
 * Whether the nearest glyph-bearing neighbour in `direction` is another tint.
 *
 * Two tints are usually separated by a text segment that is nothing but the
 * space between them — `!high #home` tokenises as tint, " ", tint — so a tint's
 * immediate neighbour is rarely the thing that decides its padding. A neighbour
 * only counts as a word if it has a character that is not whitespace.
 */
function facesTint(segments: readonly QuickAddSegment[], index: number, direction: -1 | 1): boolean {
  for (let i = index + direction; i >= 0 && i < segments.length; i += direction) {
    if (segments[i].kind) return true;
    if (segments[i].text.trim() !== '') return false;
  }
  return false;
}

/**
 * The toolbar's repeat choices. The tokens are the ones `@/lib/nlp` already
 * understands (`every day`, `every weekday`, …), so picking one is the same as
 * typing it — no second vocabulary for the same idea.
 */
const REPEAT_OPTIONS = [
  { label: 'Every day', token: 'every day' },
  { label: 'Every weekday', token: 'every weekday' },
  { label: 'Every week', token: 'every week' },
  { label: 'Every month', token: 'every month' },
  { label: 'Every year', token: 'every year' },
] as const;

/**
 * One row in a toolbar menu: an optional leading glyph, a label, and a tick when
 * it is the chosen one. `menuitemradio` rather than `menuitem`, because every
 * one of these menus sets a single value.
 */
function MenuRow({
  selected = false,
  glyph,
  onSelect,
  children,
}: {
  selected?: boolean;
  glyph?: ReactNode;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm',
        selected ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent/50',
      )}
    >
      {glyph}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {selected ? <CheckIcon className="size-4 shrink-0" aria-hidden /> : null}
    </button>
  );
}

interface QuickAddState {
  value: string;
  setValue: (value: string) => void;
  result: QuickAddResult;
  chips: QuickAddChip[];
  /** Resolves `true` once the task exists, `false` when the submit did not go through. */
  submit: () => Promise<boolean>;
  online: boolean;
  offlineNotice: string;
  busy: boolean;
  /**
   * The calendars a task may be filed into — writable ones only, because a
   * read-only collection accepts a local row and never writes it back. Empty
   * when there are none, which hides the picker entirely.
   */
  calendars: CalendarRecord[];
  /** The chosen calendar id, or `''` for no calendar. */
  calendarId: string;
  setCalendarId: (calendarId: string) => void;
  /**
   * The lists `@` can resolve to — the account's own, in the order the server
   * sorts them, which is what the shortcut menu offers.
   */
  lists: readonly ListLike[];
  /** The account's tags, for the toolbar's tag menu. */
  tags: readonly ListLike[];
}

function useQuickAdd(listId: string | null, onCreated?: (task: Task) => void): QuickAddState {
  const { data: bootstrap } = useResource<BootstrapPayload>('/api/bootstrap', undefined, { staleAfterMs: 60_000 });
  const zone = bootstrap?.settings.timezone ?? bootstrap?.user.timezone ?? 'utc';
  const weekStartsOn = bootstrap?.settings.weekStartsOn ?? 1;
  const timeFormat = bootstrap?.settings.timeFormat ?? '24h';

  const actions = useTaskActions(zone);
  const { toast } = useToast();
  const [value, setValue] = useState('');
  /*
   * Which calendar the task is filed into; `''` is "no calendar", which is where
   * a task starts. Deliberately *not* reset after each add, for the same reason
   * the list is not: someone filing three tasks into one calendar should not have
   * to name it three times.
   */
  const [calendarId, setCalendarId] = useState('');

  const writableCalendars = useMemo(
    () => (bootstrap?.calendars ?? []).filter((calendar) => !calendar.readOnly),
    [bootstrap],
  );

  const result = useMemo(() => parseQuickAdd(value, { zone, weekStartsOn }), [value, zone, weekStartsOn]);

  const context = useMemo<QuickAddContext>(
    () => ({
      zone,
      timeFormat,
      lists: bootstrap?.lists ?? [],
      listId,
      inboxListId: bootstrap?.inboxListId ?? null,
      defaultListId: bootstrap?.settings.defaultListId ?? null,
      nowMs: Date.now(),
    }),
    [bootstrap, listId, timeFormat, zone],
  );

  const chips = useMemo(
    () => quickAddChips(result, context),
    // `result` changes on every keystroke, which is exactly when the chips must.
    [result, context],
  );

  const submit = useCallback(async () => {
    const raw = value.trim();
    if (!raw) return false;

    const plan = planQuickAdd(result, context);
    if (!plan) {
      toast({ title: 'Give the task a name', description: 'Type a title before adding it.', variant: 'error' });
      return false;
    }

    /*
     * The sentence can name a list (`@Groceries`) but not a calendar — there is
     * no syntax for one — so the calendar is the single field merged in from the
     * picker. `null` rather than `''`: absence is `null` on the wire, and the
     * create schema accepts it.
     */
    let payload = { ...plan.payload, calendarId: calendarId || null };
    if (plan.createListName) {
      // The list does not exist yet; create it so `@Groceries` really files there.
      const created = await actions.createList(plan.createListName);
      if (!created) return false;
      payload = { ...payload, listId: created.id };
    }

    const task = await actions.create(payload);
    if (!task) return false;

    setValue('');
    toast({
      title: 'Task added',
      description: `${task.title} · ${dueLabel(task, zone, timeFormat)?.label ?? 'No date'}`,
      variant: 'success',
    });
    onCreated?.(task);
    return true;
  }, [actions, calendarId, context, onCreated, result, timeFormat, toast, value, zone]);

  return {
    value,
    setValue,
    result,
    chips,
    submit,
    online: actions.online,
    offlineNotice: actions.offlineNotice,
    busy: actions.isSaving,
    calendars: writableCalendars,
    calendarId,
    setCalendarId,
    lists: context.lists,
    tags: bootstrap?.tags ?? [],
  };
}

function QuickAddInput({
  state,
  open,
  onClose,
  inputRef,
}: {
  state: QuickAddState;
  open: boolean;
  onClose: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  /*
   * The caret goes into the field when the dialog is deliberately opened — and
   * at no other time. `open` is the only trigger: focusing unconditionally would
   * grab the page's focus on load.
   *
   * A *layout* effect, not a passive one, and that distinction is the whole
   * point: iOS raises the keyboard only when `focus()` runs in the task that
   * handled the tap, and a passive effect is flushed after the browser has had
   * its chance to paint — a frame later, in another task, where the gesture is
   * spent and the keyboard never appears. A layout effect runs in the same commit
   * that `open` arrived in, which the caller flushes synchronously with the tap
   * (see `TasksView.openQuickAdd`), so the focus still belongs to the gesture.
   */
  useLayoutEffect(() => {
    if (!open) return;
    inputRef.current?.focus({ preventScroll: true });
  }, [open]);

  /*
   * A created task closes the dialog: the row is in the list behind it and the
   * user asked for the popup to go away, so making them dismiss it too would be
   * a second gesture for one action. A failed submit keeps it open and puts the
   * caret back where the typing was, so the sentence is not lost.
   */
  async function submit() {
    const created = await state.submit();
    if (created) onClose();
    else inputRef.current?.focus();
  }

  /*
   * The `@` list shortcut.
   *
   * Everything is derived from the value and the caret: the token under the caret
   * (`listTokenAt`), the lists matching what has been typed into it, and whether
   * that query is already a complete name — a complete token needs no menu, which
   * is also what stops the menu reappearing over the name that was just chosen.
   */
  const listboxId = useId();
  const [caret, setCaret] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const token = useMemo(() => listTokenAt(state.value, caret), [state.value, caret]);
  const typed = token?.query ?? '';
  const complete =
    typed !== '' && state.lists.some((list) => list.name.trim().toLowerCase() === typed.toLowerCase());
  const suggestions = useMemo(() => (token ? suggestLists(state.lists, typed) : []), [state.lists, token, typed]);
  const menuOpen = token !== null && !complete && !dismissed;
  /** The row the keyboard is on, clamped: a shorter list must never leave the highlight past its end. */
  const highlighted = suggestions.length ? Math.min(activeIndex, suggestions.length - 1) : -1;

  // Typing on re-opens what Escape closed: the dismissal belongs to the query it
  // was pressed on, not to the field.
  useEffect(() => setDismissed(false), [typed]);
  // The highlighted row follows the query, so a shorter list never leaves the
  // highlight past its end.
  useEffect(() => setActiveIndex(0), [typed]);

  const accept = useCallback(
    (list: ListLike) => {
      const current = listTokenAt(state.value, caret);
      if (!current) return;

      const inserted = listToken(list.name);
      const head = state.value.slice(0, current.start);
      const tail = state.value.slice(current.end).replace(/^\s+/, '');
      const next = `${head}${inserted} ${tail}`;
      const position = head.length + inserted.length + 1;

      state.setValue(next);
      setCaret(position);
      setDismissed(true);
      // The caret lands after the inserted token so the title keeps being typed
      // where it left off — and only once React has committed the new value.
      requestAnimationFrame(() => inputRef.current?.setSelectionRange(position, position));
    },
    [caret, inputRef, state.setValue, state.value],
  );

  /*
   * The toolbar's actions all edit the sentence, because the sentence is the
   * state: `parseQuickAdd` is the only thing that decides what the task gets, so
   * a button that wrote a field directly would be a second source of truth that
   * the next keystroke overwrote.
   */
  const writeSentence = useCallback(
    (text: string) => {
      state.setValue(text);
      setCaret(text.length);
      /*
       * Focus and caret go back to the end of what was written, in a rAF: React
       * has to commit the new value first, and iOS only keeps the keyboard up
       * while the focus still belongs to the gesture that raised it.
       */
      requestAnimationFrame(() => {
        inputRef.current?.focus({ preventScroll: true });
        inputRef.current?.setSelectionRange(text.length, text.length);
      });
    },
    [inputRef, state],
  );

  /** Append a token — and the space after it, so the title keeps being typed. */
  const appendToken = useCallback(
    (token: string) => {
      const base = state.value.replace(/\s+$/, '');
      writeSentence(base ? `${base} ${token} ` : `${token} `);
    },
    [state.value, writeSentence],
  );

  /**
   * Set the priority by rewriting the sentence's own `!priority` token: the old
   * one is removed and the new one appended, so what the menu shows and what the
   * parser reads can never disagree. `null` clears it.
   */
  const setPriority = useCallback(
    (next: 'high' | 'medium' | 'low' | null) => {
      const match = state.result.matches.find((candidate) => candidate.kind === 'priority');
      const without = match
        ? `${state.value.slice(0, match.index)}${state.value.slice(match.index + match.text.length)}`
        : state.value;
      const base = without.replace(/\s+/g, ' ').trim();
      const token = next ? `!${next}` : '';
      const text = [base, token].filter(Boolean).join(' ');
      writeSentence(text ? `${text} ` : '');
    },
    [state.result.matches, state.value, writeSentence],
  );

  /*
   * The calendar chip's label, in the order the reader cares: the calendar the
   * task will actually be filed into, then the date the sentence named (which is
   * what the sheet is confirming), then the field's own name.
   */
  const dateChip = state.chips.find((chip) => chip.kind === 'date' || chip.kind === 'time') ?? null;
  const selectedCalendar =
    state.calendars.find((calendar) => calendar.id === state.calendarId) ?? null;
  const calendarLabel = selectedCalendar?.name ?? dateChip?.label ?? 'Calendar';
  const currentPriority = state.result.priority;

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (menuOpen) {
      const count = suggestions.length;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActiveIndex((index) => (count ? (index + step + count) % count : 0));
        return;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && count) {
        event.preventDefault();
        accept(suggestions[highlighted >= 0 ? highlighted : 0]);
        return;
      }
      if (event.key === 'Escape') {
        /*
         * Escape closes the menu and nothing else. `stopPropagation` on the
         * native event is what keeps Radix's document-level dismisser from
         * seeing the key at all, so the typed sentence survives — pressing it
         * again, with the menu already closed, still closes the dialog.
         */
        event.preventDefault();
        event.stopPropagation();
        setDismissed(true);
        return;
      }
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      void submit();
    }
  }

  /*
   * The highlight mirror.
   *
   * A transparent `<input>` cannot paint a tint behind just part of its value,
   * so an absolutely positioned, `aria-hidden` mirror sits behind it: the same
   * text in the same font, at the same size, with the same padding, with the
   * spans the parser recognised carrying a background tint. The input is painted
   * on top (`relative`, so it wins the stacking order), which keeps the real
   * glyphs — and therefore the caret and IME composition — in charge, while the
   * mirror only ever contributes the tint rectangles. The mirror's own glyphs
   * are `text-transparent`, so nothing is drawn twice.
   *
   * Keeping the mirror under the caret is the whole problem: it is a single-line
   * field, so a long value scrolls rather than wraps, and the mirror has to
   * follow that scroll. `scrollLeft` is copied on every input `scroll` (typing
   * near the end, a paste, a delete that pulls the text back under the caret)
   * and again in a layout effect after each value change, because React can
   * reset the field's own scroll as it re-renders.
   */
  const highlightRef = useRef<HTMLDivElement>(null);
  const highlights = useMemo(() => quickAddHighlights(state.result), [state.result]);
  const segments = useMemo(
    () => highlightSegments(state.value, highlights),
    [state.value, highlights],
  );

  const syncHighlightScroll = useCallback(() => {
    const input = inputRef.current;
    const highlight = highlightRef.current;
    if (input && highlight) highlight.scrollLeft = input.scrollLeft;
  }, [inputRef]);

  useLayoutEffect(() => {
    syncHighlightScroll();
  }, [state.value, syncHighlightScroll]);

  return (
    <div className="flex flex-col gap-stack">
      <div className="relative">
        {/*
         * The tint layer. It is `aria-hidden` so the field is read once, not
         * twice, and `pointer-events-none` so it never steals a tap or a caret
         * placement. `whitespace-pre` matches the input's own no-wrap behaviour;
         * `text-transparent` leaves it contributing geometry and background only.
         */}
        <div
          ref={highlightRef}
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 flex items-center overflow-hidden rounded-md border border-transparent',
            'px-3 py-1 text-base select-none text-transparent md:text-sm',
            'whitespace-pre',
          )}
        >
          <span className="shrink-0 whitespace-pre">
            {segments.map((segment, index) =>
              segment.kind ? (
                /*
                 * The horizontal padding is cancelled by the matching negative
                 * margin, so the tint reaches past the word without moving the
                 * word — or anything after it. This layer has to stay
                 * character-aligned with the input it sits behind, and padding
                 * on an inline span otherwise pushes every following glyph to
                 * the right, which is exactly the drift the mirror cannot
                 * afford. The pair is load-bearing: `px` without `-mx` slides
                 * the sentence out of step with the caret.
                 *
                 * Which side gets which padding depends on what is across the
                 * gap — see the constants above.
                 */
                <span
                  key={index}
                  className={cn(
                    'rounded-sm',
                    TINT_PAD_VERTICAL,
                    facesTint(segments, index, -1) ? TINT_PAD_INNER_LEFT : TINT_PAD_OUTER_LEFT,
                    facesTint(segments, index, 1) ? TINT_PAD_INNER_RIGHT : TINT_PAD_OUTER_RIGHT,
                    HIGHLIGHT_CLASS[segment.kind],
                  )}
                >
                  {segment.text}
                </span>
              ) : (
                <span key={index}>{segment.text}</span>
              ),
            )}
          </span>
        </div>
        <Input
          ref={inputRef}
          autoFocus
          type="text"
          value={state.value}
          disabled={!state.online}
          placeholder="Add a task…"
          aria-label="Quick add a task"
          /*
           * Combobox wiring. The field owns the menu and reports whether it is
           * open and which row is highlighted; the menu never takes focus,
           * because focus leaving the field is what would dismiss it.
           */
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? listboxId : undefined}
          aria-activedescendant={highlighted >= 0 ? `${listboxId}-${highlighted}` : undefined}
          onChange={(event) => {
            state.setValue(event.target.value);
            setCaret(event.target.selectionStart ?? event.target.value.length);
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
          onKeyDown={onKeyDown}
          onScroll={syncHighlightScroll}
          className="relative"
        />
      </div>

      {/*
       * The list shortcut's menu, directly under the field it belongs to. Rows are
       * buttons rather than options on a focusable list: `mousedown` is cancelled
       * so the field keeps focus, because focus leaving it is what closes the menu
       * — and the click that follows still lands.
       */}
      {menuOpen ? (
        suggestions.length ? (
          <div
            id={listboxId}
            role="listbox"
            aria-label="Lists"
            className="flex max-h-44 flex-col overflow-y-auto rounded-md border border-border"
          >
            {suggestions.map((list, index) => (
              <button
                key={list.id}
                id={`${listboxId}-${index}`}
                type="button"
                role="option"
                aria-selected={index === highlighted}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => accept(list)}
                className={cn(
                  'flex min-h-9 items-center gap-2 px-3 text-left text-sm',
                  index === highlighted ? 'bg-accent text-accent-foreground' : 'text-foreground',
                )}
              >
                <span className="truncate">{list.name}</span>
                {index === highlighted ? (
                  <span className="ml-auto text-xs text-muted-foreground">Enter</span>
                ) : null}
              </button>
            ))}
          </div>
        ) : typed ? (
          // A name nothing matches is still a valid answer: the submit path
          // creates the list, so the menu says so rather than staying silent.
          <p className="px-1 text-xs text-muted-foreground">
            No list matches “{typed}” — adding the task will create it.
          </p>
        ) : null
      ) : null}

      {/*
       * The toolbar: what the sentence did not say, as small controls, with the
       * submit at the trailing edge — the shape iOS uses for the same job.
       *
       * The confirmation chips that used to sit here are gone on purpose. They
       * repeated what the tinted layer already shows in place, in the words the
       * user actually typed, and the row cost a line of the sheet every time.
       * The one thing the chips carried that the tint does not — the resolved
       * date as text — is now the calendar chip's label.
       */}
      <div className="flex items-center gap-1">
        {state.calendars.length ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                aria-label="Calendar"
                className="h-9 min-w-0 gap-1.5 rounded-full px-2 text-sm text-muted-foreground"
              >
                <CalendarIcon className="size-4 shrink-0" aria-hidden />
                {/*
                 * The date is the primary-coloured half of the chip until a
                 * calendar is actually chosen: it is what the sheet is
                 * confirming, and the calendar is the thing still missing.
                 */}
                <span className={cn('truncate', !selectedCalendar && 'text-primary')}>
                  {calendarLabel}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" role="menu" className="w-64 p-1">
              <MenuRow selected={!selectedCalendar} onSelect={() => state.setCalendarId('')}>
                No calendar
              </MenuRow>
              {state.calendars.map((calendar) => (
                <MenuRow
                  key={calendar.id}
                  selected={calendar.id === state.calendarId}
                  glyph={
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: calendarColorHex(calendar) }}
                    />
                  }
                  onSelect={() => state.setCalendarId(calendar.id)}
                >
                  {calendar.name}
                </MenuRow>
              ))}
            </PopoverContent>
          </Popover>
        ) : null}

        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Priority"
              className={cn(
                'size-9 shrink-0 rounded-full',
                currentPriority === 'none' ? 'text-muted-foreground' : priorityColor(currentPriority),
              )}
            >
              <Flag className="size-4" aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" role="menu" className="w-44 p-1">
            <MenuRow selected={currentPriority === 'none'} onSelect={() => setPriority(null)}>
              No priority
            </MenuRow>
            {(['high', 'medium', 'low'] as const).map((priority) => (
              <MenuRow
                key={priority}
                selected={currentPriority === priority}
                glyph={<Flag className={cn('size-4 shrink-0', priorityColor(priority))} aria-hidden />}
                onSelect={() => setPriority(priority)}
              >
                {priorityLabel(priority)}
              </MenuRow>
            ))}
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Tag"
              className="size-9 shrink-0 rounded-full text-muted-foreground"
            >
              <TagIcon className="size-4" aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" role="menu" className="w-56 p-1">
            {state.tags.length ? (
              state.tags.map((tag) => (
                <MenuRow
                  key={tag.id}
                  selected={state.result.tags.includes(tag.name)}
                  onSelect={() => appendToken(`#${tag.name}`)}
                >
                  #{tag.name}
                </MenuRow>
              ))
            ) : (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                No tags yet — type #name in the sentence to make one.
              </p>
            )}
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Repeat"
              className={cn(
                'size-9 shrink-0 rounded-full',
                state.result.recurrenceRule ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <LoopIcon className="size-4" aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" role="menu" className="w-48 p-1">
            {REPEAT_OPTIONS.map((option) => (
              <MenuRow key={option.token} onSelect={() => appendToken(option.token)}>
                {option.label}
              </MenuRow>
            ))}
          </PopoverContent>
        </Popover>

        {/*
         * The ellipsis carries the grammar hint that the chips row used to hold
         * open — the sheet itself is now just the sentence and its tools — and
         * the offline notice, which is the one message that must not be hidden
         * behind a tap when it applies.
         */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="More"
              className="size-9 shrink-0 rounded-full text-muted-foreground"
            >
              <DotsHorizontalIcon className="size-4" aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-3">
            <p className="text-xs text-muted-foreground">
              Type it the way you would say it: “Pay rent tomorrow 5pm !high #home”, “@Work call
              Sam”, “every monday gym”.
            </p>
          </PopoverContent>
        </Popover>

        <Button
          type="button"
          size="icon"
          aria-label="Add task"
          className="ml-auto size-9 shrink-0 rounded-full"
          disabled={!state.online || !state.value.trim() || state.busy}
          aria-busy={state.busy || undefined}
          onClick={() => void submit()}
        >
          {state.busy ? (
            // `status` + a name, so the wait is announced rather than silent —
            // the same announcement MUI's spinner carried.
            <span
              role="status"
              aria-label="Saving"
              className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            />
          ) : (
            <ArrowUpIcon className="size-4" aria-hidden />
          )}
        </Button>
      </div>

      {state.online ? null : (
        <span className="text-xs text-muted-foreground">{state.offlineNotice}</span>
      )}
    </div>
  );
}

/** The quick-add dialog: the one way to type a task in a sentence. */
export function QuickAddBar({ open, onOpenChange, listId = null, onCreated }: QuickAddBarProps) {
  const state = useQuickAdd(listId, onCreated);
  /*
   * One ref for the field, owned here rather than inside the panel, because two
   * mechanisms have to agree on it: the panel's layout effect (the same-task
   * focus) and Radix's cancelled autofocus below.
   */
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        /*
         * A bottom sheet, and nothing else. `p-0`/`gap-0` neutralise the
         * dialog's own `p-6`/`gap-4` (a token class cannot override them — see
         * the note on `tailwind-merge` in `TaskListSection`), and the padding
         * that remains is the sheet's own, on the wrapper below.
         */
        className={cn(
          'bottom-0 top-auto left-0 max-w-full translate-x-0 translate-y-0',
          'gap-0 rounded-t-2xl rounded-b-none border-x-0 border-b-0 p-0',
          /*
           * Instant in, animated out — and the two have to be stated
           * separately, because they are for different reasons.
           *
           * The entrance is `duration-0` + `animate-none`: the panel must be in
           * the DOM, and the input focusable, in the commit the tap produced, or
           * iOS never raises the keyboard. That applies to the entrance only.
           *
           * The exit was switched off along with it, and that is what the user
           * was seeing: \u201cthe bottom sheets \u2026 just immediately disappear
           * if I click outside\u201d. Radix keeps a closing panel mounted only
           * while it has an animation to finish; with `animate-none` there is
           * none, so the panel was removed a frame after the tap (measured: gone
           * at t+40ms, one frame, no transform) while the scrim behind it faded
           * for its own 200ms \u2014 the sheet blinked out of a scene that was
           * still dimming.
           *
           * So the closed state gets its own animation, and it mirrors the
           * primitive's own sheet geometry: `slide-out-to-bottom` translates the
           * panel by 100% of its own height, the same distance the GodUI
           * `Drawer` uses for its exit spring, off the bottom edge it is pinned
           * to. 200ms is the duration the other dialogs already close over.
           */
          'data-[state=open]:duration-0 data-[state=open]:animate-none',
          'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=closed]:duration-200 data-[state=closed]:ease-out',
        )}
        showCloseButton={false}
        /*
         * Radix's own autofocus runs in a passive effect, a frame after the tap,
         * where the gesture is already spent. Cancel it and let the layout effect
         * above own the focus, in the tap's own task.
         */
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus({ preventScroll: true });
        }}
      >
        <div className="flex flex-col gap-stack px-card pt-card pb-[max(0.25rem,env(safe-area-inset-bottom,0px))]">
          {/*
           * The title and the description are for the screen reader only. The
           * sheet the user sees is the sentence and its toolbar — a visible "New
           * task" heading would be a label over a field that already says what it
           * is, and the paragraph explaining the grammar now lives behind the
           * ellipsis, where it is available without being in the way. Radix still
           * needs a title (it names the dialog from it), so it stays, hidden.
           *
           * No explicit `id` on it: Radix renders `<h2 id={context.titleId}
           * {...titleProps}>` — the caller's props come last, so passing an `id`
           * would override the generated one and leave the content's
           * `aria-labelledby` pointing at nothing.
           */}
          <DialogTitle className="sr-only">New task</DialogTitle>
          <DialogDescription className="sr-only">
            Type it the way you would say it — the date, priority and tags are read out of the
            sentence.
          </DialogDescription>
          <QuickAddInput
            state={state}
            open={open}
            onClose={() => onOpenChange(false)}
            inputRef={inputRef}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
