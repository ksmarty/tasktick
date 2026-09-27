/**
 * Period tracking — CSV template, export and import.
 *
 * ## Why this does not contain a parser
 *
 * `src/lib/csv.ts` already holds a hand-written RFC 4180 reader, and
 * `src/lib/ticktick-import.ts` already encodes the hard-won lessons about real
 * files. This module reuses both rather than growing a third parser:
 *
 *  - **A byte-order mark** at the start is stripped by `parseCsv` (Excel writes
 *    one, and it would otherwise become part of the first header cell).
 *  - **A bare CR inside a quoted field** is kept literally. Real exports use CR
 *    as a line separator *inside* a cell, and a reader that treats it as a row
 *    break shreds the file. `parseCsv` handles it; this module's own escaping
 *    quotes any field containing CR, LF, a quote or a comma.
 *  - **The header is not assumed to be line 1.** It is located by the columns it
 *    carries, exactly as the TickTick importer does, so a template with comment
 *    lines — or a file a user pasted a title above — still reads.
 *  - **Column counts vary.** A short row yields empty strings for the missing
 *    cells; a long row's extras are ignored.
 *
 * ## The round trip
 *
 * The template is downloadable and is *valid input to the importer unchanged*.
 * Its explanatory and example lines all begin with `#`, which the importer
 * ignores, so importing an untouched template succeeds and writes nothing
 * rather than importing an example as if it were the user's history. Filling the
 * template in means adding rows (or un-commenting the examples), and
 * {@link serialisePeriodCsv} emits the same column set, so an export re-imports
 * to the same data.
 *
 * ## Row-level errors, never a rejected file
 *
 * A person importing five years of history must not lose it to one bad row. A
 * structurally unusable row (no date, an unknown `kind`) is skipped and reported
 * against its 1-based record number; a single bad *field* on an otherwise good
 * row is reported and set to empty, and the rest of the row is kept.
 */

import { isValidDateOnly } from './dates';
import { parseCsv } from './csv';
import {
  CERVICAL_MUCUS_TYPES,
  CONTRACEPTION_DAY_STATUSES,
  CONTRACEPTION_METHODS,
  LH_TEST_RESULTS,
  PERIOD_FLOW_LEVELS,
  type CervicalMucus,
  type ContraceptionDayStatus,
  type ContraceptionMethod,
  type ContraceptionMethodInput,
  type ContraceptionSchedule,
  type LhTestResult,
  type PeriodCycleInput,
  type PeriodDayLogInput,
  type PeriodFlow,
  type PeriodImportIssue,
  type PeriodImportPreview,
} from './period-types';
import type { DateOnly } from './types';

/* -------------------------------------------------------------------------- */
/* the column set                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The canonical header. `kind` decides which other columns matter, so one file
 * carries cycles, day observations, methods and daily method logs. Exporting in
 * the same shape is what makes the round trip exact.
 */
export const PERIOD_CSV_COLUMNS = [
  'kind',
  'date',
  'endDate',
  'flow',
  'status',
  'symptoms',
  'mood',
  'temperatureC',
  'lhTest',
  'mucus',
  'intimacy',
  'ovulationPain',
  'weightKg',
  'method',
  'label',
  'onDays',
  'offDays',
  'notes',
] as const;

export type PeriodCsvColumn = (typeof PERIOD_CSV_COLUMNS)[number];

/** Row kinds. `cycle` uses `date`/`endDate`; `day` is one calendar day. */
export type PeriodCsvKind = 'cycle' | 'day' | 'contraception' | 'contraception-day';

const KIND_ALIASES: Record<string, PeriodCsvKind> = {
  cycle: 'cycle',
  period: 'cycle',
  menstruation: 'cycle',
  day: 'day',
  log: 'day',
  daily: 'day',
  observation: 'day',
  contraception: 'contraception',
  'birth-control': 'contraception',
  birthcontrol: 'contraception',
  method: 'contraception',
  'contraception-day': 'contraception-day',
  contraception_day: 'contraception-day',
  contraceptionday: 'contraception-day',
  bcday: 'contraception-day',
};

