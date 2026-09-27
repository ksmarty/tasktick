/**
 * CSV template, export and import.
 *
 * The point of these tests is the round trip: the template must be importable
 * unchanged, a filled-in template must produce exactly the rows that were
 * written, and one bad row must not cost the user the other five years.
 */
import { describe, expect, it } from 'vitest';
import {
  buildPeriodTemplateCsv,
  csvCell,
  parsePeriodCsv,
  PERIOD_CSV_COLUMNS,
  serialisePeriodCsv,
} from '@/lib/period-csv';

const EMPTY = {
  kind: '',
  date: '',
  endDate: '',
  flow: '',
  status: '',
  symptoms: '',
  mood: '',
  temperatureC: '',
  lhTest: '',
  mucus: '',
  intimacy: '',
  ovulationPain: '',
  weightKg: '',
  method: '',
  label: '',
  onDays: '',
  offDays: '',
  notes: '',
} as Record<string, string>;

/** Builds one row in canonical column order, filling unspecified cells blank. */
function row(values: Partial<typeof EMPTY>): string {
  const merged = { ...EMPTY, ...values };
  return PERIOD_CSV_COLUMNS.map((column) => csvCell(merged[column])).join(',');
}

const FILLED_ROWS = [
  row({ kind: 'cycle', date: '2026-01-03', endDate: '2026-01-07', flow: 'medium', notes: 'first cycle in this import' }),
  row({
    kind: 'day',
    date: '2026-01-14',
    flow: 'spotting',
    symptoms: 'cramps, headache',
    mood: 'calm',
    temperatureC: '36.41',
    lhTest: 'negative',
    mucus: 'creamy',
    intimacy: 'false',
    ovulationPain: 'false',
    weightKg: '61.5',
    notes: 'temp taken on waking',
  }),
  row({
    kind: 'contraception',
    date: '2026-01-03',
    method: 'ring',
    label: 'Nuvaring',
    onDays: '21',
    offDays: '7',
    notes: 'three weeks in, one week out',
  }),
  row({ kind: 'contraception-day', date: '2026-01-10', status: 'taken', method: 'ring' }),
];

describe('the template', () => {
  it('imports unchanged without writing an example row', () => {
    const result = parsePeriodCsv(buildPeriodTemplateCsv(), { fileName: 'tasktick-period-template.csv' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.dataRows).toBe(0);
    expect(result.plan.cycles).toEqual([]);
    expect(result.plan.days).toEqual([]);
    expect(result.plan.methods).toEqual([]);
    expect(result.preview.issueCount).toBe(0);
    expect(result.preview.notes.join(' ')).toMatch(/no data rows/i);
  });

  it('exports a header that is exactly the columns the importer reads', () => {
    const [headerLine] = buildPeriodTemplateCsv().trimEnd().split('\r\n').slice(-1);
    expect(headerLine).toBe(PERIOD_CSV_COLUMNS.join(','));
  });

  it('fills in and imports to the data that was written', () => {
    const filled = `${buildPeriodTemplateCsv()}${FILLED_ROWS.join('\r\n')}\r\n`;
    const result = parsePeriodCsv(filled);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.preview.dataRows).toBe(4);
    expect(result.preview.cycles).toBe(1);
    expect(result.preview.days).toBe(1);
    expect(result.preview.methods).toBe(1);
    expect(result.preview.contraceptionDays).toBe(1);
    expect(result.preview.issueCount).toBe(0);

    expect(result.plan.cycles[0]).toMatchObject({
      startDate: '2026-01-03',
      endDate: '2026-01-07',
      flowIntensity: 'medium',
      notes: 'first cycle in this import',
    });
    expect(result.plan.days[0]).toMatchObject({
      date: '2026-01-14',
      flow: 'spotting',
      symptoms: ['cramps', 'headache'],
      mood: ['calm'],
      temperatureC: 36.41,
      lhTest: 'negative',
      mucus: 'creamy',
      intimacy: false,
      ovulationPain: false,
      weightKg: 61.5,
      notes: 'temp taken on waking',
    });
    expect(result.plan.methods[0]).toMatchObject({
      method: 'ring',
      label: 'Nuvaring',
      startDate: '2026-01-03',
      schedule: { onDays: 21, offDays: 7 },
    });
    expect(result.plan.contraceptionDays[0]).toMatchObject({
      date: '2026-01-10',
      method: 'ring',
      status: 'taken',
    });
  });
});

