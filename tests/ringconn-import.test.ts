/**
 * Wearable import — the parsers.
 *
 * The point of these tests is not that a happy path parses. It is that a *real*
 * file parses: an Apple Health `export.xml` with records of half a dozen types, a
 * source that wrote data and no temperature, individual records that are garbage,
 * and the same bytes arriving in chunks that split a tag down the middle. Each of
 * those is a thing that happens to somebody's export, and each of them has to leave
 * the good records untouched.
 */
import { describe, expect, it } from 'vitest';
import {
  AppleHealthXmlReader,
  celsiusFrom,
  explainEmptyImport,
  kilogramsFrom,
  looksLikeRingConnExport,
  parseWearableStream,
  parseWearableText,
  temperatureScale,
  type WearableImportPlan,
} from '@/lib/ringconn';

/* -------------------------------------------------------------------------- */
/* fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const WRIST = 'HKQuantityTypeIdentifierAppleSleepingWristTemperature';
const BASAL = 'HKQuantityTypeIdentifierBasalBodyTemperature';
const BODY = 'HKQuantityTypeIdentifierBodyTemperature';
const MASS = 'HKQuantityTypeIdentifierBodyMass';
const SLEEP = 'HKCategoryTypeIdentifierSleepAnalysis';
const RESTING_HR = 'HKQuantityTypeIdentifierRestingHeartRate';
const HEART_RATE = 'HKQuantityTypeIdentifierHeartRate';
const STEPS = 'HKQuantityTypeIdentifierStepCount';

function record(attrs: Record<string, string>): string {
  return `<Record ${Object.entries(attrs)
    .map(([key, value]) => `${key}="${value}"`)
    .join(' ')}/>`;
}

function healthXml(records: string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE HealthData [',
    '<!ELEMENT HealthData (ExportDate,Me,(Record|Correlation|Workout|ActivitySummary|ClinicalRecord)*)>',
    ']>',
    '<HealthData locale="en_GB">',
    ' <ExportDate value="2026-09-27 12:00:00 +0100"/>',
    ' <Me HKCharacteristicTypeIdentifierDateOfBirth="1990-01-01" HKCharacteristicTypeIdentifierBiologicalSex="HKBiologicalSexFemale"/>',
    ...records.map((line) => ` ${line}`),
    '</HealthData>',
  ].join('\n');
}

/** A temperature record with everything an export always carries. */
function temperature(
  type: string,
  start: string,
  value: string,
  options: { unit?: string; source?: string } = {},
): string {
  return record({
    type,
    sourceName: options.source ?? 'RingConn',
    sourceVersion: '1.4.2',
    unit: options.unit ?? 'degC',
    creationDate: start,
    startDate: start,
    endDate: start,
    value,
  });
}

/** Feeds text to the parser through a stream that hands over `size` bytes at a time. */
function chunked(text: string, size: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  });
}

function planOf(result: Awaited<ReturnType<typeof parseWearableText>>): WearableImportPlan {
  if (!result.ok) throw new Error(`expected a plan, got ${result.code}: ${result.error}`);
  return result.plan;
}

/* -------------------------------------------------------------------------- */
/* Apple Health XML                                                           */
/* -------------------------------------------------------------------------- */

