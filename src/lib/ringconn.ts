/**
 * Wearable health-data import — RingConn, Apple Health, Health Connect.
 *
 * ## The research, because it is what dictates this module's shape
 *
 * **RingConn publishes no developer API.** There is no developer portal, no
 * published API documentation, no OAuth flow, no official SDK and no partner
 * programme. The evidence, so this is a finding rather than an assumption:
 *
 *  - The vendor's own sitemap lists every page on ringconn.com (82 of them) and
 *    none is a developer, API or partner page — `sitemap.xml` →
 *    `sitemap_pages_1.xml` (checked 2026-09). The one programme it does advertise
 *    is `become-a-distributor`, which is retail, not an integration.
 *  - The hosts a developer portal would live on do not resolve:
 *    `developer|developers|dev|api|open|partners.ringconn.com` all fail with
 *    NXDOMAIN, while `ringconn.com` and `support.ringconn.com` answer normally —
 *    so this is a missing host, not a broken network.
 *  - A web search for "RingConn API developer access" returns nothing from the
 *    vendor. A search for "RingConn developer API" returns two
 *    `storage.googleapis.com/…` "API guide" pages that are anonymous SEO
 *    filler, not documentation — see the note on them below.
 *
 * What the community does instead is **reverse-engineer the ring's Bluetooth LE
 * protocol**: <https://github.com/perezjuanj/OpenCircuit> states that the ring's
 * per-connection authentication is "fully reverse-engineered" and that it needs
 * "no RingConn account or app ever needed", and
 * <https://github.com/zazaulola/ringlink> does the same on Android. That is a
 * native-client project. A self-hosted *web* app has no BLE access, so it is not
 * a route this app can take, and a reverse-engineered protocol is not a
 * documented API — it can break with any firmware update.
 *
 * ## Therefore: import the files the ecosystem actually produces
 *
 *  - **Apple Health `export.xml`** (Health app → profile → Export All Health
 *    Data → `export.zip` → `apple_health_export/export.xml`). RingConn's own
 *    instructions connect its app *to Apple Health* — "Me" > "App Settings" >
 *    "Data Management" > "Connect to Apple Health",
 *    <https://support.ringconn.com/product-support/gen3> — which is the one
 *    supported way out of the vendor app on iOS.
 *  - **Health Connect** on Android: RingConn's migration notice,
 *    <https://ringconn.com/blogs/news/ringconn-will-migrate-from-google-fit-to-health-connect>.
 *    Health Connect is a device-local store; a self-hosted web app cannot read
 *    it, so there is no direct path here either — only the same export-and-upload
 *    shape, if the user gets the data out.
 *  - **A CSV** with a date column plus a temperature and/or weight column.
 *
 * ## The honest limit: the ring's temperature may not be in any of them
 *
 * This matters more than anything else in this file, because skin temperature is
 * the basal-body-temperature signal period tracking actually wants — it is what
 * confirms ovulation retrospectively. Three findings:
 *
 *  1. The ring *does* measure it, and it is the backbone of the vendor's own
 *     cycle feature: <https://www.ringconn.com/pages/womens-health> describes
 *     "Full-Cycle Prediction … based on continuous skin temperature monitoring".
 *  2. RingConn's Android/Health Connect data-type list is activity, sleep, heart
 *     rate, height, weight and SpO₂ — **no temperature** (the migration notice
 *     above).
 *  3. The vendor app's own export — `Activity-<name>-<from>-<to>.csv`,
 *     `Sleep-…`, `Vital Sings-…` (the shipped typo is theirs) — carries steps and
 *     calories, sleep staging, and average/min/max heart rate, SpO₂ and HRV, and
 *     **no temperature column at all**. Verified against two real exports
 *     published in public repositories:
 *     `charlynazzal/my-health-data` (`Vital Sings-Charly Nazzal-2025-07-01-2025-07-15.csv`
 *     → `Date,Avg. Heart Rate(bpm),Min. …,Avg. Spo2(%),…,Avg. HRV(ms),…`) and
 *     `SamuelDonovan/sleep-analyzer`.
 *
 * So the temperature has to come from *somewhere else* writing into Apple Health
 * (an Apple Watch, a basal thermometer app, or a third-party bridge). Rather than
 * pretend otherwise, the preview reports what **each app wrote into the export** —
 * "RingConn 0 temperature of 214 records" is an answer the user can act on instead
 * of a silent no-op. There is no source filter: any body temperature is useful for
 * cycle maths, whatever measured it.
 *
 * *The `storage.googleapis.com` "RingConn Gen 2/3 API Guide" pages are named here
 * only to say they were looked at and rejected: they are keyword-stuffed filler,
 * cite no vendor documentation, and describe no real endpoint. Treating them as a
 * source would have produced a fabricated integration.*
 *
 * ## What this module does with a file
 *
 * It reads the whole file as a stream, keeps only per-day aggregates, and returns
 * an inert plan. No database access and no `next` import, so the same call backs
 * the preview and the commit, and the parser is testable without a server.
 *
 * Reuse note: the CSV path is `src/lib/csv.ts`, this repo's hand-written RFC 4180
 * reader — it already handles a BOM, a bare CR inside a quoted field, and a
 * header that is not on line 1. Nothing here re-implements any of that.
 */

