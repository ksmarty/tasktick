/**
 * Quick-add → API payload mapping.
 *
 * `@/lib/nlp` owns *understanding* the sentence; this module owns what the app
 * does with that understanding — resolving `@Groceries` to a list id (creating
 * the list when it does not exist yet), collapsing duplicate `#tags`, and
 * turning the parse into the payload `/api/tasks` expects.
 *
 * Pure: the same input produces the same payload, so it is covered by
 * `tests/tasks-quick-add.test.ts` instead of a DOM test.
 */
import {
  combineDateAndTime,
  formatTime,
  fromDateOnly,
  humanDuration,
  relativeDayLabel,
  toDateOnly,
  todayIn,
} from '@/lib/dates';
import type { QuickAddMatch, QuickAddResult } from '@/lib/nlp';
import { describeRRule } from '@/lib/rrule';
import type { Millis } from '@/lib/types';
import type { CreateTaskPayload } from './payloads';
import { priorityLabel } from './priority';

export interface ListLike {
  id: string;
  name: string;
}

export interface QuickAddContext {
  /** IANA zone used for every label and for all-day resolution. */
  zone: string;
  timeFormat?: '12h' | '24h';
  lists: readonly ListLike[];
  /** The list the inline bar sits in, or the list being viewed. */
  listId?: string | null;
  /** Fallback when the sentence names no list. */
  inboxListId?: string | null;
  defaultListId?: string | null;
  /** Injected clock, so the preview labels are deterministic in tests. */
  nowMs?: Millis;
}

export interface QuickAddPlan {
  payload: CreateTaskPayload;
  /**
   * Name of a list the sentence asked for that does not exist yet. The caller
   * creates it (`POST /api/lists`) and then fills in `payload.listId`.
   */
  createListName: string | null;
}