describe('Apple Health export.xml', () => {
  it('reads temperature and weight into days, and counts what it cannot store', async () => {
    const xml = healthXml([
      temperature(WRIST, '2026-01-02 03:10:00 +0100', '36.18'),
      temperature(BODY, '2026-01-03 08:00:00 +0100', '36.42'),
      record({ type: MASS, sourceName: 'Health', unit: 'kg', startDate: '2026-01-03 07:00:00 +0100', endDate: '2026-01-03 07:00:00 +0100', value: '61.4' }),
      record({ type: SLEEP, sourceName: 'RingConn', unit: 'min', startDate: '2026-01-03 23:00:00 +0100', endDate: '2026-01-04 07:00:00 +0100', value: 'HKCategoryValueSleepAnalysisAsleepCore' }),
      record({ type: RESTING_HR, sourceName: 'RingConn', unit: 'count/min', startDate: '2026-01-03 07:00:00 +0100', endDate: '2026-01-03 07:00:00 +0100', value: '54' }),
      record({ type: HEART_RATE, sourceName: 'RingConn', unit: 'count/min', startDate: '2026-01-03 09:00:00 +0100', endDate: '2026-01-03 09:00:00 +0100', value: '88' }),
      record({ type: STEPS, sourceName: 'RingConn', unit: 'count', startDate: '2026-01-03 10:00:00 +0100', endDate: '2026-01-03 10:00:00 +0100', value: '412' }),
    ]);

    const plan = planOf(await parseWearableText(xml, 'export.xml'));

    expect(plan.format).toBe('apple-health-xml');
    expect(plan.counts).toEqual({
      recordsRead: 7,
      temperature: 2,
      weight: 1,
      sleep: 1,
      restingHeartRate: 1,
      heartRate: 1,
      activity: 1,
      other: 0,
    });
    expect(plan.days).toEqual([
      {
        date: '2026-01-02',
        temperature: { celsius: 36.18, samples: 1, origin: 'sleeping wrist temperature', source: 'RingConn' },
        weightKg: null,
        weightSamples: 0,
      },
      {
        date: '2026-01-03',
        temperature: { celsius: 36.42, samples: 1, origin: 'body temperature', source: 'RingConn' },
        weightKg: 61.4,
        weightSamples: 1,
      },
    ]);
  });

  it('prefers an overnight wrist temperature to a generic one on the same night', async () => {
    const xml = healthXml([
      temperature(BODY, '2026-01-02 22:40:00 +0100', '37.20'),
      temperature(WRIST, '2026-01-03 03:10:00 +0100', '36.18'),
    ]);
    const plan = planOf(await parseWearableText(xml, 'export.xml'));

    // The generic reading is on the evening of the 2nd, the wrist reading on the
    // morning of the 3rd, and the wrist reading is the one that means something.
    expect(plan.days.map((day) => [day.date, day.temperature?.celsius, day.temperature?.origin])).toEqual([
      ['2026-01-02', 37.2, 'body temperature'],
      ['2026-01-03', 36.18, 'sleeping wrist temperature'],
    ]);
  });

  it('credits an overnight sample taken after noon to the following morning', async () => {
    const xml = healthXml([
      // A wrist temperature sampled at 23:40 is part of the night that ends on the
      // 4th, not the evening of the 3rd.
      temperature(WRIST, '2026-01-03 23:40:00 +0100', '36.05'),
      temperature(WRIST, '2026-01-04 03:20:00 +0100', '36.11'),
    ]);
    const plan = planOf(await parseWearableText(xml, 'export.xml'));

    expect(plan.days).toHaveLength(1);
    expect(plan.days[0]!.date).toBe('2026-01-04');
    // Two readings of the same type on one night are one day's value: their mean.
    expect(plan.days[0]!.temperature).toMatchObject({ celsius: 36.08, samples: 2 });
  });

  it('converts Fahrenheit and refuses a value that is not a human temperature', async () => {
    const xml = healthXml([
      temperature(BODY, '2026-02-01 08:00:00 +0100', '98.60', { unit: 'degF', source: 'Thermometer' }),
      temperature(BODY, '2026-02-02 08:00:00 +0100', '300', { source: 'Thermometer' }),
    ]);
    const result = await parseWearableText(xml, 'export.xml');
    const plan = planOf(result);

    expect(plan.days).toHaveLength(1);
    expect(plan.days[0]!.temperature!.celsius).toBe(37);
    expect(plan.issueCount).toBe(1);
    // The 300 is the second <Record> in the file, so it is reported as record 2.
    expect(plan.issues[0]).toMatchObject({ row: 2, column: 'value', value: '300 degC' });
    expect(plan.issues[0]!.message).toContain('is outside the plausible range');
  });

  it('keeps the good records and reports each bad one by its record number', async () => {
    const xml = healthXml([
      temperature(WRIST, '2026-03-01 03:00:00 +0100', '36.20'),
      temperature(WRIST, 'not-a-date', '36.30'),
      temperature(WRIST, '2026-03-03 03:00:00 +0100', 'n/a'),
      record({ type: WRIST, sourceName: 'RingConn', unit: 'degC', startDate: '2026-03-04 03:00:00 +0100', endDate: '2026-03-04 03:00:00 +0100' }),
      temperature(WRIST, '2026-03-05 03:00:00 +0100', '12'),
      temperature(WRIST, '2026-03-06 03:00:00 +0100', '36.60'),
    ]);
    const plan = planOf(await parseWearableText(xml, 'export.xml'));

    // Three of six records are unusable; the other three land, in date order.
    expect(plan.days.map((day) => [day.date, day.temperature!.celsius])).toEqual([
      ['2026-03-01', 36.2],
      ['2026-03-06', 36.6],
    ]);
    expect(plan.issueCount).toBe(4);
    expect(plan.issues.map((issue) => issue.row)).toEqual([2, 3, 4, 5]);
    expect(plan.issues[0]!.message).toContain('“not-a-date” is not a date');
    expect(plan.issues[1]!.message).toContain('“n/a” is not a number');
    expect(plan.issues[2]!.message).toContain('Record has no value');
    expect(plan.issues[3]!.message).toContain('is outside the plausible range');
    expect(plan.counts.recordsRead).toBe(6);
    // Only two of the six records produced a usable temperature.
    expect(plan.counts.temperature).toBe(2);
  });

  it('reports what every source wrote, including a source that wrote no temperature', async () => {
    const xml = healthXml([
      record({ type: SLEEP, sourceName: 'RingConn', unit: 'min', startDate: '2026-04-01 23:00:00 +0100', endDate: '2026-04-02 07:00:00 +0100', value: 'HKCategoryValueSleepAnalysisAsleepCore' }),
      record({ type: RESTING_HR, sourceName: 'RingConn', unit: 'count/min', startDate: '2026-04-02 07:00:00 +0100', endDate: '2026-04-02 07:00:00 +0100', value: '54' }),
      temperature(BODY, '2026-04-02 07:30:00 +0100', '36.55', { source: 'Fertility Friend' }),
    ]);
    const plan = planOf(await parseWearableText(xml, 'export.xml'));

    // This is the finding the card exists to surface: RingConn wrote data and no
    // temperature, so the ring's skin temperature is not reaching Apple Health.
    expect(plan.sources).toEqual([
      { name: 'Fertility Friend', temperature: 1, records: 1 },
      { name: 'RingConn', temperature: 0, records: 2 },
    ]);
  });

  it('says which apps wrote data when none of them wrote a temperature', async () => {
    const xml = healthXml([
      record({ type: SLEEP, sourceName: 'RingConn', unit: 'min', startDate: '2026-04-01 23:00:00 +0100', endDate: '2026-04-02 07:00:00 +0100', value: 'HKCategoryValueSleepAnalysisAsleepCore' }),
      record({ type: RESTING_HR, sourceName: 'RingConn', unit: 'count/min', startDate: '2026-04-02 07:00:00 +0100', endDate: '2026-04-02 07:00:00 +0100', value: '54' }),
    ]);
    const plan = planOf(await parseWearableText(xml, 'export.xml'));

    expect(plan.days).toEqual([]);
    expect(plan.notes.join(' ')).toContain('No temperature reading was found');
    expect(plan.notes.join(' ')).toContain('RingConn (2)');
    expect(plan.notes.join(' ')).toContain('none of them wrote a temperature');
  });

  it('reads the same file whatever the chunk boundaries are', async () => {
    // Long enough that the format is decided mid-stream, so every later chunk is
    // fed to the tag scanner and some of them split a `<Record …>` in half.
    const records = Array.from({ length: 60 }, (_, i) =>
      temperature(WRIST, `2026-05-${String((i % 28) + 1).padStart(2, '0')} 03:${String(i % 60).padStart(2, '0')}:00 +0100`, (36 + i / 200).toFixed(2)),
    );
    const xml = healthXml(records);
    expect(xml.length).toBeGreaterThan(2048 * 2);

    const whole = planOf(await parseWearableText(xml, 'export.xml'));
    expect(whole.days.length).toBeGreaterThan(20);

    for (const size of [1, 7, 64, 997, 2048, 4096]) {
      const result = await parseWearableStream(chunked(xml, size), { fileName: 'export.xml' });
      expect(planOf(result), `chunk size ${size}`).toEqual(whole);
    }
  });

  it('states each note exactly once', async () => {
    const xml = healthXml([
      temperature(BODY, '2026-07-01 08:00:00 +0100', '36.55'),
      record({ type: SLEEP, sourceName: 'RingConn', unit: 'min', startDate: '2026-07-01 23:00:00 +0100', endDate: '2026-07-02 07:00:00 +0100', value: 'HKCategoryValueSleepAnalysisAsleepCore' }),
    ]);
    const plan = planOf(await parseWearableText(xml, 'export.xml'));

    // The merge-rule note is assembled from a base list and a computed list; the
    // first version of this shipped the same sentence twice.
    expect(plan.notes).toEqual([...new Set(plan.notes)]);
  });

  it('strips XML entities from a source name without corrupting it', () => {
    const reader = new AppleHealthXmlReader();
    reader.push(record({ type: BODY, sourceName: 'Ann &amp; Bob&#39;s thermometer', unit: 'degC', startDate: '2026-06-01 08:00:00 +0100', endDate: '2026-06-01 08:00:00 +0100', value: '36.5' }));
    expect(reader.sourceTallies).toEqual([{ name: "Ann & Bob's thermometer", temperature: 1, records: 1 }]);
  });
});

