/**
 * Quick-add parsing → create payload mapping.
 */
import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { parseQuickAdd } from '@/lib/nlp';
import {
  dedupeTagNames,
  findListByName,
  highlightSegments,
  listNameFromToken,
  listTokenAt,
  planQuickAdd,
  quickAddChips,
  quickAddHighlights,
  suggestLists,
  type QuickAddContext,
} from '@/components/tasks/quick-add';

/** Monday, 12 May 2025, 09:00 UTC — a fixed clock keeps every label stable. */
const NOW_MS = DateTime.fromObject(
  { year: 2025, month: 5, day: 12, hour: 9 },
  { zone: 'utc' },
).toMillis();

const LISTS = [
  { id: 'inbox', name: 'Inbox' },
  { id: 'work', name: 'Work' },
  { id: 'groceries', name: 'Groceries' },
];

const context: QuickAddContext = {
  zone: 'utc',
  timeFormat: '24h',
  lists: LISTS,
  inboxListId: 'inbox',
  defaultListId: 'work',
  nowMs: NOW_MS,
};

function plan(input: string, overrides: Partial<QuickAddContext> = {}) {
  const parsed = parseQuickAdd(input, { zone: 'utc', now: DateTime.fromMillis(NOW_MS, { zone: 'utc' }) });
  return { parsed, plan: planQuickAdd(parsed, { ...context, ...overrides }) };
}

describe('dedupeTagNames', () => {
  it('collapses duplicates regardless of case and strips leading hashes', () => {
    expect(dedupeTagNames(['Work', 'work', '#WORK', ' home '])).toEqual(['Work', 'home']);
  });

  it('drops empty names', () => {
    expect(dedupeTagNames(['', '   ', '#'])).toEqual([]);
  });
});

describe('findListByName', () => {
  it('matches ignoring case, whitespace and the @ prefix', () => {
    expect(findListByName(LISTS, 'Work')?.id).toBe('work');
    expect(findListByName(LISTS, '@work')?.id).toBe('work');
    expect(findListByName(LISTS, ' groceries ')?.id).toBe('groceries');
  });

  it('returns null for an unknown or empty name', () => {
    expect(findListByName(LISTS, 'Nope')).toBeNull();
    expect(findListByName(LISTS, '')).toBeNull();
  });
});

/** Lists with a space in the name, which is the case the quoted token exists for. */
const SPACED_LISTS = [
  { id: 'reading', name: 'Reading list' },
  { id: 'work', name: 'Work' },
];

describe('listNameFromToken', () => {
  it('strips the @, the quotes and the padding', () => {
    expect(listNameFromToken('@Work')).toBe('Work');
    expect(listNameFromToken('@"Reading list"')).toBe('Reading list');
    expect(listNameFromToken("@'Reading list'")).toBe('Reading list');
    expect(listNameFromToken('  groceries  ')).toBe('groceries');
  });

  it('keeps a quote that is inside the name', () => {
    // The outer quotes are the only ones stripped, and greedily so: a name that
    // itself contains a quote survives the trip.
    expect(listNameFromToken('@"The "big" list"')).toBe('The "big" list');
  });
});

describe('findListByName — names with spaces', () => {
  it('matches a quoted token against a list with spaces in its name', () => {
    expect(findListByName(SPACED_LISTS, 'Reading list')?.id).toBe('reading');
    expect(findListByName(SPACED_LISTS, '@"Reading list"')?.id).toBe('reading');
    expect(findListByName(SPACED_LISTS, '@"reading LIST"')?.id).toBe('reading');
  });

  it('still refuses a name no list has', () => {
    expect(findListByName(SPACED_LISTS, '@"Reading"')).toBeNull();
    expect(findListByName(SPACED_LISTS, '@"Reading list"')).not.toBeNull();
  });
});

describe('planQuickAdd — filing into a list with spaces in its name', () => {
  it('files into the list when the quoted name matches one', () => {
    const { plan: result } = plan('File the receipts @"Reading list"', { lists: SPACED_LISTS });
    expect(result?.payload.listId).toBe('reading');
    expect(result?.createListName).toBeNull();
  });

  it('asks for the unquoted name when nothing matches', () => {
    const { plan: result } = plan('File the receipts @"Reading list"');
    expect(result?.payload.listId).toBeUndefined();
    expect(result?.createListName).toBe('Reading list');
  });
});

