/**
 * Optional period / menstrual-cycle tracking — the shared contract.
 *
 * This file is the **interface between the period API and the UI**. It is
 * deliberately framework-free (no Drizzle, no React, no `next`), so both the
 * server repository layer and a client component can import it without pulling
 * a database driver into the bundle.
 *
 * ## API surface (all under `/api/period`, all wrapped in `{ ok, data }`)
 *
 * ```
 * GET    /api/period                          -> PeriodOverview
 * GET    /api/period/settings                 -> PeriodSettings
 * PATCH  /api/period/settings                 -> PeriodSettings
 *
 * GET    /api/period/cycles                   -> PeriodCycle[]        ?from&to
 * POST   /api/period/cycles                   -> PeriodCycle          (201)
 * GET    /api/period/cycles/[id]              -> PeriodCycle
 * PATCH  /api/period/cycles/[id]              -> PeriodCycle
 * DELETE /api/period/cycles/[id]              -> { deleted: true }
 *
 * GET    /api/period/days                     -> PeriodDayLog[]       ?from&to
 * POST   /api/period/days                     -> PeriodDayLog         (upsert by date)
 * GET    /api/period/days/[date]              -> PeriodDayLog
 * PATCH  /api/period/days/[date]              -> PeriodDayLog         (upsert by date)
 * DELETE /api/period/days/[date]              -> { deleted: true }
 *
 * GET    /api/period/contraception            -> ContraceptionMethod[]
 * POST   /api/period/contraception            -> ContraceptionMethod  (201)
 * GET    /api/period/contraception/[id]       -> ContraceptionMethod
 * PATCH  /api/period/contraception/[id]       -> ContraceptionMethod
 * DELETE /api/period/contraception/[id]       -> { deleted: true }
 * GET    /api/period/contraception/schedule   -> ContraceptionScheduleDay[] ?from&to
 * GET    /api/period/contraception/log        -> ContraceptionDayLog[] ?from&to&methodId
 * POST   /api/period/contraception/log        -> ContraceptionDayLog  (upsert)
 * DELETE /api/period/contraception/log/[date] -> { deleted: true }     ?methodId
 *
 * GET    /api/period/prediction               -> PeriodPrediction     ?asOf
 * GET    /api/period/stats                    -> PeriodStats
 *
 * GET    /api/period/csv/template             -> text/csv download
 * GET    /api/period/csv/export               -> text/csv download
 * POST   /api/period/csv/import               -> PeriodImportResult   (multipart)
 * ```
 *
 * Every date on the wire is a floating `YYYY-MM-DD` string (`DateOnly` from
 * `@/lib/types`), exactly as the rest of the app keeps all-day values. The
 * client must never re-derive cycle maths — see `period-math.ts`.
 */

import type { DateOnly } from './types';

/* -------------------------------------------------------------------------- */
/* vocabulary                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Bleeding intensity for a cycle or a single day.
 *
 * `spotting` is deliberately separate from `light`: it is the one value that
 * commonly means something other than menstruation (implantation, breakthrough
 * bleeding on a hormonal method), so collapsing it into `light` would erase the
 * distinction a user is trying to record.
 */
export const PERIOD_FLOW_LEVELS = ['none', 'spotting', 'light', 'medium', 'heavy'] as const;
export type PeriodFlow = (typeof PERIOD_FLOW_LEVELS)[number];

/** A urine ovulation (LH) test result. */
export const LH_TEST_RESULTS = ['negative', 'positive', 'peak', 'invalid'] as const;
export type LhTestResult = (typeof LH_TEST_RESULTS)[number];

/**
 * Cervical mucus, on the Billings/WHO scale used by fertility-awareness methods.
 * `egg_white` is the most fertile observation; `dry` the least.
 */
export const CERVICAL_MUCUS_TYPES = ['dry', 'sticky', 'creamy', 'watery', 'egg_white'] as const;
export type CervicalMucus = (typeof CERVICAL_MUCUS_TYPES)[number];