/* -------------------------------------------------------------------------- */
/* CSV                                                                        */
/* -------------------------------------------------------------------------- */

describe('wearable CSV', () => {
  it('reads a dated temperature column with a BOM and the header below a comment', async () => {
    const csv = [
      '\uFEFF# exported from somewhere',
      '',
      'Date,Temperature (°C),Weight (kg)',
      '2026-01-01,36.20,61.2',
      '2026-01-02,36.45,61.0',
    ].join('\r\n');
    const plan = planOf(await parseWearableText(csv, 'temps.csv'));

    expect(plan.format).toBe('csv');
    expect(plan.days.map((day) => [day.date, day.temperature!.celsius, day.weightKg])).toEqual([
      ['2026-01-01', 36.2, 61.2],
      ['2026-01-02', 36.45, 61],
    ]);
  });

  it('reports a malformed row and still imports the rows either side of it', async () => {
    const csv = [
      'Date,Temperature',
      '2026-02-01,36.30',
      'February 2nd,36.40',
      '2026-02-03,hot',
      '2026-02-04,98.6',
      ',36.50',
      '2026-02-06,36.70',
    ].join('\n');
    const result = await parseWearableText(csv, 'temps.csv');
    const plan = planOf(result);

    expect(plan.days.map((day) => [day.date, day.temperature!.celsius])).toEqual([
      ['2026-02-01', 36.3],
      // 98.6 with no unit marker is Fahrenheit: the magnitude decides.
      ['2026-02-04', 37],
      ['2026-02-06', 36.7],
    ]);
    expect(plan.issueCount).toBe(3);
    expect(plan.issues.map((issue) => [issue.row, issue.column])).toEqual([
      [3, 'Date'],
      [4, 'Temperature'],
      [6, 'Date'],
    ]);
    expect(plan.issues[0]!.message).toContain('is not a date; row skipped');
    expect(plan.issues[1]!.message).toContain('is not a temperature in °C or °F; left empty');
    // A bad field on a good row costs the field, not the row.
    expect(plan.issues[2]!.message).toContain('Row has no date; row skipped');
  });

  it('reads a short row as empty cells rather than shifting the columns', async () => {
    const csv = ['Date,Temperature,Weight', '2026-03-01,36.4', '2026-03-02,,60.5,extra,ignored'].join('\r\n');
    const plan = planOf(await parseWearableText(csv, 'mixed.csv'));

    expect(plan.days).toEqual([
      {
        date: '2026-03-01',
        temperature: { celsius: 36.4, samples: 1, origin: 'temperature', source: null },
        weightKg: null,
        weightSamples: 0,
      },
      { date: '2026-03-02', temperature: null, weightKg: 60.5, weightSamples: 1 },
    ]);
  });

  it('refuses a RingConn app export and says why, instead of importing nothing', async () => {
    // The real header from a RingConn "Vital Sings" export, taken from a public
    // repository (see the library note).
    const csv = [
      'Date,Avg. Heart Rate(bpm),Min. Heart Rate(bpm),Max. Heart Rate(bpm),Avg. Spo2(%),Min. Spo2(%),Max. Spo2(%),Avg. HRV(ms),Min. HRV(ms),Max. HRV(ms)',
      '2025-07-05,60,42,95,97%,95%,99%,84,47,136',
    ].join('\n');

    const result = await parseWearableText(csv, 'Vital Sings-Charly Nazzal-2025-07-01-2025-07-15.csv');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('unrecognised');
    expect(result.error).toContain('no temperature column');
  });

  it('recognises every one of the vendor’s three exported shapes', () => {
    expect(
      looksLikeRingConnExport('Activity-Jane Roe-2025-07-01-2025-07-15.csv', ['Date', 'Steps', 'Calories(kcal)']),
    ).toBe(true);
    expect(
      looksLikeRingConnExport('Sleep-Jane Roe-2025-07-01-2025-07-15.csv', [
        'Start Time',
        'End Time',
        'Time Asleep(min)',
        'Sleep Stages - REM(min)',
      ]),
    ).toBe(true);
    expect(
      looksLikeRingConnExport('anything.csv', ['Date', 'Avg. Spo2(%)', 'Avg. HRV(ms)']),
    ).toBe(true);
    expect(looksLikeRingConnExport('mine.csv', ['Date', 'Temperature (°C)'])).toBe(false);
  });

  it('reads pounds as kilograms only when the cell says so', async () => {
    const csv = ['Date,Weight', '2026-04-01,135 lb', '2026-04-02,61.0'].join('\n');
    const plan = planOf(await parseWearableText(csv, 'w.csv'));
    expect(plan.days[0]!.weightKg).toBe(61.23);
    expect(plan.days[1]!.weightKg).toBe(61);
  });

  it('refuses a CSV with no usable column, and an empty file', async () => {
    const noColumns = await parseWearableText('Date,Steps\n2026-01-01,4000', 'steps.csv');
    expect(noColumns.ok).toBe(false);
    if (noColumns.ok) throw new Error('unreachable');
    expect(noColumns.code).toBe('unrecognised');

    const empty = await parseWearableText('', 'empty.csv');
    expect(empty.ok).toBe(false);
    if (empty.ok) throw new Error('unreachable');
    expect(empty.code).toBe('empty');
  });
});

