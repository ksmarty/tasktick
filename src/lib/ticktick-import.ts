/**
 * TickTick CSV backup → TaskTick import plan.
 *
 * ## What a TickTick export is
 *
 * TickTick has no public personal API. Its only documented way out is the web
 * app's **Settings → Backup → Generate Backup**, which downloads a **CSV** (the
 * same file "Import Backup" reads back). The shape below was verified against a
 * real **Version: 7.2** backup (2,550 data rows, 25 columns): TickTick writes a
 * short metadata preamble, then the header, then the rows.
 *
 * The preamble is *not* a fixed number of lines. Line 1 is `"Date: <iso>"`,
 * line 2 is `"Version: 7.2"`, and the status legend is a **single quoted field
 * containing embedded newlines**:
 *
 *   "Status: \n0 Normal\n-1 Abandoned \n2 Completed"
 *
 * The header is therefore located by the columns it carries (see
 * `findHeaderRow`), never assumed at line 1, and the reader is a full RFC 4180
 * parser so the quoted multi-line legend is one field, not three rows.
 *
 * Verified header (25 columns, in order):
 *
 *   Folder Name, List Name, Title, Kind, Tags, Content, Is Check list,
 *   Start Date, Due Date, Reminder, Repeat, Priority, Status, Created Time,
 *   Completed Time, Order, Timezone, Is All Day, Is Floating, Column Name,
 *   Column Order, View Mode, taskId, parentId, projectKind
 *
 * Fields that are mapped: title, list, tags, notes/content, completion status,
 * priority, due/start dates, recurrence, reminders, subtask parents, checklist
 * items and the created timestamp. Fields that are *not* mapped are collected
 * in `preview.unmappedColumns` (and `preview.issues` for individual rows) so the
 * UI can tell the user rather than silently discard data.
 *
 * Mapping rules, all unit-tested in `tests/import-ticktick.test.ts`:
 *
 *  - **Priority** is TickTick's `0/1/3/5` scale → `none/low/medium/high`.
 *    Anything else is mapped by threshold and reported.
 *  - **Status** is `0` normal / `-1` abandoned / `2` completed (the file's own
 *    legend). `1` is also accepted as completed for older exports. The explicit
 *    code wins: a `Completed Time` on a non-completed row is reported rather
 *    than silently flipping it. The `-1` code maps to `wont_do`.
 *  - **Dates** keep their *literal wall-clock* text. TickTick writes the task's
 *    own local time with a numeric offset (`2026-06-12T12:00:00+0000`, note the
 *    missing colon), so the instant is reconstructed later from the row's
 *    `Timezone` column by `createTask`, which is the layer that owns timezone
 *    maths. A date-only cell becomes an all-day task.
 *  - **Repeat** carries a bare RFC 5545 RRULE body (`FREQ=MONTHLY;…`), never an
 *    ISO-8601 duration. (The `PT0S`-style durations live in `Reminder`, not
 *    here.) It is accepted only when it looks like a rule; anything else is
 *    reported.
 *  - **Reminder** is one or more ISO-8601 durations, newline-separated, encoded
 *    as the offset from the due instant (`-P0DT15H0M0S` = 15 h before,
 *    `-PT1440M` = 1 day before, `PT0S` = on time). Each becomes a TaskTick
 *    reminder offset in minutes; an unparseable part is reported.
 *  - **Subtasks** come from `parentId` (flattened to TaskTick's two-level tree,
 *    with a report when a deeper nest is flattened) and from checklist lines
 *    (`▫` / `▪`) when `Kind`/`Is Check list` says the content is a checklist.
 */
import { DateTime, IANAZone } from 'luxon';
import { parseCsv } from './csv';
import type { DateOnly, Priority, TaskStatus } from './types';

/** Importer namespace recorded in `import_keys.source`. */
export const TICKTICK_SOURCE = 'ticktick';

/**
 * Hard cap on data rows per file. A 10k-row export is already far past what the
 * repository layer will write in a reasonable time, and the cap turns a hostile
 * or accidental giant file into an immediate, explicit error instead of a hung
 * request.
 */
export const MAX_IMPORT_ROWS = 10_000;

/** Cap on retained per-row issues; `issueCount` still reports the true total. */
const MAX_ISSUES = 100;