/** Case-insensitive, order-preserving de-duplication of tag names. */
export function dedupeTagNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim().replace(/^#/, '');
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Matches `@Name` against the user's lists, ignoring case and surrounding space. */
export function findListByName(lists: readonly ListLike[], name: string): ListLike | null {
  const needle = name.trim().replace(/^@/, '').toLowerCase();
  if (!needle) return null;
  return lists.find((list) => list.name.trim().toLowerCase() === needle) ?? null;
}

/**
 * Builds the create payload for a parsed sentence, or `null` when there is
 * nothing worth creating (a parse with no title — e.g. the user only typed
 * `!high` — would be rejected by the server's `title.min(1)` anyway).
 */
export function planQuickAdd(result: QuickAddResult, context: QuickAddContext): QuickAddPlan | null {
  const title = result.title.trim();
  if (!title) return null;

  const payload: CreateTaskPayload = { title };
  let createListName: string | null = null;

  if (result.dueDate) {
    payload.dueDate = result.dueDate;
    // An explicit day without a clock time is an all-day task: `null` tells the
    // server "no time", which is different from "leave the time alone".
    payload.dueTime = result.dueTime ?? null;
  } else if (result.dueTime) {
    payload.dueDate = resolveAnchorDay(context);
    payload.dueTime = result.dueTime;
  }

  if (result.priority !== 'none') payload.priority = result.priority;
  if (result.estimateMinutes && result.estimateMinutes > 0) payload.estimateMinutes = result.estimateMinutes;
  if (result.recurrenceRule) payload.recurrenceRule = result.recurrenceRule;

  const tagNames = dedupeTagNames(result.tags);
  if (tagNames.length) payload.tagNames = tagNames;

  if (result.listName) {
    const match = findListByName(context.lists, result.listName);
    if (match) payload.listId = match.id;
    else createListName = result.listName.trim().replace(/^@/, '');
  } else {
    payload.listId = context.listId ?? context.inboxListId ?? context.defaultListId ?? null;
  }

  return { payload, createListName };
}

function resolveAnchorDay(context: QuickAddContext): string {
  return context.nowMs !== undefined ? toDateOnly(context.nowMs, context.zone) : todayIn(context.zone);
}

export type QuickAddChipKind = QuickAddMatch['kind'];

export interface QuickAddChip {
  kind: QuickAddChipKind;
  label: string;
}

/**
 * A range of the typed sentence the parser actually consumed.
 *
 * This is the in-place counterpart of a chip: `start`/`end` are half-open
 * character offsets into the ORIGINAL input, straight from
 * `QuickAddResult.matches`, so a highlight can never disagree with the parse.
 * Sorted by position, which is what a renderer walking the string left to right
 * needs (the parser records matches in the order its pattern groups run, not in
 * the order they appear).
 */
export interface QuickAddHighlight {
  kind: QuickAddChipKind;
  start: number;
  end: number;
}

/** The parser's `matches`, as half-open ranges sorted by where they appear. */
export function quickAddHighlights(result: QuickAddResult): QuickAddHighlight[] {
  return result.matches
    .map((match) => ({ kind: match.kind, start: match.index, end: match.index + match.text.length }))
    .filter((highlight) => highlight.end > highlight.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

/** One run of the input, tagged with the kind the parser gave it or `null`. */
export interface QuickAddSegment {
  text: string;
  kind: QuickAddChipKind | null;
}

/**
 * Splits the value into contiguous runs, tagging the recognised ones.
 *
 * Defensive about ranges: it clamps them into the string and never lets a
 * malformed range drop text or loop, so the mirror layer can always reproduce
 * exactly what is in the field — the caret and the glyphs must never desync.
 */
export function highlightSegments(
  value: string,
  highlights: readonly QuickAddHighlight[],
): QuickAddSegment[] {
  const segments: QuickAddSegment[] = [];
  let cursor = 0;

  for (const highlight of highlights) {
    const start = Math.min(Math.max(highlight.start, cursor), value.length);
    const end = Math.min(Math.max(highlight.end, start), value.length);
    if (start > cursor) segments.push({ text: value.slice(cursor, start), kind: null });
    if (end > start) segments.push({ text: value.slice(start, end), kind: highlight.kind });
    cursor = end;
  }

  if (cursor < value.length) segments.push({ text: value.slice(cursor), kind: null });
  return segments;
}

/**
 * The live preview line: one tinted chip per kind the parser actually
 * recognised, ordered by where the fragment first appeared in the sentence, so
 * the chips read the way the user typed them.
 */
export function quickAddChips(result: QuickAddResult, context: QuickAddContext): QuickAddChip[] {
  const firstIndex = new Map<QuickAddChipKind, number>();
  for (const match of result.matches) {
    const previous = firstIndex.get(match.kind);
    if (previous === undefined || match.index < previous) firstIndex.set(match.kind, match.index);
  }
  const kinds = [...firstIndex.entries()].sort((a, b) => a[1] - b[1]).map(([kind]) => kind);

  const anchor = resolveAnchorDay(context);
  const prefs = { zone: context.zone, timeFormat: context.timeFormat ?? '24h', weekStartsOn: 0 };

  return kinds.flatMap<QuickAddChip>((kind) => {
    switch (kind) {
      case 'date': {
        if (!result.dueDate) return [];
        return [{ kind, label: relativeDayLabel(result.dueDate, context.zone, fromDateOnly(anchor, context.zone)) }];
      }
      case 'time': {
        if (!result.dueTime) return [];
        const at = combineDateAndTime(result.dueDate ?? anchor, result.dueTime, context.zone);
        return [{ kind, label: formatTime(at, prefs) }];
      }
      case 'repeat': {
        const label = describeRRule(result.recurrenceRule);
        return label ? [{ kind, label }] : [];
      }
      case 'priority':
        return [{ kind, label: priorityLabel(result.priority) }];
      case 'tag':
        return dedupeTagNames(result.tags).map((name) => ({ kind, label: `#${name}` }));
      case 'list':
        return result.listName ? [{ kind, label: `@${result.listName}` }] : [];
      case 'estimate':
        return result.estimateMinutes ? [{ kind, label: humanDuration(result.estimateMinutes) }] : [];
      default:
        return [];
    }
  });
}