/** Accepted header spellings, canonicalised (case/space-insensitive). */
const COLUMN_ALIASES: Record<PeriodCsvColumn, string[]> = {
  kind: ['kind', 'type', 'record'],
  date: ['date', 'startdate', 'start', 'day'],
  endDate: ['enddate', 'end'],
  flow: ['flow', 'bleeding', 'flowintensity'],
  status: ['status', 'taken', 'pillstatus'],
  symptoms: ['symptoms', 'symptom'],
  mood: ['mood', 'moods'],
  temperatureC: ['temperaturec', 'temperature', 'temp', 'bbt'],
  lhTest: ['lhtest', 'lh', 'opk'],
  mucus: ['mucus', 'cervicalmucus', 'cm'],
  intimacy: ['intimacy', 'sex', 'intercourse'],
  ovulationPain: ['ovulationpain', 'mittelschmerz', 'pain'],
  weightKg: ['weightkg', 'weight'],
  method: ['method', 'contraception', 'birthcontrol'],
  label: ['label', 'brand'],
  onDays: ['ondays', 'activedays'],
  offDays: ['offdays', 'gapdays', 'placebodays'],
  notes: ['notes', 'note', 'comment'],
};

const ALIAS_TO_COLUMN = new Map<string, PeriodCsvColumn>();
for (const column of PERIOD_CSV_COLUMNS) {
  for (const alias of COLUMN_ALIASES[column]) ALIAS_TO_COLUMN.set(alias, column);
}

/**
 * Hard cap on data rows. Five years of daily logs is ~1,800 rows; 20,000 leaves
 * room for a decade plus cycles and methods, and turns a hostile file into an
 * immediate error rather than a request that hangs.
 */
export const MAX_PERIOD_IMPORT_ROWS = 20_000;

/* -------------------------------------------------------------------------- */
/* plan shapes                                                                */
/* -------------------------------------------------------------------------- */

export interface PeriodCsvCycleRow extends PeriodCycleInput {
  row: number;
}

export interface PeriodCsvDayRow extends PeriodDayLogInput {
  row: number;
}

export interface PeriodCsvMethodRow extends ContraceptionMethodInput {
  row: number;
}

/**
 * A logged method day. It carries the method's *name* rather than an id because
 * a CSV cannot know our ids; the service resolves the name to the method that
 * was active on that date.
 */
export interface PeriodCsvContraceptionDayRow {
  row: number;
  date: DateOnly;
  method: ContraceptionMethod;
  label: string | null;
  status: ContraceptionDayStatus;
  notes: string | null;
}

export interface PeriodCsvPlan {
  cycles: PeriodCsvCycleRow[];
  days: PeriodCsvDayRow[];
  methods: PeriodCsvMethodRow[];
  contraceptionDays: PeriodCsvContraceptionDayRow[];
}

export type PeriodCsvParseResult =
  | { ok: true; plan: PeriodCsvPlan; preview: PeriodImportPreview }
  | { ok: false; code: 'empty' | 'not_period_csv' | 'truncated' | 'too_large'; error: string };

/* -------------------------------------------------------------------------- */
/* writing                                                                    */
/* -------------------------------------------------------------------------- */

/** RFC 4180 field: quote when the value contains a delimiter, quote or newline. */
export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(cells: (string | number | boolean | null | undefined)[]): string {
  return cells.map(csvCell).join(',');
}

/**
 * The downloadable template.
 *
 * Every line other than the header is a comment (`#`), including the three
 * worked examples — so the untouched template imports cleanly and writes
 * nothing, and the examples are still visible to copy.
 */