describe('listTokenAt', () => {
  it('finds the token the caret is in, and what was typed into it', () => {
    expect(listTokenAt('call Sam @gro', 13)).toEqual({ start: 9, end: 13, query: 'gro' });
  });

  it('opens on a bare @ with nothing typed into it yet', () => {
    // The caret is *after* the `@`, which is where it is the moment it is typed.
    expect(listTokenAt('call Sam @', 10)).toEqual({ start: 9, end: 10, query: '' });
  });

  it('is null once the caret has left the token', () => {
    expect(listTokenAt('call Sam @gro bread', 18)).toBeNull();
    expect(listTokenAt('call Sam @gro bread', 12)).toMatchObject({ start: 9, query: 'gr' });
  });

  it('treats a quoted token as one token, spaces and all', () => {
    const value = 'file @"Reading list" today';
    // Caret inside the name, and again just before the closing quote.
    expect(listTokenAt(value, 12)).toEqual({ start: 5, end: 19, query: 'Readi' });
    expect(listTokenAt(value, 19)).toEqual({ start: 5, end: 19, query: 'Reading list' });
    // Past the closing quote the caret is in the title again.
    expect(listTokenAt(value, 22)).toBeNull();
  });

  it('runs an unclosed quote on to the end, which is mid-typing', () => {
    const value = 'file @"Reading li';
    expect(listTokenAt(value, value.length)).toEqual({ start: 5, end: 17, query: 'Reading li' });
  });

  it('ignores an address, whose @ has no space in front of it', () => {
    expect(listTokenAt('mail sam@example.com', 19)).toBeNull();
  });
});

describe('suggestLists', () => {
  const LISTS_FOR_SUGGESTIONS = [
    { id: 'weekly', name: 'Weekly groceries' },
    { id: 'groc', name: 'Groceries' },
    { id: 'read', name: 'Reading list' },
  ];

  it('offers every list for a bare @, alphabetically', () => {
    expect(suggestLists(LISTS_FOR_SUGGESTIONS, '').map((list) => list.id)).toEqual(['groc', 'read', 'weekly']);
  });

  it('puts an exact name first, then prefixes, then anything containing it', () => {
    expect(suggestLists(LISTS_FOR_SUGGESTIONS, 'gro').map((list) => list.id)).toEqual(['groc', 'weekly']);
    expect(suggestLists(LISTS_FOR_SUGGESTIONS, 'Groceries').map((list) => list.id)).toEqual(['groc', 'weekly']);
  });

  it('matches ignoring case, and honours the limit', () => {
    expect(suggestLists(LISTS_FOR_SUGGESTIONS, 'READING').map((list) => list.id)).toEqual(['read']);
    expect(suggestLists(LISTS_FOR_SUGGESTIONS, '', 2)).toHaveLength(2);
  });

  it('returns nothing when nothing matches', () => {
    expect(suggestLists(LISTS_FOR_SUGGESTIONS, 'zzz')).toEqual([]);
  });
});

describe('planQuickAdd', () => {
  it('maps a full sentence onto every field the API accepts', () => {
    const { parsed, plan: result } = plan('Buy milk tomorrow 17:00 !high #errand ~30m every week');

    expect(parsed.title).toBe('Buy milk');
    expect(result?.createListName).toBeNull();
    expect(result?.payload).toEqual({
      title: 'Buy milk',
      dueDate: '2025-05-13',
      dueTime: '17:00',
      priority: 'high',
      estimateMinutes: 30,
      recurrenceRule: 'FREQ=WEEKLY',
      tagNames: ['errand'],
      listId: 'inbox',
    });
  });

  it('marks an explicit day without a clock time as all-day', () => {
    const { plan: result } = plan('Water the plants tomorrow');
    expect(result?.payload.dueDate).toBe('2025-05-13');
    expect(result?.payload.dueTime).toBeNull();
  });

  it('anchors a time-only sentence on today', () => {
    const { plan: result } = plan('Stand up 9:30');
    expect(result?.payload.dueDate).toBe('2025-05-12');
    expect(result?.payload.dueTime).toBe('09:30');
  });

  it('resolves @List to an id when the list exists', () => {
    const { plan: result } = plan('Eggs and bread @Groceries');
    expect(result?.payload.listId).toBe('groceries');
    expect(result?.createListName).toBeNull();
  });

  it('asks for a new list when the name does not exist yet', () => {
    const { plan: result } = plan('File taxes @Finance');
    expect(result?.payload.listId).toBeUndefined();
    expect(result?.createListName).toBe('Finance');
  });

  it('prefers the list being viewed when the sentence names none', () => {
    const { plan: result } = plan('Call the dentist', { listId: 'groceries' });
    expect(result?.payload.listId).toBe('groceries');
  });

  it('falls back to the inbox, then the default list', () => {
    expect(plan('Call the dentist').plan?.payload.listId).toBe('inbox');
    expect(plan('Call the dentist', { inboxListId: null }).plan?.payload.listId).toBe('work');
    expect(plan('Call the dentist', { inboxListId: null, defaultListId: null }).plan?.payload.listId).toBeNull();
  });

  it('deduplicates tags before they reach the server', () => {
    const { plan: result } = plan('Ship the deck #work #Work #Q2');
    expect(result?.payload.tagNames).toEqual(['work', 'Q2']);
  });

  it('omits every optional field for a plain sentence', () => {
    const { plan: result } = plan('Just a task');
    expect(result?.payload).toEqual({ title: 'Just a task', listId: 'inbox' });
  });

  it('refuses to build a task with no title', () => {
    const { parsed, plan: result } = plan('!high');
    expect(parsed.title).toBe('');
    expect(result).toBeNull();
  });
});