/**
 * Contraception methods. Split into the two families that change what a
 * prediction *means*:
 *
 *  - **Hormonal** methods suppress ovulation. While one is in use, a calendar
 *    estimate of the fertile window is not a statement about fertility at all.
 *  - **Non-hormonal** methods leave the cycle intact. A calendar estimate is
 *    still an estimate of fertility, but the calendar method alone is a poor
 *    contraceptive (typical-use failure ≈ 24% per year) and the UI must say so.
 *
 * `fertility_awareness` is its own value because a user who tracks a cycle
 * specifically to avoid pregnancy has different needs from one who does not.
 */
export const HORMONAL_CONTRACEPTION_METHODS = [
  'pill',
  'ring',
  'patch',
  'implant',
  'injection',
  'hormonal_iud',
] as const;

export const NON_HORMONAL_CONTRACEPTION_METHODS = [
  'copper_iud',
  'condom',
  'withdrawal',
  'fertility_awareness',
  'sterilization',
  'none',
] as const;

export const CONTRACEPTION_METHODS = [
  ...HORMONAL_CONTRACEPTION_METHODS,
  ...NON_HORMONAL_CONTRACEPTION_METHODS,
  'other',
] as const;
export type ContraceptionMethod = (typeof CONTRACEPTION_METHODS)[number];

/**
 * What actually happened on a given day for a given method.
 *
 * `on` / `off` are the *scheduled* states of a ring or patch (21 on, 7 off),
 * which is the "on & off days" shape; `taken` / `missed` / `late` are the
 * *reported* states of a daily pill (or a ring/patch day the user confirms).
 * `placebo` is the inactive-pill week some packs include. `none` would be
 * meaningless here — an absent row already means "nothing logged", so the
 * status set has no `none`.
 */
export const CONTRACEPTION_DAY_STATUSES = ['on', 'off', 'taken', 'missed', 'late', 'placebo', 'removed'] as const;
export type ContraceptionDayStatus = (typeof CONTRACEPTION_DAY_STATUSES)[number];

/**
 * Default symptom vocabulary, offered by the UI as chips. The stored list is
 * free-form (`string[]`) so a user is never blocked by our vocabulary, but this
 * is the set the UI should suggest and the order it should present them in.
 */
export const PERIOD_SYMPTOMS = [
  'cramps',
  'headache',
  'backache',
  'bloating',
  'breast_tenderness',
  'fatigue',
  'nausea',
  'acne',
  'cravings',
  'insomnia',
  'dizziness',
  'diarrhea',
  'constipation',
] as const;

/** Default mood vocabulary, same free-form rule as {@link PERIOD_SYMPTOMS}. */
export const PERIOD_MOODS = [
  'calm',
  'happy',
  'energetic',
  'anxious',
  'irritable',
  'sad',
  'low',
  'focused',
  'sensitive',
] as const;

/* -------------------------------------------------------------------------- */
/* entities                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One menstrual cycle, identified by its first day of bleeding.
 *
 * `endDate` is optional and inclusive: a user can log "period started" on its
 * own and fill the end in later, or never — plenty of people only record the
 * start. It is a *range* rather than one row per bleeding day because the
 * cycle length maths only ever needs the start, and the day-by-day detail lives
 * on {@link PeriodDayLog}.
 */