export function buildPeriodTemplateCsv(): string {
  const header = csvRow([...PERIOD_CSV_COLUMNS]);
  const lines = [
    '# TaskTick period tracking import template.',
    '#',
    '# How to use it:',
    '#   1. Add one row per record below the header. Delete the example lines or',
    '#      un-comment them. Lines beginning with # and blank lines are ignored.',
    '#   2. Dates are YYYY-MM-DD. Do not change the header names.',
    '#   3. kind decides which columns matter:',
    '#        cycle             -> date = period start, endDate = last bleeding day',
    '#        day               -> observations for a single date',
    '#        contraception     -> date = method start, endDate = last day (blank = still using)',
    '#        contraception-day -> date + method + status (taken/missed/on/off)',
    '#   4. Lists (symptoms, mood) are separated by commas, semicolons or pipes.',
    `#   5. flow: ${PERIOD_FLOW_LEVELS.join(' | ')}`,
    `#      lhTest: ${LH_TEST_RESULTS.join(' | ')}`,
    `#      mucus: ${CERVICAL_MUCUS_TYPES.join(' | ')}`,
    `#      method: ${CONTRACEPTION_METHODS.join(' | ')}`,
    `#      status: ${CONTRACEPTION_DAY_STATUSES.join(' | ')}`,
    '#',
    '# Examples (kept as comments so importing an untouched template changes nothing):',
    '# ' +
      csvRow([
        'cycle',
        '2026-01-03',
        '2026-01-07',
        'medium',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        'first cycle in this import',
      ]),
    '# ' +
      csvRow([
        'day',
        '2026-01-14',
        '',
        'spotting',
        '',
        'cramps,headache',
        'calm',
        '36.41',
        'negative',
        'creamy',
        'false',
        'false',
        '61.5',
        '',
        '',
        '',
        '',
        'temp taken on waking',
      ]),
    '# ' +
      csvRow([
        'contraception',
        '2026-01-03',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        'ring',
        'Nuvaring',
        '21',
        '7',
        'three weeks in, one week out',
      ]),
    '# ' + csvRow(['contraception-day', '2026-01-10', '', '', 'taken', '', '', '', '', '', '', '', '', 'pill', '', '', '', '']),
    '',
    header,
  ];
  return lines.join('\r\n') + '\r\n';
}

export interface PeriodCsvExportInput {
  cycles: PeriodCycleInput[];
  days: PeriodDayLogInput[];
  methods: ContraceptionMethodInput[];
  contraceptionDays: {
    date: DateOnly;
    method: ContraceptionMethod;
    label: string | null;
    status: ContraceptionDayStatus;
    notes: string | null;
  }[];
}

/** Serialises existing data to the same shape the importer reads. */
export function serialisePeriodCsv(input: PeriodCsvExportInput): string {
  const rows: string[] = [csvRow([...PERIOD_CSV_COLUMNS])];

  for (const cycle of input.cycles) {
    rows.push(
      csvRow([
        'cycle',
        cycle.startDate,
        cycle.endDate ?? '',
        cycle.flowIntensity ?? '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        cycle.notes ?? '',
      ]),
    );
  }

  for (const day of input.days) {
    rows.push(
      csvRow([
        'day',
        day.date,
        '',
        day.flow ?? '',
        '',
        (day.symptoms ?? []).join('; '),
        (day.mood ?? []).join('; '),
        day.temperatureC ?? '',
        day.lhTest ?? '',
        day.mucus ?? '',
        day.intimacy ? 'true' : 'false',
        day.ovulationPain ? 'true' : 'false',
        day.weightKg ?? '',
        '',
        '',
        '',
        '',
        day.notes ?? '',
      ]),
    );
  }

  for (const method of input.methods) {
    rows.push(
      csvRow([
        'contraception',
        method.startDate,
        method.endDate ?? '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        method.method,
        method.label ?? '',
        method.schedule?.onDays ?? '',
        method.schedule?.offDays ?? '',
        method.notes ?? '',
      ]),
    );
  }

  for (const day of input.contraceptionDays) {
    rows.push(
      csvRow([
        'contraception-day',
        day.date,
        '',
        '',
        day.status,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        day.method,
        day.label ?? '',
        '',
        '',
        day.notes ?? '',
      ]),
    );
  }

  return rows.join('\r\n') + '\r\n';
}

/* -------------------------------------------------------------------------- */
/* reading                                                                    */
/* -------------------------------------------------------------------------- */

function canonical(value: string): string {
  return value.replace(/\u00a0/g, ' ').trim().replace(/\s+/g, '').toLowerCase();
}

interface Header {
  index: Map<PeriodCsvColumn, number>;
}

