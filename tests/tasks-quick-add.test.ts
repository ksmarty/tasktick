/**
 * Quick-add parsing → create payload mapping.
 */
import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { parseQuickAdd } from '@/lib/nlp';
import {
  dedupeTagNames,
  findListByName,
  planQuickAdd,
  quickAddChips,
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
});