export interface PeriodCycle {
  id: string;
  userId: string;
  startDate: DateOnly;
  /** Inclusive last day of bleeding, or null when only the start is known. */
  endDate: DateOnly | null;
  /** Overall intensity for the cycle; per-day intensity lives on the day log. */
  flowIntensity: PeriodFlow;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PeriodCycleInput {
  startDate: DateOnly;
  endDate?: DateOnly | null;
  flowIntensity?: PeriodFlow;
  notes?: string | null;
}

export interface PeriodCycleUpdate {
  startDate?: DateOnly;
  endDate?: DateOnly | null;
  flowIntensity?: PeriodFlow;
  notes?: string | null;
}

/**
 * Observations for a single calendar day. At most one row per user per day.
 *
 * ## Why these are columns and symptoms/mood are lists
 *
 * Anything the maths may consume, or that a user filters on, is a typed column:
 * `flow`, `temperatureC`, `lhTest`, `mucus`, `intimacy`, `ovulationPain`,
 * `weightKg`. They are single-valued per day and ordinal or numeric, so the
 * prediction can read them without a join and a future model can train on them
 * directly.
 *
 * `symptoms` and `mood` are open-ended *sets* — a user may log three symptoms
 * and two moods, may invent their own, and no current computation looks at
 * them. They are stored as a JSON `string[]` rather than a tag join table
 * because there is nothing to join them to: a real `period_symptoms` table
 * would add two tables and a uniqueness constraint to buy filtering nobody has
 * asked for. The comment on `schema.sqlite.ts` records the same reasoning.
 */
export interface PeriodDayLog {
  id: string;
  userId: string;
  date: DateOnly;
  /** Bleeding on this specific day. Null means "not logged". */
  flow: PeriodFlow | null;
  symptoms: string[];
  mood: string[];
  /** Basal body temperature in °C, e.g. `36.55`. */
  temperatureC: number | null;
  lhTest: LhTestResult | null;
  mucus: CervicalMucus | null;
  /** Intercourse on this day — the observation conception maths would need. */
  intimacy: boolean;
  /** Mittelschmerz (ovulation pain). */
  ovulationPain: boolean;
  weightKg: number | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PeriodDayLogInput {
  date: DateOnly;
  flow?: PeriodFlow | null;
  symptoms?: string[] | null;
  mood?: string[] | null;
  temperatureC?: number | null;
  lhTest?: LhTestResult | null;
  mucus?: CervicalMucus | null;
  intimacy?: boolean;
  ovulationPain?: boolean;
  weightKg?: number | null;
  notes?: string | null;
}

/* -------------------------------------------------------------------------- */
/* contraception                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The on/off rhythm of a cyclic method.
 *
 * A combined oral contraceptive pack, a vaginal ring and a patch all share the
 * same shape: N days of active product followed by M days off (or placebo). The
 * canonical values are 21/7; 24/4 and continuous (7/0) also exist. Storing the
 * two numbers rather than a named schedule keeps every product representable
 * without a schema change.
 */
export interface ContraceptionSchedule {
  onDays: number;
  offDays: number;
}

/**
 * One continuous stretch of using one method. A user who switches methods has
 * two of these, and the earlier one is closed by setting `endDate` — the history
 * is never rewritten, which is what "record a method change over time" means.
 *
 * `schedule` is null for methods with no on/off rhythm (a daily pill, a copper
 * IUD) and set for a ring, a patch or a cyclic pill pack.
 */
export interface ContraceptionMethodRecord {
  id: string;
  userId: string;
  method: ContraceptionMethod;
  /** Brand or user label, e.g. "Nuvaring" or "the mini pill". */
  label: string | null;
  startDate: DateOnly;
  /** Inclusive final day of use; null means still in use. */
  endDate: DateOnly | null;
  schedule: ContraceptionSchedule | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ContraceptionMethodInput {
  method: ContraceptionMethod;
  label?: string | null;
  startDate: DateOnly;
  endDate?: DateOnly | null;
  schedule?: ContraceptionSchedule | null;
  notes?: string | null;
}

export interface ContraceptionMethodUpdate {
  method?: ContraceptionMethod;
  label?: string | null;
  startDate?: DateOnly;
  endDate?: DateOnly | null;
  schedule?: ContraceptionSchedule | null;
  notes?: string | null;
}

/** What was actually logged for one day of one method. */
export interface ContraceptionDayLog {
  id: string;
  userId: string;
  methodId: string;
  date: DateOnly;
  status: ContraceptionDayStatus;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ContraceptionDayLogInput {
  methodId: string;
  date: DateOnly;
  status: ContraceptionDayStatus;
  notes?: string | null;
}

/**
 * A generated (not stored) day of the on/off plan for a cyclic method.
 *
 * `expected` is the schedule's own answer; `logged` is what the user recorded,
 * so the UI can render "day 14 · on · taken" or "day 22 · off · missed". The
 * schedule is derived from the method's `startDate` as the anchor, never stored
 * per day — a stored expansion would go stale the moment the schedule is edited.
 */
export interface ContraceptionScheduleDay {
  methodId: string;
  date: DateOnly;
  /** 1-based day within the on/off cycle, e.g. 1..28 for 21/7. */
  cycleDay: number;
  /** `on` for an active-product day, `off` for the gap/placebo days. */
  expected: 'on' | 'off';
  /** The user's own record for that day, when there is one. */
  logged: ContraceptionDayStatus | null;
}

/* -------------------------------------------------------------------------- */
/* settings                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Whether the whole feature is switched on.
 *
 * It is off by default: the interface is separate and opt-in, as asked for. A
 * user who never enables it has no period tables written, no prediction
 * computed and no navigation entry.
 */
export interface PeriodSettings {
  enabled: boolean;
  /**
   * How many of the most recent cycles feed the prediction, or null for all of
   * them. Recent cycles describe the body a person has now; a three-year-old
   * cycle describes a body that may no longer exist. Null is the honest default
   * for someone with few cycles and the wrong one for someone with many, so the
   * UI should offer it explicitly.
   */
  predictionCycleCount: number | null;
  /**
   * Days from ovulation to the next period. 14 is the population mean; 12–14 is
   * the usual range. It is a setting rather than a constant because the luteal
   * phase is the most stable part of the cycle *for one person* and the whole
   * ovulation estimate depends on it.
   */
  lutealPhaseDays: number;
  /**
   * Whether the user is using contraception. This does not change the arithmetic
   * — it changes what the arithmetic *means*, which is why it is stored and why
   * every prediction carries a `meaning` string derived from it.
   */
  contraceptionInUse: boolean;
}

export type PeriodSettingsUpdate = Partial<PeriodSettings>;

/* -------------------------------------------------------------------------- */
/* prediction                                                                 */
/* -------------------------------------------------------------------------- */

export type PredictionConfidence = 'none' | 'low' | 'medium' | 'high';

/** How the next-cycle point estimate was produced. */
export type PeriodPredictionMethod = 'recency_weighted_luteal' | 'insufficient_data';

/**
 * Everything the prediction was derived from, so the UI can explain itself.
 *
 * A prediction the UI cannot explain is a prediction the user cannot trust, so
 * this is part of the response rather than something the UI recomputes.
 */
export interface PeriodPredictionBasis {
  /** Recorded cycles (period starts) in the window used. */
  cycleCount: number;
  /** Measured intervals between consecutive starts — one fewer than cycleCount. */
  intervalCount: number;
  /** Every measured interval, oldest first. */
  intervalLengths: number[];
  /** The subset that actually fed the estimate (after the recency slice). */
  usedIntervalLengths: number[];
  averageCycleLengthDays: number | null;
  medianCycleLengthDays: number | null;
  /** The point estimate: exponentially weighted towards recent cycles. */
  recencyWeightedMeanDays: number | null;
  shortestCycleDays: number | null;
  longestCycleDays: number | null;
  standardDeviationDays: number | null;
  lutealPhaseDays: number;
  predictionCycleCount: number | null;
  confidence: PredictionConfidence;
  /** Cycle start dates that fed the estimate, oldest first. */
  cycleStarts: DateOnly[];
  firstPeriodStart: DateOnly | null;
  lastPeriodStart: DateOnly | null;
  /** Mean bleeding length over recorded cycles that have an `endDate`. */
  averagePeriodLengthDays: number | null;
}

export interface PredictionUncertainty {
  earliest: DateOnly;
  latest: DateOnly;
  /** Half-width in days. The UI should render `date ± days`. */
  days: number;
  /** `observed` when derived from this user's own spread; `default` when not. */
  source: 'observed' | 'default';
}

export interface PredictionContraceptionContext {
  /** The user's setting, or inferred true when a hormonal method is active. */
  inUse: boolean;
  /** The method active on `asOf`, if any. */
  activeMethod: ContraceptionMethod | null;
  activeMethodId: string | null;
  hormonal: boolean;
  /** True when contraception makes a fertility prediction misleading. */
  affectsPrediction: boolean;
}

/**
 * The prediction read.
 *
 * `nextPeriodStart` is null when there is not enough recorded history to say
 * anything. It is deliberately not filled with a naive "+28 days" default: one
 * cycle is not a basis for a date, and a confident-looking wrong date is worse
 * than an honest "not yet".
 */
export interface PeriodPrediction {
  asOf: DateOnly;
  dataSufficient: boolean;
  method: PeriodPredictionMethod;
  /** Human-readable reason the prediction is unavailable, when it is. */
  reason: string | null;