export interface TickTickListPlan {
  /** Stable identity: `list:<normalised name>`. */
  key: string;
  name: string;
  folder: string | null;
}

export interface TickTickTaskPlan {
  /** Stable identity: `task:<taskId>` (or `row:<n>` when the export has none). */
  key: string;
  /** `key` of the parent task for a subtask, else null. */
  parentKey: string | null;
  /** `key` of the owning {@link TickTickListPlan}. */
  listKey: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  completedAtMs: number | null;
  createdAtMs: number | null;
  priority: Priority;
  dueDate: DateOnly | null;
  /** `HH:mm`; a due time is what makes the task timed rather than all-day. */
  dueTime: string | null;
  startDate: DateOnly | null;
  startTime: string | null;
  /** IANA zone from the row, when it is one. */
  timezone: string | null;
  recurrenceRule: string | null;
  tags: string[];
  /** `Reminder` offsets in minutes, relative to the due instant. */
  reminders: number[];
}

export interface TickTickRowIssue {
  /** 1-based record number in the CSV, so the user can find the row. */
  row: number;
  column: string | null;
  value: string | null;
  message: string;
}

export interface TickTickPreview {
  fileName: string;
  /** Non-blank rows after the header. */
  dataRows: number;
  /** Rows that become top-level tasks. */
  tasks: number;
  /** Rows folded in as subtasks (parent/child rows plus checklist items). */
  subtasks: number;
  lists: { name: string; folder: string | null; tasks: number }[];
  tags: string[];
  completed: number;
  recurring: number;
  /** Reminder rows that will be created (one row can carry several). */
  reminders: number;
  /** Tasks whose status is TickTick's `-1` ("Abandoned"). */
  wontDo: number;
  /** Rows skipped because they had no title. */
  skippedRows: number;
  /** Header columns this importer does not consume. */
  unmappedColumns: string[];
  issues: TickTickRowIssue[];
  issueCount: number;
}

export interface TickTickPlan {
  lists: TickTickListPlan[];
  tasks: TickTickTaskPlan[];
  preview: TickTickPreview;
}

export type TickTickParseResult =
  | { ok: true; plan: TickTickPlan }
  | { ok: false; code: 'empty' | 'not_ticktick' | 'too_large' | 'truncated'; error: string };

/* -------------------------------------------------------------------------- */
/* header                                                                     */
/* -------------------------------------------------------------------------- */