import { isValidDateOnly } from './dates';
import { parseCsv } from './csv';
import type { PeriodImportIssue } from './period-types';
import type { DateOnly } from './types';

/* -------------------------------------------------------------------------- */
/* contract                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The three shapes this importer understands.
 *
 * `ringconn-export` is not a parser of its own: it is the CSV parser having
 * recognised the vendor app's own column set, which lets the UI say the specific
 * true thing ("this file cannot contain a temperature") instead of the generic
 * one ("no temperature column found").
 */
export type WearableFormat = 'apple-health-xml' | 'csv' | 'ringconn-export';

export const WEARABLE_FORMAT_LABELS: Record<WearableFormat, string> = {
  'apple-health-xml': 'Apple Health export',
  csv: 'CSV',
  'ringconn-export': 'RingConn app export',
};

/** One day's worth of imported wearable data. Only these two fields have a home. */
export interface WearableDay {
  date: DateOnly;
  temperature: {
    celsius: number;
    /** How many readings were averaged into the day's value. */
    samples: number;
    /** The Apple Health type or CSV column the value came from. */
    origin: string;
    /** `sourceName` for Apple Health records; null for a CSV. */
    source: string | null;
  } | null;
  weightKg: number | null;
  weightSamples: number;
}

/**
 * Everything the file carried, counted.
 *
 * The non-temperature counts exist so the import can say what it *read and did
 * not store*. Sleep, resting heart rate and activity have no column in
 * `period_day_logs`, so they are reported rather than silently discarded and
 * rather than inventing a schema to hold them (see the module note in
 * `WearableImportSummary`).
 */
export interface WearableCounts {
  /** Every `<Record>` element, or every non-blank CSV data row. */
  recordsRead: number;
  temperature: number;
  weight: number;
  sleep: number;
  restingHeartRate: number;
  heartRate: number;
  activity: number;
  /** Recognised Apple Health types this importer has no destination for. */
  other: number;
}

export interface WearableSourceTally {
  name: string;
  /** Temperature records from this source. Zero is the finding that matters most. */
  temperature: number;
  /** Every record this source wrote, of any type. */
  records: number;
}

export interface WearableImportPlan {
  format: WearableFormat;
  /** Ascending by date, one entry per date. */
  days: WearableDay[];
  counts: WearableCounts;
  /** Temperature records per Apple Health `sourceName`, most first. */
  sources: WearableSourceTally[];  issues: PeriodImportIssue[];
  issueCount: number;
  notes: string[];
}

export interface WearableImportPreview {
  fileName: string;
  format: WearableFormat;
  formatLabel: string;
  daysWithTemperature: number;
  daysWithWeight: number;
  /** Up to {@link MAX_EXAMPLES} of the most recent days carrying a temperature. */
  examples: { date: DateOnly; temperatureC: number; origin: string; source: string | null }[];
  dateRange: { from: DateOnly; to: DateOnly } | null;
  counts: WearableCounts;
  sources: WearableSourceTally[];
  issues: PeriodImportIssue[];
  issueCount: number;
  notes: string[];
}

export type WearableParseResult =
  | { ok: true; plan: WearableImportPlan; preview: WearableImportPreview }
  | { ok: false; code: 'empty' | 'unrecognised' | 'truncated' | 'too_large'; error: string };

/**
 * What the commit did.
 *
 * `temperatureKept` / `weightKept` are the merge rule made visible: a day whose
 * field the user had already filled by hand is *kept*, never overwritten, and the
 * count is reported so the card can say so.
 */
export interface WearableImportSummary {
  mode: 'commit';
  daysCreated: number;
  daysUpdated: number;
  daysUnchanged: number;
  temperatureFilled: number;
  temperatureKept: number;
  weightFilled: number;
  weightKept: number;
  issues: PeriodImportIssue[];
  issueCount: number;
  notes: string[];
}

export interface WearableImportResult {
  mode: 'preview' | 'commit';
  preview: WearableImportPreview;
  summary?: WearableImportSummary;
}

/* -------------------------------------------------------------------------- */
/* limits                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Bounds on how much work one file may cause.
 *
 * A decade of Apple Health records is on the order of a million `<Record>`
 * elements; four million turns a hostile or corrupt file into an immediate error
 * instead of a request that runs until the platform kills it.
 */
export const MAX_WEARABLE_RECORDS = 4_000_000;
/** Row problems kept for display. The count is always exact. */
const MAX_REPORTED_ISSUES = 100;
/** How many example days the preview shows. */
const MAX_EXAMPLES = 4;
/** Plausible human body temperature, the same bounds `period-csv.ts` uses. */
const MIN_TEMPERATURE_C = 25;
const MAX_TEMPERATURE_C = 45;
/** Plausible human weight in kg. */
const MIN_WEIGHT_KG = 20;
const MAX_WEIGHT_KG = 500;