function readHeader(cells: string[]): Header {
  const index = new Map<PeriodCsvColumn, number>();
  cells.forEach((cell, i) => {
    const column = ALIAS_TO_COLUMN.get(canonical(cell));
    if (column && !index.has(column)) index.set(column, i);
  });
  return { index };
}

/** Locates the header by the columns it carries, never by a fixed line number. */
function findHeaderRow(rows: string[][]): number {
  return rows.findIndex((row) => {
    if (row.length < 2) return false;
    const header = readHeader(row);
    return header.index.has('date') && header.index.size >= 2;
  });
}

function cell(row: string[], header: Header, column: PeriodCsvColumn): string {
  const i = header.index.get(column);
  if (i === undefined) return '';
  return (row[i] ?? '').trim();
}

const TRUE_VALUES = ['true', 't', '1', 'y', 'yes', 'on', 'x'];
const FALSE_VALUES = ['false', 'f', '0', 'n', 'no', 'off', ''];

function oneOf<T extends string>(value: string, allowed: readonly T[]): T | null {
  const wanted = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return (allowed as readonly string[]).includes(wanted) ? (wanted as T) : null;
}

/** Splits a multi-value cell on commas, semicolons or pipes, de-duplicated. */
export function parsePeriodList(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of value.split(/[,;|]/)) {
    const tag = part.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag.slice(0, 60));
    if (out.length >= 50) break;
  }
  return out;
}

interface Ctx {
  issues: PeriodImportIssue[];
  issueCount: number;
  report: (issue: PeriodImportIssue) => void;
}

function parseNumberField(
  raw: string,
  ctx: Ctx,
  row: number,
  column: string,
  min: number,
  max: number,
  label: string,
): number | null {
  if (!raw) return null;
  const value = Number(raw.replace(',', '.'));
  if (!Number.isFinite(value)) {
    ctx.report({ row, column, value: raw, message: `“${raw}” is not a number; ${label} left empty.` });
    return null;
  }
  if (value < min || value > max) {
    ctx.report({ row, column, value: raw, message: `${label} ${value} is outside the plausible range ${min}–${max}; left empty.` });
    return null;
  }
  return value;
}

function parseBooleanField(raw: string, ctx: Ctx, row: number, column: string, label: string): boolean {
  if (raw === '') return false;
  const value = raw.trim().toLowerCase();
  if (TRUE_VALUES.includes(value)) return true;
  if (FALSE_VALUES.includes(value)) return false;
  ctx.report({ row, column, value: raw, message: `“${raw}” is not a yes/no value; ${label} read as no.` });
  return false;
}

/**
 * Parses a period CSV into an inert plan. Performs no database access, so the
 * same call backs both the preview and the commit.
 */