  lastPeriodStart: DateOnly | null;
  /** 1-based day of the current cycle on `asOf`, or null when unknown. */
  currentCycleDay: number | null;

  predictedCycleLengthDays: number | null;

  /** The next expected period start, rolled forward if the estimate is overdue. */
  nextPeriodStart: DateOnly | null;
  /** Predicted inclusive end of that period. */
  nextPeriodEnd: DateOnly | null;
  /** `lastPeriodStart + predictedCycleLengthDays`, before any roll-forward. */
  predictedFromLastCycle: DateOnly | null;
  /** Days `predictedFromLastCycle` is in the past; null when it is not. */
  overdueDays: number | null;

  ovulationDate: DateOnly | null;
  /** True when the luteal subtraction had to be clamped into the cycle. */
  ovulationClamped: boolean;
  /** Inclusive 6-day window: 5 days before ovulation through ovulation day. */
  fertileWindow: { start: DateOnly; end: DateOnly } | null;
  /** Ogino–Knaus window from the shortest and longest observed cycles. */
  calendarMethodWindow: { start: DateOnly; end: DateOnly } | null;

  uncertainty: PredictionUncertainty | null;

  basis: PeriodPredictionBasis;
  contraception: PredictionContraceptionContext;

  /** What the numbers mean given the contraception setting. Always present. */
  meaning: string;
  /** Anything else the UI should tell the user; never a substitute for `reason`. */
  notes: string[];
}

/* -------------------------------------------------------------------------- */
/* stats                                                                      */
/* -------------------------------------------------------------------------- */

export interface PeriodStats {
  /** One entry per measured cycle interval, newest last. */
  cycleLengths: { from: DateOnly; to: DateOnly; days: number }[];
  /** Mean/min/max/std dev of {@link cycleLengths}. */
  averageCycleLengthDays: number | null;
  shortestCycleDays: number | null;
  longestCycleDays: number | null;
  standardDeviationDays: number | null;
  /** How many days carried a log, per flow value. */
  flowCounts: Record<PeriodFlow, number>;
  /** Symptom tag -> number of days it was logged. */
  symptomCounts: { symptom: string; days: number }[];
  /** `date -> °C`, ascending, only days with a temperature. */
  temperatureSeries: { date: DateOnly; temperatureC: number }[];
  /** Logged days in the window. */
  loggedDays: number;
}

/* -------------------------------------------------------------------------- */
/* overview + import                                                          */
/* -------------------------------------------------------------------------- */

/** One call for the whole screen, so a phone makes one round trip on open. */
export interface PeriodOverview {
  settings: PeriodSettings;
  cycles: PeriodCycle[];
  dayLogs: PeriodDayLog[];
  contraception: ContraceptionMethodRecord[];
  /** Day logs + generated schedule rows for the requested window. */
  schedule: ContraceptionScheduleDay[];
  prediction: PeriodPrediction;
}

/** A row-level problem in an imported CSV. Never aborts the import. */
export interface PeriodImportIssue {
  /** 1-based record number in the file, so the user can find the row. */
  row: number;
  column: string | null;
  value: string | null;
  message: string;
}

export interface PeriodImportPreview {
  fileName: string;
  /** Non-blank, non-comment records after the header. */
  dataRows: number;
  cycles: number;
  days: number;
  methods: number;
  contraceptionDays: number;
  issues: PeriodImportIssue[];
  issueCount: number;
  notes: string[];
}

export interface PeriodImportSummary {
  mode: 'commit';
  cyclesCreated: number;
  cyclesUpdated: number;
  daysCreated: number;
  daysUpdated: number;
  methodsCreated: number;
  methodsUpdated: number;
  contraceptionDaysCreated: number;
  contraceptionDaysUpdated: number;
  /** Rows the importer could not place (unknown method, duplicate date, ...). */
  skipped: number;
  issues: PeriodImportIssue[];
  issueCount: number;
  notes: string[];
}

export interface PeriodImportResult {
  mode: 'preview' | 'commit';
  preview: PeriodImportPreview;
  summary?: PeriodImportSummary;
}