/* -------------------------------------------------------------------------- */
/* Apple Health vocabulary                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The three temperature identifiers, **in preference order**.
 *
 * `AppleSleepingWristTemperature` is what a ring or watch writes overnight and is
 * the closest thing to a basal reading; `BasalBodyTemperature` is what a dedicated
 * thermometer app writes; `BodyTemperature` is the generic one, which is also what
 * a fever check writes and is therefore the least useful for cycle maths. When a
 * day carries more than one type, the best-ranked one wins rather than the average
 * of unlike measurements.
 */
const TEMPERATURE_TYPES: Record<string, { origin: string; rank: number }> = {
  HKQuantityTypeIdentifierAppleSleepingWristTemperature: { origin: 'sleeping wrist temperature', rank: 0 },
  HKQuantityTypeIdentifierBasalBodyTemperature: { origin: 'basal body temperature', rank: 1 },
  HKQuantityTypeIdentifierBodyTemperature: { origin: 'body temperature', rank: 2 },
};

const WEIGHT_TYPES: Record<string, string> = {
  HKQuantityTypeIdentifierBodyMass: 'body mass',
  HKQuantityTypeIdentifierBodyMassIndex: 'body mass index',
};

/** Types this importer reads past but cannot store, mapped to their counter. */
const COUNTED_TYPES: Record<string, keyof Omit<WearableCounts, 'recordsRead' | 'temperature' | 'weight' | 'other'>> = {
  HKCategoryTypeIdentifierSleepAnalysis: 'sleep',
  HKQuantityTypeIdentifierRestingHeartRate: 'restingHeartRate',
  HKQuantityTypeIdentifierHeartRate: 'heartRate',
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: 'heartRate',
  HKQuantityTypeIdentifierStepCount: 'activity',
  HKQuantityTypeIdentifierActiveEnergyBurned: 'activity',
  HKQuantityTypeIdentifierBasalEnergyBurned: 'activity',
  HKQuantityTypeIdentifierDistanceWalkingRunning: 'activity',
  HKQuantityTypeIdentifierAppleExerciseTime: 'activity',
};