describe('export round-trips through import', () => {
  it('re-imports exactly what was exported', () => {
    const exported = serialisePeriodCsv({
      cycles: [{ startDate: '2026-01-03', endDate: '2026-01-07', flowIntensity: 'heavy', notes: 'note, with comma' }],
      days: [
        {
          date: '2026-01-14',
          flow: 'light',
          symptoms: ['cramps', 'bloating'],
          mood: ['low'],
          temperatureC: 36.6,
          lhTest: 'positive',
          mucus: 'egg_white',
          intimacy: true,
          ovulationPain: true,
          weightKg: 62,
          notes: 'multi\nline note',
        },
      ],
      methods: [{ method: 'patch', label: 'Evra', startDate: '2026-01-03', schedule: { onDays: 21, offDays: 7 } }],
      contraceptionDays: [{ date: '2026-01-10', method: 'patch', label: 'Evra', status: 'missed', notes: null }],
    });

    const result = parsePeriodCsv(exported);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.preview.issueCount).toBe(0);
    expect(result.plan.cycles[0]).toMatchObject({
      startDate: '2026-01-03',
      endDate: '2026-01-07',
      flowIntensity: 'heavy',
      notes: 'note, with comma',
    });
    expect(result.plan.days[0]).toMatchObject({
      date: '2026-01-14',
      flow: 'light',
      symptoms: ['cramps', 'bloating'],
      mood: ['low'],
      temperatureC: 36.6,
      lhTest: 'positive',
      mucus: 'egg_white',
      intimacy: true,
      ovulationPain: true,
      weightKg: 62,
      notes: 'multi\nline note',
    });
    expect(result.plan.methods[0]).toMatchObject({
      method: 'patch',
      label: 'Evra',
      schedule: { onDays: 21, offDays: 7 },
    });
    expect(result.plan.contraceptionDays[0]).toMatchObject({ date: '2026-01-10', method: 'patch', status: 'missed' });
  });
});

describe('messy real files', () => {
  it('finds the header below comments, strips a BOM and keeps a bare CR in a quoted field', () => {
    const text =
      '\ufeff# TaskTick period export\r\n' +
      '# generated 2026-02-01\r\n' +
      'date,kind,flow,notes\r\n' +
      '2026-01-01,cycle,medium,"line one\rline two"\r\n' +
      '2026-01-02,day\r\n'; // short row: missing columns must not break it

    const result = parsePeriodCsv(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.preview.dataRows).toBe(2);
    expect(result.plan.cycles[0]).toMatchObject({ startDate: '2026-01-01', flowIntensity: 'medium', notes: 'line one\rline two' });
    expect(result.plan.days[0]).toMatchObject({ date: '2026-01-02', flow: null, symptoms: null });
  });

  it('rejects a file that is not a period CSV', () => {
    const result = parsePeriodCsv('name,colour\nblue,red\n');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('not_period_csv');
  });

  it('rejects a truncated file rather than importing half a row', () => {
    const result = parsePeriodCsv('date,kind\n2026-01-01,cycle\n"unclosed\n');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('truncated');
  });
});

describe('row-level errors never cost the good rows', () => {
  it('skips a bad date, keeps the cycles either side of it', () => {
    const text = [
      'kind,date,endDate,flow',
      row({ kind: 'cycle', date: '2026-01-03' }),
      row({ kind: 'cycle', date: 'not-a-date' }),
      row({ kind: 'cycle', date: '2026-03-02' }),
    ].join('\n');

    const result = parsePeriodCsv(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.preview.dataRows).toBe(3);
    expect(result.plan.cycles.map((cycle) => cycle.startDate)).toEqual(['2026-01-03', '2026-03-02']);
    expect(result.preview.issueCount).toBe(1);
    // The header is record 1, so the bad date is record 3.
    expect(result.preview.issues[0]).toMatchObject({ row: 3, column: 'date', value: 'not-a-date' });
  });

  it('keeps a row when only an optional field is unusable, reported against the row', () => {
    const text = [
      PERIOD_CSV_COLUMNS.join(','),
      row({ kind: 'day', date: '2026-01-14', temperatureC: '99', lhTest: 'maybe' }),
    ].join('\n');

    const result = parsePeriodCsv(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.days).toHaveLength(1);
    expect(result.plan.days[0]).toMatchObject({ date: '2026-01-14', temperatureC: null, lhTest: null });
    expect(result.preview.issueCount).toBe(2);
    const columns = result.preview.issues.map((issue) => issue.column).sort();
    expect(columns).toEqual(['lhTest', 'temperatureC']);
  });

  it('skips an unknown kind and says which kind it was', () => {
    const text = ['kind,date', row({ kind: 'weather', date: '2026-01-01' })].join('\n');
    const result = parsePeriodCsv(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.cycles).toEqual([]);
    expect(result.plan.days).toEqual([]);
    expect(result.preview.issues[0]).toMatchObject({ column: 'kind', value: 'weather', row: 2 });
  });

  it('infers a cycle when kind is blank but an end date is present', () => {
    const text = [PERIOD_CSV_COLUMNS.join(','), row({ date: '2026-01-03', endDate: '2026-01-07' })].join('\n');
    const result = parsePeriodCsv(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.cycles[0]).toMatchObject({ startDate: '2026-01-03', endDate: '2026-01-07' });
  });

  it('reports an end date before its start and keeps the cycle', () => {
    const text = ['kind,date,endDate', row({ kind: 'cycle', date: '2026-01-03', endDate: '2026-01-01' })].join('\n');
    const result = parsePeriodCsv(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.cycles[0]).toMatchObject({ startDate: '2026-01-03', endDate: null });
    expect(result.preview.issues[0].message).toMatch(/before its start/i);
  });
});