/** Column names are matched case- and whitespace-insensitively. */
function canonical(value: string): string {
  return value.replace(/\u00a0/g, ' ').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Every spelling we accept for a column. `Canonical` is the internal name; the
 * aliases exist because TickTick has shipped "Timezone" and "Time Zone" at
 * different times and user-edited files vary in spacing.
 */
const COLUMN_ALIASES: Record<string, string[]> = {
  title: ['title'],
  list: ['list name', 'list'],
  folder: ['folder name', 'folder'],
  tags: ['tags'],
  content: ['content'],
  status: ['status'],
  createdAt: ['created time', 'created'],
  completedAt: ['completed time', 'completed'],
  priority: ['priority'],
  due: ['due date'],
  start: ['start date'],
  timezone: ['timezone', 'time zone'],
  allDay: ['is all day'],
  repeat: ['repeat'],
  taskId: ['taskid', 'task id'],
  parentId: ['parentid', 'parent id'],
  order: ['order'],
  kind: ['kind'],
  checkList: ['is check list', 'is checklist'],
  reminder: ['reminder', 'reminders'],
  projectKind: ['projectkind', 'project kind'],
};

/** Canonical alias → internal name, and the set of every accepted spelling. */
const ALIAS_TO_COLUMN = new Map<string, string>();
for (const [column, aliases] of Object.entries(COLUMN_ALIASES)) {
  for (const alias of aliases) ALIAS_TO_COLUMN.set(canonical(alias), column);
}

const REQUIRED_COLUMNS = ['title', 'list'] as const;

interface Header {
  /** Internal column name → field index. */
  index: Map<string, number>;
  /** Original header cells, for reporting. */
  cells: string[];
}

function readHeader(cells: string[]): Header {
  const index = new Map<string, number>();
  cells.forEach((cell, i) => {
    const column = ALIAS_TO_COLUMN.get(canonical(cell));
    if (column && !index.has(column)) index.set(column, i);
  });
  return { index, cells };
}

/**
 * Finds the header record.
 *
 * The two reference implementations disagree on how many metadata lines precede
 * the header (three vs six), and the official docs do not say. Rather than
 * hard-code an offset and mis-read newer exports, the header is located by
 * looking for a record that carries the required columns.
 */
function findHeaderRow(rows: string[][]): number {
  return rows.findIndex((row) => {
    if (row.length < 2) return false;
    const header = readHeader(row);
    return REQUIRED_COLUMNS.every((column) => header.index.has(column));
  });
}

function cell(row: string[], header: Header, column: string): string {
  const i = header.index.get(column);
  if (i === undefined) return '';
  return (row[i] ?? '').trim();
}

/**
 * TickTick's `Order` is a signed 64-bit integer (e.g. `-8070452868711186464`),
 * which is past `Number.MAX_SAFE_INTEGER`; decoding it as a float collapses
 * distinct values and shuffles task order. Keep it exact as a `bigint`.
 */
function parseOrderKey(value: string): bigint | null {
  const trimmed = value.trim();
  return /^[+-]?\d+$/.test(trimmed) ? BigInt(trimmed) : null;
}

/* -------------------------------------------------------------------------- */
/* field mapping                                                              */
/* -------------------------------------------------------------------------- */

const UNCHECKED_MARKERS = ['\u25ab', '\u2610'];
const CHECKED_MARKERS = ['\u25aa', '\u2611'];

function isTruthy(value: string): boolean {
  return ['true', '1', 'y', 'yes', 'checked'].includes(value.trim().toLowerCase());
}

/** Maps TickTick's 0/1/3/5 priority scale onto TaskTick's four levels. */
export function mapTickTickPriority(value: string): { priority: Priority; unexpected: boolean } {
  const trimmed = value.trim();
  if (!trimmed) return { priority: 'none', unexpected: false };
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return { priority: 'none', unexpected: true };
  const numeric = Math.trunc(parsed);
  if (numeric >= 5) return { priority: 'high', unexpected: numeric !== 5 };
  if (numeric >= 3) return { priority: 'medium', unexpected: numeric !== 3 };
  if (numeric >= 1) return { priority: 'low', unexpected: numeric !== 1 };
  return { priority: 'none', unexpected: numeric !== 0 };
}

/**
 * Maps TickTick's own status legend: `0` normal, `-1` abandoned, `2` completed.
 * `1` is also accepted as completed for older exports. The explicit code wins —
 * a `Completed Time` on a row whose status is not completed is surfaced by the
 * caller (`conflict`) instead of quietly flipping the task. Only an empty code
 * falls back to the completion timestamp.
 */
export function mapTickTickStatus(
  value: string,
  completedAtMs: number | null,
): { status: TaskStatus; unknown: boolean; conflict: boolean } {
  const trimmed = value.trim();
  if (!trimmed) {
    return { status: completedAtMs !== null ? 'completed' : 'todo', unknown: false, conflict: false };
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return { status: 'todo', unknown: true, conflict: false };
  switch (Math.trunc(parsed)) {
    case -1:
      return { status: 'wont_do', unknown: false, conflict: false };
    case 0:
      return { status: 'todo', unknown: false, conflict: completedAtMs !== null };
    case 1:
    case 2:
      return { status: 'completed', unknown: false, conflict: false };
    default:
      return { status: 'todo', unknown: true, conflict: false };
  }
}

/** Parses a TickTick date/time cell, keeping the literal wall-clock text. */
export function mapTickTickDateTime(
  value: string,
  isAllDay: boolean,
): { date: DateOnly; time: string | null } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(trimmed);
  if (!match) return null;
  const date = match[1]!;
  const time = match[2] && match[3] ? `${match[2]}:${match[3]}` : null;
  if (isAllDay || !time) return { date, time: null };
  return { date, time };
}

/**
 * Parses an instant column (`Created Time`, `Completed Time`).
 *
 * TickTick writes `2026-06-12T12:00:00+0000` — an offset without the colon that
 * ISO 8601 wants — so it is normalised before parsing. A value with no offset is
 * read in the row's timezone (falling back to UTC) rather than the server's.
 */
export function mapTickTickInstant(value: string, zone: string | null): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalised = trimmed.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const parsed = DateTime.fromISO(normalised, { zone: zone ?? 'utc' });
  return parsed.isValid ? parsed.toMillis() : null;
}