/* -------------------------------------------------------------------------- */
/* small shared helpers                                                       */
/* -------------------------------------------------------------------------- */

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A calendar shift on a `YYYY-MM-DD` string: no zone is involved, so none is taken. */
function shiftDateOnly(date: DateOnly, days: number): DateOnly {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Which scale a temperature reading is in.
 *
 * An explicit marker always wins. Without one the *magnitude* decides, because a
 * plain `98.6` in a spreadsheet is Fahrenheit and a plain `36.6` is Celsius, and
 * refusing both would make the importer useless for exactly the files people
 * hand-write. Anything that is neither (a 300, a 12) is refused rather than
 * guessed at.
 */
export function temperatureScale(raw: string, value: number): 'celsius' | 'fahrenheit' | 'unknown' {
  const text = raw.toLowerCase();
  if (/°\s*c|deg\s*c|celsius|\bc\b/.test(text)) return 'celsius';
  if (/°\s*f|deg\s*f|fahrenheit|\bf\b/.test(text)) return 'fahrenheit';
  if (value >= MIN_TEMPERATURE_C && value <= MAX_TEMPERATURE_C) return 'celsius';
  if (value > MAX_TEMPERATURE_C && value <= 113) return 'fahrenheit';
  return 'unknown';
}

/** Converts a reading to °C, or null when its scale cannot be established. */
export function celsiusFrom(value: number, raw: string): number | null {
  const scale = temperatureScale(raw, value);
  if (scale === 'celsius') return value;
  if (scale === 'fahrenheit') return ((value - 32) * 5) / 9;
  return null;
}

/** Converts a reading to kg. An explicit unit wins; otherwise kg is assumed. */
export function kilogramsFrom(value: number, raw: string): number | null {
  const text = raw.toLowerCase();
  if (/lb|pound/.test(text)) return value * 0.45359237;
  if (/st\b|stone/.test(text)) return value * 6.35029318;
  if (/kg|kilogram/.test(text)) return value;
  if (value >= MIN_WEIGHT_KG && value <= MAX_WEIGHT_KG) return value;
  return null;
}

/** The first number in a cell, tolerating a unit suffix and a comma decimal. */
function numberIn(raw: string): number | null {
  const match = raw.replace(/\u00a0/g, ' ').trim().match(/-?\d+(?:[.,]\d+)?/);
  if (!match) return null;
  const value = Number(match[0].replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

/* -------------------------------------------------------------------------- */
/* the day accumulator, shared by both readers                                */
/* -------------------------------------------------------------------------- */

interface DayAccumulator {
  temperature: { rank: number; sum: number; count: number; origin: string; source: string | null } | null;
  weightSum: number;
  weightCount: number;
}

/** Collects per-day aggregates and hands back the sorted plan. */
class DayStore {
  private readonly days = new Map<DateOnly, DayAccumulator>();

  private get(date: DateOnly): DayAccumulator {
    let entry = this.days.get(date);
    if (!entry) {
      entry = { temperature: null, weightSum: 0, weightCount: 0 };
      this.days.set(date, entry);
    }
    return entry;
  }

  /**
   * Records one temperature reading.
   *
   * `rank` is the origin's preference (lower is better): a better-ranked reading
   * replaces what was there, and equal-ranked readings are averaged. That is what
   * makes "an overnight wrist temperature beats a lunchtime fever check, but two
   * overnight readings on one night are one day's value" true.
   */
  addTemperature(date: DateOnly, celsius: number, origin: string, rank: number, source: string | null): void {
    const entry = this.get(date);
    if (!entry.temperature || rank < entry.temperature.rank) {
      entry.temperature = { rank, sum: celsius, count: 1, origin, source };
      return;
    }
    if (rank === entry.temperature.rank) {
      entry.temperature.sum += celsius;
      entry.temperature.count += 1;
      entry.temperature.source = entry.temperature.source ?? source;
    }
  }

  addWeight(date: DateOnly, kg: number): void {
    const entry = this.get(date);
    entry.weightSum += kg;
    entry.weightCount += 1;
  }

  build(): WearableDay[] {
    const out: WearableDay[] = [];
    for (const [date, entry] of this.days) {
      const temperature = entry.temperature
        ? {
            celsius: round2(entry.temperature.sum / entry.temperature.count),
            samples: entry.temperature.count,
            origin: entry.temperature.origin,
            source: entry.temperature.source,
          }
        : null;
      out.push({
        date,
        temperature,
        weightKg: entry.weightCount ? round2(entry.weightSum / entry.weightCount) : null,
        weightSamples: entry.weightCount,
      });
    }
    out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return out;
  }
}

/* -------------------------------------------------------------------------- */
/* problem collection                                                         */
/* -------------------------------------------------------------------------- */

class Problems {
  readonly issues: PeriodImportIssue[] = [];
  issueCount = 0;

  report(issue: PeriodImportIssue): void {
    this.issueCount += 1;
    if (this.issues.length < MAX_REPORTED_ISSUES) this.issues.push(issue);
  }
}

/* -------------------------------------------------------------------------- */
/* Apple Health XML                                                           */
/* -------------------------------------------------------------------------- */

/** The five XML entities Apple's exporter emits, plus numeric references. */
function decodeEntities(value: string): string {
  if (!value.includes('&')) return value;
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

const ATTRIBUTE = /([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"/g;

function attributesOf(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTRIBUTE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE.exec(tag)) !== null) {
    out[match[1]!] = decodeEntities(match[2]!);
  }
  return out;
}

/**
 * Reads Apple Health's `export.xml` as a stream.
 *
 * ## Why a tag scanner and not an XML parser
 *
 * The file is routinely hundreds of megabytes: a few years of an Apple Watch is
 * 200 MB+ of `<Record>` elements, and `JSON.parse`-style whole-file parsing would
 * put all of it in memory at once. This walks the stream, keeps a small tail
 * buffer, and folds each record into a per-day aggregate, so peak memory is
 * proportional to the number of *days*, not the size of the file.
 *
 * It understands exactly one element, `<Record …>`, which is where every health
 * value lives. `<Workout>`, `<ActivitySummary>` and the metadata children are
 * ignored. That is a deliberate limit: an XML parser would be a new dependency,
 * and the vendor format is fixed.
 *
 * ## Two Apple-specific rules
 *
 *  - **Dates keep their own offset.** Apple writes local wall time with an offset
 *    (`2026-01-02 03:00:00 +0100`). The date part *is* the local date, so it is
 *    taken literally and no timezone is applied — converting it would move a 3am
 *    reading onto the previous day for some users and not others.
 *  - **An overnight reading belongs to the morning.** Apple attributes a sleeping
 *    wrist temperature to the sleep session, but the individual samples are
 *    timestamped through the night. A sample taken after noon local time is
 *    therefore credited to the next day, so a reading at 23:40 lands on the
 *    morning it belongs to rather than the evening before it.
 */
export class AppleHealthXmlReader {
  private buffer = '';
  readonly days = new DayStore();
  readonly counts: WearableCounts = {
    recordsRead: 0,
    temperature: 0,
    weight: 0,
    sleep: 0,
    restingHeartRate: 0,
    heartRate: 0,
    activity: 0,
    other: 0,
  };
  readonly problems = new Problems();
  private readonly sources = new Map<string, { temperature: number; records: number }>();

  push(text: string): void {
    this.buffer += text;
    for (;;) {
      const start = this.buffer.indexOf('<Record');
      if (start < 0) break;
      const end = this.buffer.indexOf('>', start);
      if (end < 0) break; // The tag is split across chunks; wait for the rest.
      const tag = this.buffer.slice(start + '<Record'.length, end);
      this.buffer = this.buffer.slice(end + 1);
      this.recordsRead();
      this.record(tag);
    }
    // A partial tag is worth keeping; anything else is not.
    if (!this.buffer.includes('<Record')) this.buffer = this.buffer.slice(-64);
  }

  /** Aborts the scan early once the cap is passed; the caller turns that into an error. */
  get tooLarge(): boolean {
    return this.counts.recordsRead > MAX_WEARABLE_RECORDS;
  }

  get sourceTallies(): WearableSourceTally[] {
    return [...this.sources.entries()]
      .map(([name, tally]) => ({ name, temperature: tally.temperature, records: tally.records }))
      .sort((a, b) => b.temperature - a.temperature || b.records - a.records || a.name.localeCompare(b.name));
  }

  private recordsRead(): void {
    this.counts.recordsRead += 1;
  }

  private record(tag: string): void {
    const attrs = attributesOf(tag);
    const type = attrs.type ?? '';
    const index = this.counts.recordsRead;

    /*
     * Every record is tallied by source before anything is judged about it, and a
     * temperature record is tallied twice — once as a record and once as a
     * temperature. That is what lets the card answer the question a RingConn user
     * actually has: "did my ring write a temperature?" A source that wrote 200
     * sleep records and no temperature is the answer "no", and a tally of
     * temperature records alone could not say it, because a source with zero would
     * simply be absent.
     */
    const source = attrs.sourceName ?? 'unknown app';
    const tally = this.sources.get(source) ?? { temperature: 0, records: 0 };
    tally.records += 1;
    if (TEMPERATURE_TYPES[type]) tally.temperature += 1;
    this.sources.set(source, tally);

    const temperatureType = TEMPERATURE_TYPES[type];
    const isWeight = type in WEIGHT_TYPES;
    if (!temperatureType && !isWeight) {
      const bucket = COUNTED_TYPES[type];
      if (bucket) this.counts[bucket] += 1;
      else if (type) this.counts.other += 1;
      return;
    }

    const rawDate = attrs.startDate ?? attrs.endDate ?? '';
    const date = dateOf(rawDate);
    if (!date) {
      this.problems.report({
        row: index,
        column: 'startDate',
        value: rawDate || null,
        message: rawDate
          ? `“${rawDate}” is not a date; record skipped.`
          : 'Record has no start date; record skipped.',
      });
      return;
    }

    const rawValue = attrs.value ?? '';
    const value = numberIn(rawValue);
    if (value === null) {
      this.problems.report({
        row: index,
        column: 'value',
        value: rawValue || null,
        message: rawValue
          ? `“${rawValue}” is not a number; record skipped.`
          : 'Record has no value; record skipped.',
      });
      return;
    }

    if (temperatureType) {
      const unit = attrs.unit ?? '';
      const celsius = celsiusFrom(value, unit || rawValue);
      if (celsius === null) {
        this.problems.report({
          row: index,
          column: 'value',
          value: `${rawValue}${unit ? ` ${unit}` : ''}`,
          message: `Temperature ${rawValue}${unit ? ` ${unit}` : ''} is not a plausible human reading; record skipped.`,
        });
        return;
      }
      const c = round2(celsius);
      if (c < MIN_TEMPERATURE_C || c > MAX_TEMPERATURE_C) {
        this.problems.report({
          row: index,
          column: 'value',
          value: `${rawValue}${unit ? ` ${unit}` : ''}`,
          message: `${c} °C is outside the plausible range ${MIN_TEMPERATURE_C}–${MAX_TEMPERATURE_C} °C; record skipped.`,
        });
        return;
      }
      this.counts.temperature += 1;
      const overnight = temperatureType.rank === 0 && hourOf(rawDate) >= 12;
      this.days.addTemperature(overnight ? shiftDateOnly(date, 1) : date, c, temperatureType.origin, temperatureType.rank, attrs.sourceName ?? null);
      return;
    }

    const kg = kilogramsFrom(value, attrs.unit ?? rawValue);
    if (kg === null) {
      this.problems.report({
        row: index,
        column: 'value',
        value: `${rawValue}${attrs.unit ? ` ${attrs.unit}` : ''}`,
        message: `Weight ${rawValue}${attrs.unit ? ` ${attrs.unit}` : ''} could not be read as kilograms; record skipped.`,
      });
      return;
    }
    const rounded = round2(kg);
    if (rounded < MIN_WEIGHT_KG || rounded > MAX_WEIGHT_KG) {
      this.problems.report({
        row: index,
        column: 'value',
        value: `${rawValue}${attrs.unit ? ` ${attrs.unit}` : ''}`,
        message: `${rounded} kg is outside the plausible range ${MIN_WEIGHT_KG}–${MAX_WEIGHT_KG} kg; record skipped.`,
      });
      return;
    }
    this.counts.weight += 1;
    this.days.addWeight(date, rounded);
  }
}

/** `2026-01-02 03:00:00 +0100` → `2026-01-02`, or null when it is not a date. */
function dateOf(raw: string): DateOnly | null {
  const candidate = raw.slice(0, 10);
  return isValidDateOnly(candidate) ? candidate : null;
}

/** The local hour in `2026-01-02 23:40:00 +0100`, or 0 when there is no time part. */
function hourOf(raw: string): number {
  const hour = Number.parseInt(raw.slice(11, 13), 10);
  return Number.isFinite(hour) ? hour : 0;
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                        */
/* -------------------------------------------------------------------------- */

/** Header spellings, canonicalised (case and punctuation removed). */
const DATE_ALIASES = ['date', 'datetime', 'day', 'startdate', 'starttime', 'timestamp', 'recorddate', 'measuredate'];
const TEMPERATURE_ALIASES = [
  'temperature',
  'temperaturec',
  'temperaturef',
  'temp',
  'bodytemperature',
  'basaltemperature',
  'basalbodytemperature',
  'skintemperature',
  'wristtemperature',
  'sleepingwristtemperature',
  'temperaturecelsius',
  'temperaturefahrenheit',
];
const WEIGHT_ALIASES = ['weight', 'weightkg', 'weightlb', 'bodymass', 'mass', 'weightpounds'];

/**
 * Column signatures of RingConn's own export.
 *
 * Taken from two real exports published in public repositories (see the module
 * comment): the Vital Signs file is `Date,Avg. Heart Rate(bpm),…,Avg. Spo2(%),…,
 * Avg. HRV(ms),…`, the Sleep file is `Start Time,End Time,…,Time Asleep(min),…`,
 * and the Activity file is `Date,Steps,Calories(kcal)`.
 */
const RINGCONN_HEADER_PATTERNS = [
  /^calorieskcal$/,
  /^timeasleepmin$/,
  /^sleepstages/,
  /^avghrv/,
  /^avgspo2/,
  /^avgheartrate/,
  /^minheartrate/,
  /^sleeptimeratio/,
];
const RINGCONN_FILE_PATTERN = /^(activity|sleep|vital sings|vital signs)[-_ ]/i;

function canonical(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

export function looksLikeRingConnExport(fileName: string, headers: string[]): boolean {
  if (RINGCONN_FILE_PATTERN.test(fileName.trim())) return true;
  const names = headers.map(canonical);
  return RINGCONN_HEADER_PATTERNS.some((pattern) => names.some((name) => pattern.test(name)));
}

interface CsvColumns {
  date: number;
  temperature: number | null;
  weight: number | null;
}

function findColumns(header: string[]): CsvColumns | null {
  let date = -1;
  let temperature: number | null = null;
  let weight: number | null = null;
  header.forEach((cell, i) => {
    const name = canonical(cell);
    if (date < 0 && DATE_ALIASES.includes(name)) date = i;
    if (temperature === null && TEMPERATURE_ALIASES.includes(name)) temperature = i;
    if (weight === null && WEIGHT_ALIASES.includes(name)) weight = i;
  });
  return date < 0 ? null : { date, temperature, weight };
}

/* -------------------------------------------------------------------------- */
/* the stream entry point                                                     */
/* -------------------------------------------------------------------------- */

function emptyCounts(): WearableCounts {
  return {
    recordsRead: 0,
    temperature: 0,
    weight: 0,
    sleep: 0,
    restingHeartRate: 0,
    heartRate: 0,
    activity: 0,
    other: 0,
  };
}

function previewFor(fileName: string, plan: WearableImportPlan): WearableImportPreview {
  const withTemperature = plan.days.filter((day) => day.temperature);
  const withWeight = plan.days.filter((day) => day.weightKg !== null);
  return {
    fileName,
    format: plan.format,
    formatLabel: WEARABLE_FORMAT_LABELS[plan.format],
    daysWithTemperature: withTemperature.length,
    daysWithWeight: withWeight.length,
    examples: withTemperature.slice(-MAX_EXAMPLES).map((day) => ({
      date: day.date,
      temperatureC: day.temperature!.celsius,
      origin: day.temperature!.origin,
      source: day.temperature!.source,
    })),
    dateRange: plan.days.length
      ? { from: plan.days[0]!.date, to: plan.days[plan.days.length - 1]!.date }
      : null,
    counts: plan.counts,
    sources: plan.sources,
    issues: plan.issues,
    issueCount: plan.issueCount,
    notes: plan.notes,
  };
}

/**
 * Notes about what the file contained.
 *
 * The merge rule itself is *not* here: the card's footnote states it once, always,
 * and repeating it under every result was two lines of the same sentence. What is
 * here is only what the file added — including the counts the user cannot get
 * anywhere else.
 */
function notesFor(plan: WearableImportPlan): string[] {
  const notes: string[] = [];
  const { sleep, restingHeartRate, heartRate, activity } = plan.counts;
  const unstorable = sleep + restingHeartRate + heartRate + activity;
  if (unstorable > 0) {
    notes.push(
      `${unstorable.toLocaleString()} sleep, heart-rate and activity records were read but not stored: this app's period data has a field for temperature and weight only.`,
    );
  }
  if (plan.counts.temperature === 0 && plan.counts.recordsRead > 0) {
    /*
     * The useful version of "no temperature found": name who *did* write data.
     * "RingConn wrote 214 records and none of them was a temperature" tells the
     * user where the data stopped, which a bare "no temperature" does not.
     */
    const writers = plan.sources
      .filter((source) => source.records > 0)
      .slice(0, 4)
      .map((source) => `${source.name} (${source.records.toLocaleString()})`)
      .join(', ');
    notes.push(
      writers
        ? `No temperature reading was found. Apps that wrote data into this export: ${writers} — none of them wrote a temperature.`
        : 'No temperature reading was found in this file.',
    );
  }
  if (plan.days.length === 0) {
    notes.push('There was nothing to import — no day carried a temperature or a weight.');
  }
  return notes;
}

/**
 * Reads a wearable export from a byte stream.
 *
 * The format is decided from the first couple of kilobytes: an Apple Health XML
 * file is fed to {@link AppleHealthXmlReader} chunk by chunk, and anything else is
 * buffered and read as CSV. The XML path is the one that matters — it is the file
 * that is routinely too big to buffer — and the CSV path is bounded by
 * `maxCsvBytes` on the caller's side.
 */
export async function parseWearableStream(
  stream: ReadableStream<Uint8Array>,
  options: { fileName?: string; maxCsvBytes?: number } = {},
): Promise<WearableParseResult> {
  const fileName = options.fileName ?? 'wearable-export';
  const maxCsvBytes = options.maxCsvBytes ?? 16 * 1024 * 1024;
  const decoder = new TextDecoder('utf-8');

  const xml = new AppleHealthXmlReader();
  let head = '';
  let decided: 'xml' | 'csv' | null = null;
  const csvParts: string[] = [];
  let csvSize = 0;

  const pushCsv = (part: string): boolean => {
    csvParts.push(part);
    csvSize += part.length;
    return csvSize <= maxCsvBytes;
  };

  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });

      if (decided === null) {
        head += text;
        // A short first chunk is not enough to tell XML from CSV.
        if (head.length < 2048) continue;
        decided = decideFormat(head);
        if (decided === 'xml') xml.push(head);
        else if (!pushCsv(head)) return tooLargeCsv(maxCsvBytes);
        head = '';
      } else if (decided === 'xml') {
        xml.push(text);
      } else if (!pushCsv(text)) {
        return tooLargeCsv(maxCsvBytes);
      }

      if (decided === 'xml' && xml.tooLarge) return tooLargeRecords();
    }
    // Flush a trailing partial character and decide the format for a short file.
    const tail = decoder.decode();
    if (decided === null) {
      head += tail;
      decided = decideFormat(head);
      if (decided === 'xml') xml.push(head);
      else if (!pushCsv(head)) return tooLargeCsv(maxCsvBytes);
    } else if (decided === 'xml') {
      xml.push(tail);
    } else if (!pushCsv(tail)) {
      return tooLargeCsv(maxCsvBytes);
    }
  } finally {
    reader.releaseLock();
  }

  if (xml.tooLarge) return tooLargeRecords();

  if (decided === 'xml') {
    const days = xml.days.build();
    const plan: WearableImportPlan = {
      format: 'apple-health-xml',
      days,
      counts: xml.counts,
      sources: xml.sourceTallies,
      issues: xml.problems.issues,
      issueCount: xml.problems.issueCount,
      notes: [],
    };
    plan.notes = notesFor(plan);
    return { ok: true, plan, preview: previewFor(fileName, plan) };
  }

  return parseWearableCsv(csvParts.join(''), fileName);
}

function decideFormat(head: string): 'xml' | 'csv' {
  const trimmed = head.replace(/^\uFEFF/, '').trimStart();
  if (trimmed.startsWith('<?xml') || trimmed.startsWith('<HealthData') || trimmed.includes('<Record')) return 'xml';
  return 'csv';
}

function tooLargeRecords(): WearableParseResult {
  return {
    ok: false,
    code: 'too_large',
    error: `That file has more than ${MAX_WEARABLE_RECORDS.toLocaleString()} records. Import it in parts.`,
  };
}

function tooLargeCsv(maxBytes: number): WearableParseResult {
  return {
    ok: false,
    code: 'too_large',
    error: `That CSV is larger than ${Math.round(maxBytes / 1024 / 1024)} MB. Import it in parts.`,
  };
}

/**
 * Reads a CSV with a date column plus a temperature and/or weight column.
 *
 * Everything about quoting, a BOM, a bare CR inside a field and a header that is
 * not on line 1 is `parseCsv`'s job (`src/lib/csv.ts`); this only maps columns to
 * values and folds them into days.
 */
export function parseWearableCsv(text: string, fileName = 'wearable-export'): WearableParseResult {
  const { rows, unclosedQuote, rowCount } = parseCsv(text);
  if (rowCount === 0) return { ok: false, code: 'empty', error: 'That file is empty.' };
  if (unclosedQuote) {
    return {
      ok: false,
      code: 'truncated',
      error: 'That file ends inside a quoted field, so the download looks truncated. Export it again and retry.',
    };
  }

  const headerIndex = rows.findIndex((row) => row.length >= 2 && findColumns(row) !== null);
  if (headerIndex < 0) {
    return {
      ok: false,
      code: 'unrecognised',
      error: 'That does not look like a health export: no header row with a “date” column was found.',
    };
  }

  const header = rows[headerIndex]!;
  const columns = findColumns(header)!;
  const ringconn = looksLikeRingConnExport(fileName, header);
  const format: WearableFormat = ringconn ? 'ringconn-export' : 'csv';

  if (columns.temperature === null && columns.weight === null) {
    return {
      ok: false,
      code: 'unrecognised',
      error: ringconn
        ? 'This is a RingConn app export, and it has no temperature column — the ring keeps its skin temperature inside the app. See the card above for where to get a temperature from instead.'
        : 'That file has a date column but no temperature or weight column, so there is nothing this app can store.',
    };
  }

  const problems = new Problems();
  const counts = emptyCounts();
  const days = new DayStore();
  let dataRows = 0;

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i]!;
    const rowNumber = i + 1; // 1-based record number in the file.
    if (row.every((cell) => cell.trim() === '')) continue;
    dataRows += 1;
    if (dataRows > MAX_WEARABLE_RECORDS) {
      return {
        ok: false,
        code: 'too_large',
        error: `That file has more than ${MAX_WEARABLE_RECORDS.toLocaleString()} data rows. Import it in parts.`,
      };
    }
    counts.recordsRead += 1;

    const rawDate = (row[columns.date] ?? '').trim().slice(0, 10);
    if (!isValidDateOnly(rawDate)) {
      problems.report({
        row: rowNumber,
        column: header[columns.date] ?? 'date',
        value: (row[columns.date] ?? '').trim() || null,
        message: rawDate
          ? `“${rawDate}” is not a date; row skipped.`
          : 'Row has no date; row skipped.',
      });
      continue;
    }

    if (columns.temperature !== null) {
      const raw = (row[columns.temperature] ?? '').trim();
      if (raw !== '') {
        const value = numberIn(raw);
        const celsius = value === null ? null : celsiusFrom(value, raw);
        if (celsius === null || celsius < MIN_TEMPERATURE_C || celsius > MAX_TEMPERATURE_C) {
          problems.report({
            row: rowNumber,
            column: header[columns.temperature] ?? 'temperature',
            value: raw,
            message:
              celsius === null
                ? `“${raw}” is not a temperature in °C or °F; left empty.`
                : `${round2(celsius)} °C is outside the plausible range ${MIN_TEMPERATURE_C}–${MAX_TEMPERATURE_C} °C; left empty.`,
          });
        } else {
          counts.temperature += 1;
          days.addTemperature(rawDate, round2(celsius), canonical(header[columns.temperature]!), 0, null);
        }
      }
    }

    if (columns.weight !== null) {
      const raw = (row[columns.weight] ?? '').trim();
      if (raw !== '') {
        const value = numberIn(raw);
        const kg = value === null ? null : kilogramsFrom(value, raw);
        if (kg === null || kg < MIN_WEIGHT_KG || kg > MAX_WEIGHT_KG) {
          problems.report({
            row: rowNumber,
            column: header[columns.weight] ?? 'weight',
            value: raw,
            message:
              kg === null
                ? `“${raw}” is not a weight in kg or lb; left empty.`
                : `${round2(kg)} kg is outside the plausible range ${MIN_WEIGHT_KG}–${MAX_WEIGHT_KG} kg; left empty.`,
          });
        } else {
          counts.weight += 1;
          days.addWeight(rawDate, round2(kg));
        }
      }
    }
  }

  const plan: WearableImportPlan = {
    format,
    days: days.build(),
    counts,
    sources: [],
    issues: problems.issues,
    issueCount: problems.issueCount,
    notes: [],
  };
  plan.notes = notesFor(plan);
  return { ok: true, plan, preview: previewFor(fileName, plan) };
}