describe('quickAddChips', () => {
  it('reports each recognised kind once, in the order it was typed', () => {
    const { parsed } = plan('Buy milk tomorrow !high #errand @Work ~30m every week 17:00');
    const chips = quickAddChips(parsed, context);

    expect(chips.map((chip) => chip.kind)).toEqual(['date', 'priority', 'tag', 'list', 'estimate', 'repeat', 'time']);
    expect(chips.find((chip) => chip.kind === 'priority')?.label).toBe('High');
    expect(chips.find((chip) => chip.kind === 'tag')?.label).toBe('#errand');
    expect(chips.find((chip) => chip.kind === 'list')?.label).toBe('@Work');
    expect(chips.find((chip) => chip.kind === 'estimate')?.label).toBe('30m');
    expect(chips.find((chip) => chip.kind === 'repeat')?.label).toBe('Every week');
    expect(chips.find((chip) => chip.kind === 'time')?.label).toBe('17:00');
  });

  it('labels the recognised day relatively', () => {
    const { parsed } = plan('Buy milk tomorrow');
    const [chip] = quickAddChips(parsed, context);
    expect(chip.kind).toBe('date');
    expect(chip.label).toBe('Tomorrow');
  });

  it('labels every recognised tag', () => {
    const { parsed } = plan('Pack #passport #charger');
    const chips = quickAddChips(parsed, context);
    expect(chips.map((chip) => chip.label)).toEqual(['#passport', '#charger']);
  });

  it('returns nothing for a plain sentence', () => {
    const { parsed } = plan('Just a task');
    expect(quickAddChips(parsed, context)).toEqual([]);
  });

  it('labels a quoted list chip with its quotes, so the sentence can be read back', () => {
    const { parsed } = plan('File the receipts @"Reading list"');
    expect(quickAddChips(parsed, context).find((chip) => chip.kind === 'list')?.label).toBe('@"Reading list"');
  });
});

/**
 * The in-place highlight must be the parser's own truth, so these pin the ranges
 * `parseQuickAdd` reports — not a pattern re-derived in the view. The token
 * patterns (`at 7pm`, `#tag`, `!high`) consume a leading space to anchor on a
 * word boundary; that space must not become part of the highlighted range, or a
 * tint sits one character left of the word it claims to have understood.
 */
describe('quickAddHighlights', () => {
  it('reports exact, space-trimmed ranges for the three report sentences', () => {
    expect(quickAddHighlights(plan('today at 7pm go home').parsed)).toEqual([
      { kind: 'date', start: 0, end: 5 },
      { kind: 'time', start: 6, end: 12 },
    ]);
    expect(quickAddHighlights(plan('tomorrow 9am #work').parsed)).toEqual([
      { kind: 'date', start: 0, end: 8 },
      { kind: 'time', start: 9, end: 12 },
      { kind: 'tag', start: 13, end: 18 },
    ]);
    expect(quickAddHighlights(plan('every monday !high').parsed)).toEqual([
      { kind: 'repeat', start: 0, end: 12 },
      { kind: 'priority', start: 13, end: 18 },
    ]);
  });

  it('is sorted by position, not by the order the pattern groups ran', () => {
    const { parsed } = plan('Buy milk tomorrow 17:00 !high #errand ~30m every week');
    const starts = quickAddHighlights(parsed).map((highlight) => highlight.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it('reports nothing for a plain sentence', () => {
    expect(quickAddHighlights(plan('Just a task').parsed)).toEqual([]);
  });
});

describe('highlightSegments', () => {
  it('splits the value into recognised runs and untouched text', () => {
    const value = 'today at 7pm go home';
    expect(highlightSegments(value, quickAddHighlights(plan(value).parsed))).toEqual([
      { text: 'today', kind: 'date' },
      { text: ' ', kind: null },
      { text: 'at 7pm', kind: 'time' },
      { text: ' go home', kind: null },
    ]);
  });

  it('reproduces the value exactly, even around recognised runs', () => {
    const value = 'tomorrow 9am #work';
    const segments = highlightSegments(value, quickAddHighlights(plan(value).parsed));
    expect(segments.map((segment) => segment.text).join('')).toBe(value);
  });

  it('has nothing to highlight for an empty field', () => {
    expect(highlightSegments('', quickAddHighlights(plan('').parsed))).toEqual([]);
  });
});

/**
 * The pin the task asked for: whatever the highlighting work does, this sentence
 * must still become the same task with the same due date. The parsing is the
 * contract; the tint is decoration.
 */
describe('pinned parse — today at 7pm go home', () => {
  it('still produces the same task it did before the highlight work', () => {
    const { parsed, plan: result } = plan('today at 7pm go home');
    expect(parsed.title).toBe('go home');
    expect(parsed.dueDate).toBe('2025-05-12');
    expect(parsed.dueTime).toBe('19:00');
    expect(parsed.isAllDay).toBe(false);
    expect(result?.createListName).toBeNull();
    expect(result?.payload).toEqual({
      title: 'go home',
      dueDate: '2025-05-12',
      dueTime: '19:00',
      listId: 'inbox',
    });
  });
});