/** Accepts only a recognisable RFC 5545 RRULE body; anything else is reported. */
export function mapTickTickRecurrence(value: string): string | null {
  const first = value.split('\n')[0]?.trim() ?? '';
  if (!first) return null;
  const body = first.replace(/^RRULE:/i, '');
  return /(?:^|;)FREQ=(?:SECONDLY|MINUTELY|HOURLY|DAILY|WEEKLY|MONTHLY|YEARLY)(?:;|$)/i.test(body)
    ? body
    : null;
}

/**
 * Parses the `Reminder` cell.
 *
 * Real backups store one or more ISO-8601 durations, newline-separated, as the
 * offset from the due instant — negative is before the due time
 * (`-P0DT15H0M0S` = 15 hours before, `-PT1440M` = 1 day before); `PT0S` and
 * `-PT0S` mean "on time". Each value is returned as whole minutes so it maps
 * onto TaskTick's `offsetMinutes`. A part that is not a duration is handed back
 * so the caller can report it rather than drop it.
 */
export function mapTickTickReminders(value: string): { offsetMinutes: number[]; unparsed: string[] } {
  const offsetMinutes: number[] = [];
  const unparsed: string[] = [];
  const duration = /^([+-])?P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

  for (const raw of value.split(/\r?\n/)) {
    const part = raw.trim();
    if (!part) continue;
    const match = duration.exec(part);
    const hasUnit =
      match !== null &&
      (match[2] !== undefined || match[3] !== undefined || match[4] !== undefined || match[5] !== undefined);
    if (!match || !hasUnit) {
      unparsed.push(part);
      continue;
    }
    const sign = match[1] === '-' ? -1 : 1;
    const minutes =
      Number(match[2] ?? 0) * 1440 +
      Number(match[3] ?? 0) * 60 +
      Number(match[4] ?? 0) +
      Number(match[5] ?? 0) / 60;
    offsetMinutes.push(Math.round(sign * minutes));
  }

  return { offsetMinutes, unparsed };
}