/** Convenience wrapper for a string in hand — used by the tests and the CSV path. */
export async function parseWearableText(text: string, fileName = 'wearable-export'): Promise<WearableParseResult> {
  return parseWearableStream(new Response(text).body as ReadableStream<Uint8Array>, { fileName });
}

/* -------------------------------------------------------------------------- */
/* explaining an empty result                                                 */
/* -------------------------------------------------------------------------- */

/**
 * What to tell the user when a file parsed but carries nothing importable.
 *
 * This is a real answer to a real question — "I exported my ring's data, why did
 * nothing happen?" — so it names the two true reasons rather than saying "0 rows
 * imported", which is the kind of message that makes a user think the app is
 * broken.
 */
export function explainEmptyImport(plan: WearableImportPlan): string {
  if (plan.format === 'ringconn-export') {
    return 'The RingConn app’s own export has no temperature or weight column, so there is nothing here to import. Use an Apple Health export instead — the card above says how.';
  }
  if (plan.format === 'apple-health-xml') {
    const sources = plan.sources.length
      ? `What each app wrote: ${plan.sources.map((s) => `${s.name} ${s.temperature} temperature of ${s.records.toLocaleString()} records`).join(', ')}.`
      : 'No app in this export wrote anything recognisable.';
    return `That export was read, but no day carried a temperature or a weight. ${sources}`;
  }
  return 'That file was read, but no row carried a usable temperature or weight.';
}