/* -------------------------------------------------------------------------- */
/* unit handling                                                              */
/* -------------------------------------------------------------------------- */

describe('units', () => {
  it('trusts an explicit scale marker over the magnitude', () => {
    expect(temperatureScale('36.6', 36.6)).toBe('celsius');
    expect(temperatureScale('98.6', 98.6)).toBe('fahrenheit');
    expect(temperatureScale('36.6 °F', 36.6)).toBe('fahrenheit');
    expect(temperatureScale('98.6 degC', 98.6)).toBe('celsius');
    expect(temperatureScale('300', 300)).toBe('unknown');
  });

  it('converts, and refuses what it cannot convert', () => {
    expect(celsiusFrom(98.6, 'degF')).toBeCloseTo(37, 5);
    expect(celsiusFrom(36.6, 'degC')).toBe(36.6);
    expect(celsiusFrom(300, 'degC')).toBe(300); // in range check happens after
    expect(celsiusFrom(300, '')).toBe(null);
    expect(kilogramsFrom(135, 'lb')).toBeCloseTo(61.235, 2);
    expect(kilogramsFrom(61, 'kg')).toBe(61);
    expect(kilogramsFrom(900, 'stone')).toBeCloseTo(5715.26, 1);
  });
});

/* -------------------------------------------------------------------------- */
/* the "nothing to import" explanation                                        */
/* -------------------------------------------------------------------------- */

describe('explainEmptyImport', () => {
  it('names the sources that wrote data when none of them wrote a temperature', async () => {
    const xml = healthXml([
      record({ type: SLEEP, sourceName: 'RingConn', unit: 'min', startDate: '2026-04-01 23:00:00 +0100', endDate: '2026-04-02 07:00:00 +0100', value: 'HKCategoryValueSleepAnalysisAsleepCore' }),
    ]);
    const plan = planOf(await parseWearableText(xml, 'export.xml'));

    const message = explainEmptyImport(plan);
    expect(message).toContain('no day carried a temperature or a weight');
    expect(message).toContain('RingConn 0 temperature of 1 records');
  });
});