/** Splits TickTick's `#work, focus` tag cell. Comma or semicolon separated. */
export function mapTickTickTags(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of value.split(/[,;]/)) {
    const tag = part.trim().replace(/^#+/, '').trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

function validZone(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return IANAZone.isValidZone(trimmed) ? trimmed : null;
}

interface ChecklistSplit {
  notes: string | null;
  items: { title: string; completed: boolean }[];
  /** Marker lines with no text after the marker; they cannot become a subtask. */
  emptyItems: number;
}

/** Splits `▫Passport\n▪Tickets` into checklist items plus remaining prose. */
export function splitTickTickChecklist(content: string): ChecklistSplit {
  const items: { title: string; completed: boolean }[] = [];
  const notes: string[] = [];
  let emptyItems = 0;
  for (const rawLine of content.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const checked = CHECKED_MARKERS.some((marker) => line.startsWith(marker));
    const unchecked = !checked && UNCHECKED_MARKERS.some((marker) => line.startsWith(marker));
    if (checked || unchecked) {
      const title = line.slice(1).trim();
      if (title) items.push({ title, completed: checked });
      else emptyItems += 1;
      continue;
    }
    notes.push(line);
  }
  const joined = notes.join('\n').trim();
  return { notes: joined ? joined : null, items, emptyItems };
}

/* -------------------------------------------------------------------------- */
/* the parser                                                                 */
/* -------------------------------------------------------------------------- */

interface RawRecord {
  row: number;
  sortIndex: number;
  order: bigint | null;
  taskId: string;
  parentId: string;
  title: string;
  listName: string;
  folder: string;
  tags: string[];
  notes: string | null;
  checklist: { title: string; completed: boolean }[];
  status: TaskStatus;
  completedAtMs: number | null;
  createdAtMs: number | null;
  priority: Priority;
  due: { date: DateOnly; time: string | null } | null;
  start: { date: DateOnly; time: string | null } | null;
  timezone: string | null;
  recurrenceRule: string | null;
  reminders: number[];
}

export interface ParseTickTickOptions {
  fileName?: string;
  maxRows?: number;
}

/**
 * Parses a TickTick CSV export into an inert plan. This function performs **no**
 * database access: the same call backs both the preview and the commit, so a
 * preview can never write and a commit can never act on stale state.
 */
export function parseTickTickCsv(text: string, options: ParseTickTickOptions = {}): TickTickParseResult {
  const maxRows = options.maxRows ?? MAX_IMPORT_ROWS;
  const fileName = options.fileName ?? 'ticktick.csv';
  const { rows, unclosedQuote, rowCount } = parseCsv(text);

  if (rowCount === 0) {
    return { ok: false, code: 'empty', error: 'That file is empty.' };
  }
  if (unclosedQuote) {
    return {
      ok: false,
      code: 'truncated',
      error: 'That file ends inside a quoted field, which means the download was truncated. Re-export from TickTick and try again.',
    };
  }

  const headerRow = findHeaderRow(rows);
  if (headerRow < 0) {
    return {
      ok: false,
      code: 'not_ticktick',
      error: 'That does not look like a TickTick backup: no row with the “List Name” and “Title” columns was found.',
    };
  }

  const header = readHeader(rows[headerRow]!);
  const dataRows = rows.slice(headerRow + 1).filter((row) => row.some((value) => value.trim() !== ''));
  if (dataRows.length === 0) {
    return { ok: false, code: 'empty', error: 'That backup contains a header but no tasks.' };
  }
  if (dataRows.length > maxRows) {
    return {
      ok: false,
      code: 'too_large',
      error: `That backup has ${dataRows.length.toLocaleString()} rows; the limit is ${maxRows.toLocaleString()} tasks per import. Split the file and import it in parts.`,
    };
  }

  const issues: TickTickRowIssue[] = [];
  let issueCount = 0;
  const report = (issue: TickTickRowIssue) => {
    issueCount += 1;
    if (issues.length < MAX_ISSUES) issues.push(issue);
  };

  const records: RawRecord[] = [];
  const skippedRows: number[] = [];

  dataRows.forEach((row, index) => {
    const rowNumber = headerRow + index + 2; // 1-based record number in the file.
    const title = cell(row, header, 'title');
    if (!title) {
      skippedRows.push(rowNumber);
      report({ row: rowNumber, column: 'Title', value: null, message: 'Row has no title and was skipped.' });
      return;
    }

    const timezone = validZone(cell(row, header, 'timezone'));
    const isAllDay = isTruthy(cell(row, header, 'allDay'));
    const completedAtMs = mapTickTickInstant(cell(row, header, 'completedAt'), timezone);
    const createdAtMs = mapTickTickInstant(cell(row, header, 'createdAt'), timezone);

    const { priority, unexpected } = mapTickTickPriority(cell(row, header, 'priority'));
    if (unexpected) {
      report({
        row: rowNumber,
        column: 'Priority',
        value: cell(row, header, 'priority'),
        message: 'Unrecognised priority value; mapped by range.',
      });
    }
    const statusResult = mapTickTickStatus(cell(row, header, 'status'), completedAtMs);
    if (statusResult.unknown) {
      report({
        row: rowNumber,
        column: 'Status',
        value: cell(row, header, 'status'),
        message: 'Unrecognised status value; imported as not completed.',
      });
    }
    if (statusResult.conflict) {
      report({
        row: rowNumber,
        column: 'Status',
        value: cell(row, header, 'status'),
        message: 'A completion time is present but the status says the task is not completed; imported as not completed.',
      });
    }

    const dueText = cell(row, header, 'due');
    const due = mapTickTickDateTime(dueText, isAllDay);
    if (dueText && !due) {
      report({ row: rowNumber, column: 'Due Date', value: dueText, message: 'Unrecognised due date; left empty.' });
    }
    const startText = cell(row, header, 'start');
    const start = mapTickTickDateTime(startText, isAllDay);
    if (startText && !start) {
      report({ row: rowNumber, column: 'Start Date', value: startText, message: 'Unrecognised start date; left empty.' });
    }

    const repeatText = cell(row, header, 'repeat');
    const recurrenceRule = mapTickTickRecurrence(repeatText);
    if (repeatText && repeatText.trim() && !recurrenceRule) {
      report({
        row: rowNumber,
        column: 'Repeat',
        value: repeatText,
        message: 'Repeat rule is not an RRULE and was not imported.',
      });
    }

    const reminderResult = mapTickTickReminders(cell(row, header, 'reminder'));
    for (const part of reminderResult.unparsed) {
      report({
        row: rowNumber,
        column: 'Reminder',
        value: part,
        message: 'Reminder is not an ISO-8601 duration and was not imported.',
      });
    }

    const projectKind = cell(row, header, 'projectKind').toUpperCase();
    if (projectKind && projectKind !== 'TASK') {
      report({
        row: rowNumber,
        column: 'projectKind',
        value: projectKind,
        message: 'Non-task project imported as a task list.',
      });
    }

    const kind = cell(row, header, 'kind').toUpperCase();
    const isChecklist = isTruthy(cell(row, header, 'checkList')) || kind === 'CHECKLIST';
    if (kind && !['TEXT', 'NOTE', 'CHECKLIST', 'CHECK'].includes(kind)) {
      report({ row: rowNumber, column: 'Kind', value: kind, message: 'Unrecognised task kind.' });
    }
    // Real exports separate `Content` lines with a bare CR, not LF; normalise so
    // notes and checklist items read the same everywhere downstream.
    const content = cell(row, header, 'content').replace(/\r\n?/g, '\n');
    const checklist = isChecklist
      ? splitTickTickChecklist(content)
      : { notes: content || null, items: [], emptyItems: 0 };
    if (checklist.emptyItems > 0) {
      report({
        row: rowNumber,
        column: 'Content',
        value: null,
        message: `${checklist.emptyItems} empty checklist item(s) were ignored.`,
      });
    }

    const order = parseOrderKey(cell(row, header, 'order'));

    records.push({
      row: rowNumber,
      sortIndex: index,
      order,
      taskId: cell(row, header, 'taskId'),
      parentId: cell(row, header, 'parentId'),
      title,
      listName: cell(row, header, 'list') || 'Inbox',
      folder: cell(row, header, 'folder'),
      tags: mapTickTickTags(cell(row, header, 'tags')),
      notes: checklist.notes,
      checklist: checklist.items,
      status: statusResult.status,
      completedAtMs,
      createdAtMs,
      priority,
      due,
      start,
      timezone,
      recurrenceRule,
      reminders: reminderResult.offsetMinutes,
    });
  });

  /* ---- keys, parents and the two-level tree ---------------------------- */

  // Stable order: TickTick's own 64-bit order column (exact, via BigInt), then
  // file order. A row without an order sorts after the ones that have one.
  records.sort((a, b) => {
    if (a.order !== null && b.order !== null) {
      if (a.order < b.order) return -1;
      if (a.order > b.order) return 1;
    } else if (a.order === null && b.order !== null) {
      return 1;
    } else if (a.order !== null && b.order === null) {
      return -1;
    }
    return a.sortIndex - b.sortIndex;
  });

  const keyByRecord = new Map<RawRecord, string>();
  const usedKeys = new Set<string>();
  for (const record of records) {
    const base = record.taskId ? `task:${record.taskId}` : `row:${record.row}`;
    let key = base;
    let suffix = 2;
    while (usedKeys.has(key)) {
      key = `${base}#${suffix}`;
      suffix += 1;
    }
    if (key !== base) {
      report({ row: record.row, column: 'taskId', value: record.taskId, message: 'Duplicate task id; kept both rows.' });
    }
    usedKeys.add(key);
    keyByRecord.set(record, key);
  }

  const byTaskId = new Map<string, RawRecord>();
  for (const record of records) {
    if (record.taskId && !byTaskId.has(record.taskId)) byTaskId.set(record.taskId, record);
  }

  /** Resolves a child row to a *root* ancestor, flattening deeper nesting. */
  const parentKeyByRecord = new Map<RawRecord, string | null>();
  for (const record of records) {
    if (!record.parentId) {
      parentKeyByRecord.set(record, null);
      continue;
    }
    const parent = byTaskId.get(record.parentId);
    if (!parent || parent === record) {
      report({
        row: record.row,
        column: 'parentId',
        value: record.parentId,
        message: parent ? 'Row lists itself as its parent; imported as a top-level task.' : 'Parent task was not found; imported as a top-level task.',
      });
      parentKeyByRecord.set(record, null);
      continue;
    }

    // Walk up to the top-level ancestor, guarding against a cycle.
    let root = parent;
    const seen = new Set<RawRecord>([record]);
    let flattened = false;
    while (root.parentId) {
      if (seen.has(root)) break;
      seen.add(root);
      const next = byTaskId.get(root.parentId);
      if (!next) break;
      root = next;
      flattened = true;
    }
    if (flattened) {
      report({
        row: record.row,
        column: 'parentId',
        value: record.parentId,
        message: 'Nested more than one level deep; attached to the top-level task.',
      });
    }
    parentKeyByRecord.set(record, root === record ? null : keyByRecord.get(root) ?? null);
  }

  /* ---- lists ----------------------------------------------------------- */

  const listsByKey = new Map<string, TickTickListPlan>();
  for (const record of records) {
    const key = `list:${record.listName.trim().toLowerCase()}`;
    if (!listsByKey.has(key)) {
      listsByKey.set(key, { key, name: record.listName.trim() || 'Inbox', folder: record.folder || null });
    }
  }

  /* ---- plans ----------------------------------------------------------- */

  const tasks: TickTickTaskPlan[] = [];
  const listKeyFor = (record: RawRecord) => `list:${record.listName.trim().toLowerCase()}`;

  for (const record of records) {
    tasks.push({
      key: keyByRecord.get(record)!,
      parentKey: parentKeyByRecord.get(record) ?? null,
      listKey: listKeyFor(record),
      title: record.title,
      notes: record.notes,
      status: record.status,
      completedAtMs: record.completedAtMs,
      createdAtMs: record.createdAtMs,
      priority: record.priority,
      dueDate: record.due?.date ?? null,
      dueTime: record.due?.time ?? null,
      startDate: record.start?.date ?? null,
      startTime: record.start?.time ?? null,
      timezone: record.timezone,
      recurrenceRule: record.recurrenceRule,
      tags: record.tags,
      reminders: record.reminders,
    });
  }

  // Checklist items become subtasks, so their text survives as structure
  // rather than as opaque notes.
  let checklistItems = 0;
  for (const record of records) {
    const recordKey = keyByRecord.get(record)!;
    // A checklist on a subtask would be a third level, which the task UI does
    // not hydrate; its items are attached to the same top-level ancestor as the
    // task itself so they stay visible.
    const parentKey = parentKeyByRecord.get(record) ?? recordKey;
    record.checklist.forEach((item, i) => {
      checklistItems += 1;
      tasks.push({
        key: `${recordKey}#check:${i + 1}`,
        parentKey,
        listKey: listKeyFor(record),
        title: item.title,
        notes: null,
        status: item.completed ? 'completed' : 'todo',
        completedAtMs: null,
        createdAtMs: null,
        priority: 'none',
        dueDate: null,
        dueTime: null,
        startDate: null,
        startTime: null,
        timezone: record.timezone,
        recurrenceRule: null,
        tags: [],
        reminders: [],
      });
    });
  }

  /* ---- preview --------------------------------------------------------- */

  const topLevel = tasks.filter((task) => task.parentKey === null);
  const taskCountByList = new Map<string, number>();
  for (const task of topLevel) {
    taskCountByList.set(task.listKey, (taskCountByList.get(task.listKey) ?? 0) + 1);
  }

  const tagSet = new Set<string>();
  for (const task of tasks) for (const tag of task.tags) tagSet.add(tag);
  const tags = [...tagSet].sort((a, b) => a.localeCompare(b));

  const unmappedColumns = header.cells
    .filter((cellText) => {
      const name = canonical(cellText);
      return name !== '' && !ALIAS_TO_COLUMN.has(name);
    })
    .filter((value, i, all) => all.indexOf(value) === i);

  const preview: TickTickPreview = {
    fileName,
    dataRows: dataRows.length,
    tasks: topLevel.length,
    subtasks: tasks.length - topLevel.length,
    lists: [...listsByKey.values()].map((list) => ({
      name: list.name,
      folder: list.folder,
      tasks: taskCountByList.get(list.key) ?? 0,
    })),
    tags,
    completed: tasks.filter((task) => task.status === 'completed').length,
    recurring: tasks.filter((task) => task.recurrenceRule !== null).length,
    reminders: tasks.reduce((sum, task) => sum + task.reminders.length, 0),
    wontDo: tasks.filter((task) => task.status === 'wont_do').length,
    skippedRows: skippedRows.length,
    unmappedColumns,
    issues,
    issueCount,
  };

  return { ok: true, plan: { lists: [...listsByKey.values()], tasks, preview } };
}