export function parsePeriodCsv(text: string, options: { fileName?: string } = {}): PeriodCsvParseResult {
  const fileName = options.fileName ?? 'period.csv';
  const { rows, unclosedQuote, rowCount } = parseCsv(text);

  if (rowCount === 0) return { ok: false, code: 'empty', error: 'That file is empty.' };
  if (unclosedQuote) {
    return {
      ok: false,
      code: 'truncated',
      error: 'That file ends inside a quoted field, so the download looks truncated. Re-export it and try again.',
    };
  }

  const headerRow = findHeaderRow(rows);
  if (headerRow < 0) {
    return {
      ok: false,
      code: 'not_period_csv',
      error: 'That does not look like a period import: no header row with a “date” column was found.',
    };
  }

  const header = readHeader(rows[headerRow]!);

  const issues: PeriodImportIssue[] = [];
  let issueCount = 0;
  const ctx: Ctx = {
    issues,
    issueCount: 0,
    report: (issue) => {
      issueCount += 1;
      if (issues.length < 100) issues.push(issue);
    },
  };

  const plan: PeriodCsvPlan = { cycles: [], days: [], methods: [], contraceptionDays: [] };
  const notes: string[] = [];
  let dataRows = 0;

  const body = rows.slice(headerRow + 1);
  for (let i = 0; i < body.length; i++) {
    const row = body[i]!;
    const rowNumber = headerRow + i + 2; // 1-based record number in the file.
    if (row.every((value) => value.trim() === '')) continue;
    // A comment row is skipped, not an error: the template's examples are comments.
    if ((row[0] ?? '').trimStart().startsWith('#')) continue;
    dataRows += 1;

    if (dataRows > MAX_PERIOD_IMPORT_ROWS) {
      return {
        ok: false,
        code: 'too_large',
        error: `That file has more than ${MAX_PERIOD_IMPORT_ROWS.toLocaleString()} data rows. Split it and import it in parts.`,
      };
    }

    const rawKind = canonical(cell(row, header, 'kind'));
    const kind: PeriodCsvKind | null = rawKind === '' ? null : (KIND_ALIASES[rawKind] ?? null);
    const rawDate = cell(row, header, 'date');
    const rawEndDate = cell(row, header, 'endDate');

    if (rawKind !== '' && kind === null) {
      ctx.report({ row: rowNumber, column: 'kind', value: cell(row, header, 'kind'), message: 'Unknown kind; row skipped.' });
      continue;
    }
    if (!rawDate) {
      ctx.report({ row: rowNumber, column: 'date', value: null, message: 'Row has no date; row skipped.' });
      continue;
    }
    if (!isValidDateOnly(rawDate)) {
      ctx.report({ row: rowNumber, column: 'date', value: rawDate, message: `“${rawDate}” is not a date; row skipped.` });
      continue;
    }
    // No `kind` with an end date present is a cycle; otherwise a day log.
    const resolvedKind: PeriodCsvKind = kind ?? (rawEndDate ? 'cycle' : 'day');

    if (resolvedKind === 'cycle') {
      let endDate: DateOnly | null = null;
      if (rawEndDate) {
        if (!isValidDateOnly(rawEndDate)) {
          ctx.report({ row: rowNumber, column: 'endDate', value: rawEndDate, message: `“${rawEndDate}” is not a date; end left empty.` });
        } else if (rawEndDate < rawDate) {
          ctx.report({ row: rowNumber, column: 'endDate', value: rawEndDate, message: 'Period end is before its start; end left empty.' });
        } else {
          endDate = rawEndDate;
        }
      }
      const rawFlow = cell(row, header, 'flow');
      const flow = rawFlow ? oneOf(rawFlow, PERIOD_FLOW_LEVELS) : null;
      if (rawFlow && !flow) {
        ctx.report({ row: rowNumber, column: 'flow', value: rawFlow, message: 'Unrecognised flow value; using “medium”.' });
      }
      plan.cycles.push({
        row: rowNumber,
        startDate: rawDate,
        endDate,
        flowIntensity: flow ?? 'medium',
        notes: cell(row, header, 'notes') || null,
      });
      continue;
    }

    if (resolvedKind === 'day') {
      const rawFlow = cell(row, header, 'flow');
      const flow = rawFlow ? oneOf(rawFlow, PERIOD_FLOW_LEVELS) : null;
      if (rawFlow && !flow) {
        ctx.report({ row: rowNumber, column: 'flow', value: rawFlow, message: 'Unrecognised flow value; left empty.' });
      }
      const rawLh = cell(row, header, 'lhTest');
      const lhTest = rawLh ? oneOf(rawLh, LH_TEST_RESULTS) : null;
      if (rawLh && !lhTest) {
        ctx.report({ row: rowNumber, column: 'lhTest', value: rawLh, message: 'Unrecognised LH result; left empty.' });
      }
      const rawMucus = cell(row, header, 'mucus');
      const mucus = rawMucus ? oneOf(rawMucus, CERVICAL_MUCUS_TYPES) : null;
      if (rawMucus && !mucus) {
        ctx.report({ row: rowNumber, column: 'mucus', value: rawMucus, message: 'Unrecognised mucus value; left empty.' });
      }
      const symptoms = parsePeriodList(cell(row, header, 'symptoms'));
      const mood = parsePeriodList(cell(row, header, 'mood'));
      plan.days.push({
        row: rowNumber,
        date: rawDate,
        flow,
        symptoms: symptoms.length ? symptoms : null,
        mood: mood.length ? mood : null,
        temperatureC: parseNumberField(cell(row, header, 'temperatureC'), ctx, rowNumber, 'temperatureC', 25, 45, 'Temperature'),
        lhTest,
        mucus,
        intimacy: parseBooleanField(cell(row, header, 'intimacy'), ctx, rowNumber, 'intimacy', 'Intimacy'),
        ovulationPain: parseBooleanField(cell(row, header, 'ovulationPain'), ctx, rowNumber, 'ovulationPain', 'Ovulation pain'),
        weightKg: parseNumberField(cell(row, header, 'weightKg'), ctx, rowNumber, 'weightKg', 20, 500, 'Weight'),
        notes: cell(row, header, 'notes') || null,
      });
      continue;
    }

    if (resolvedKind === 'contraception') {
      const rawMethod = cell(row, header, 'method');
      const method = rawMethod ? oneOf(rawMethod, CONTRACEPTION_METHODS) : null;
      if (!method) {
        ctx.report({
          row: rowNumber,
          column: 'method',
          value: rawMethod || null,
          message: rawMethod ? `Unrecognised method “${rawMethod}”; row skipped.` : 'Row has no method; row skipped.',
        });
        continue;
      }
      let endDate: DateOnly | null = null;
      if (rawEndDate) {
        if (!isValidDateOnly(rawEndDate)) {
          ctx.report({ row: rowNumber, column: 'endDate', value: rawEndDate, message: `“${rawEndDate}” is not a date; method left open.` });
        } else if (rawEndDate < rawDate) {
          ctx.report({ row: rowNumber, column: 'endDate', value: rawEndDate, message: 'Method end is before its start; left open.' });
        } else {
          endDate = rawEndDate;
        }
      }
      const onDays = parseNumberField(cell(row, header, 'onDays'), ctx, rowNumber, 'onDays', 1, 365, 'onDays');
      const offDays = parseNumberField(cell(row, header, 'offDays'), ctx, rowNumber, 'offDays', 0, 365, 'offDays');
      let schedule: ContraceptionSchedule | null = null;
      if (onDays !== null && offDays !== null) schedule = { onDays, offDays };
      else if (onDays !== null || offDays !== null) {
        ctx.report({
          row: rowNumber,
          column: onDays === null ? 'onDays' : 'offDays',
          value: null,
          message: 'A schedule needs both onDays and offDays; schedule left empty.',
        });
      }
      plan.methods.push({
        row: rowNumber,
        method,
        label: cell(row, header, 'label') || null,
        startDate: rawDate,
        endDate,
        schedule,
        notes: cell(row, header, 'notes') || null,
      });
      continue;
    }

    // contraception-day
    const rawMethod = cell(row, header, 'method');
    const method = rawMethod ? oneOf(rawMethod, CONTRACEPTION_METHODS) : null;
    if (!method) {
      ctx.report({
        row: rowNumber,
        column: 'method',
        value: rawMethod || null,
        message: 'A contraception-day row needs the method it belongs to; row skipped.',
      });
      continue;
    }
    const rawStatus = cell(row, header, 'status');
    const status = oneOf(rawStatus, CONTRACEPTION_DAY_STATUSES);
    if (!status) {
      ctx.report({
        row: rowNumber,
        column: 'status',
        value: rawStatus || null,
        message: rawStatus ? `Unrecognised status “${rawStatus}”; row skipped.` : 'Row has no status; row skipped.',
      });
      continue;
    }
    plan.contraceptionDays.push({
      row: rowNumber,
      date: rawDate,
      method,
      label: cell(row, header, 'label') || null,
      status,
      notes: cell(row, header, 'notes') || null,
    });
  }

  if (dataRows === 0) {
    notes.push('The file contained no data rows — only the header and comments.');
  }

  return {
    ok: true,
    plan,
    preview: {
      fileName,
      dataRows,
      cycles: plan.cycles.length,
      days: plan.days.length,
      methods: plan.methods.length,
      contraceptionDays: plan.contraceptionDays.length,
      issues,
      issueCount,
      notes,
    },
  };
}
