/**
 * Human words for the period contract's enums and dates.
 *
 * The stored vocabulary is deliberately machine-shaped (`egg_white`, `hormonal_iud`,
 * `period-today`) because it is also CSV import/export vocabulary and a user may
 * type it into a spreadsheet. Nothing in the interface should show a user an
 * underscore, so every enum is spelled out here once instead of in each screen —
 * a second copy is how "Spotted" and "spotting" end up in the same list.
 *
 * Where the contract defines an order (`PERIOD_FLOW_LEVELS`, `PERIOD_SYMPTOMS`,
 * `PERIOD_MOODS`, `LH_TEST_RESULTS`, `CERVICAL_MUCUS_TYPES`), these maps are keyed
 * by the same constants and the order comes from those arrays, so a value added
 * to the contract cannot silently go missing from the UI.
 */
import {
  CERVICAL_MUCUS_TYPES,
  CONTRACEPTION_DAY_STATUSES,
  CONTRACEPTION_METHODS,
  LH_TEST_RESULTS,
  PERIOD_FLOW_LEVELS,
  PERIOD_MOODS,
  PERIOD_SYMPTOMS,
  type CervicalMucus,
  type ContraceptionDayStatus,
  type ContraceptionMethod,
  type LhTestResult,
  type PeriodFlow,
} from '@/lib/period-types';

export const FLOW_LABEL: Record<PeriodFlow, string> = {
  none: 'None',
  spotting: 'Spotting',
  light: 'Light',
  medium: 'Medium',
  heavy: 'Heavy',
};

/**
 * Short forms for the chips.
 *
 * The five flow values have to fit one row at 390px. "Spotting" is the long one
 * and is kept in full where there is room (the summary line, the CSV), while the
 * chip uses the word people use out loud.
 */
export const FLOW_CHIP_LABEL: Record<PeriodFlow, string> = {
  none: 'None',
  spotting: 'Spot',
  light: 'Light',
  medium: 'Medium',
  heavy: 'Heavy',
};

export const LH_LABEL: Record<LhTestResult, string> = {
  negative: 'Negative',
  positive: 'Positive',
  peak: 'Peak',
  invalid: 'Invalid',
};

export const MUCUS_LABEL: Record<CervicalMucus, string> = {
  dry: 'Dry',
  sticky: 'Sticky',
  creamy: 'Creamy',
  watery: 'Watery',
  egg_white: 'Egg white',
};

/**
 * Contraception method names, in the contract's own order.
 *
 * `fertility_awareness` is listed under its own name rather than folded into
 * "other" because a user who tracks a cycle to avoid pregnancy is the one case
 * where the prediction's meaning is most easily misread.
 */
export const METHOD_LABEL: Record<ContraceptionMethod, string> = {
  pill: 'The pill',
  ring: 'Vaginal ring',
  patch: 'Patch',
  implant: 'Implant',
  injection: 'Injection',
  hormonal_iud: 'Hormonal IUD',
  copper_iud: 'Copper IUD',
  condom: 'Condom',
  withdrawal: 'Withdrawal',
  fertility_awareness: 'Fertility awareness',
  sterilization: 'Sterilisation',
  none: 'None',
  other: 'Other',
};

export const DAY_STATUS_LABEL: Record<ContraceptionDayStatus, string> = {
  on: 'On',
  off: 'Off',
  taken: 'Taken',
  missed: 'Missed',
  late: 'Late',
  placebo: 'Placebo',
  removed: 'Removed',
};

/** A symptom's display name: `breast_tenderness` -> `Breast tenderness`. */
export function humanise(value: string): string {
  const words = value.replace(/_/g, ' ').trim();
  return words.length === 0 ? value : words[0].toUpperCase() + words.slice(1);
}

/** The chip order, taken from the contract's arrays so nothing can be dropped. */
export const FLOW_OPTIONS = PERIOD_FLOW_LEVELS;
export const LH_OPTIONS = LH_TEST_RESULTS;
export const MUCUS_OPTIONS = CERVICAL_MUCUS_TYPES;
export const METHOD_OPTIONS = CONTRACEPTION_METHODS;
export const DAY_STATUS_OPTIONS = CONTRACEPTION_DAY_STATUSES;

/**
 * The symptoms the UI suggests, subdivided.
 *
 * `PERIOD_SYMPTOMS` is one flat list of thirteen, which at 390px is three rows of
 * chips before the user has logged anything. The split is presentation only — the
 * stored value is the flat list, and a user can add their own word to either
 * group — but it means the common ones (cramps, headache, bloating) are in the
 * first row instead of sharing it with constipation.
 */
export const SYMPTOM_GROUPS: { title: string; values: readonly string[] }[] = [
  { title: 'Common', values: PERIOD_SYMPTOMS.slice(0, 5) },
  { title: 'Also', values: PERIOD_SYMPTOMS.slice(5) },
];

export const MOOD_OPTIONS = PERIOD_MOODS;

/**
 * Display names for the suggested vocabularies.
 *
 * The chip rows are built from the contract's arrays, so every value it offers is
 * offered here — and every one of them needs a word rather than its storage form.
 * `breast_tenderness` on a chip is a bug the eye slides past because the chip still
 * works; these maps are what stop it, and `humanise` is the fallback for a value
 * the user imported that we do not know.
 */
export const SYMPTOM_LABELS: Record<string, string> = Object.fromEntries(
  PERIOD_SYMPTOMS.map((symptom) => [symptom, humanise(symptom)]),
);

export const MOOD_LABELS: Record<string, string> = Object.fromEntries(
  PERIOD_MOODS.map((mood) => [mood, humanise(mood)]),
);

/** `'2025-10-14'` -> `14 Oct`. */
export function shortDate(date: string): string {
  const [, month, day] = date.split('-');
  return `${Number(day)} ${MONTH_SHORT[Number(month) - 1]}`;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `'2025-10-14'` -> `14 Oct 2025`. */
export function longDate(date: string): string {
  const [year] = date.split('-');
  return `${shortDate(date)} ${year}`;
}

/**
 * A date range as words: `14–17 Oct`, `28 Oct – 2 Nov`.
 *
 * The prediction is a range, and the whole point of showing it as one is that a
 * single date is a lie. The en dash is the same glyph the range uses; the year is
 * omitted until the range crosses one, which keeps the common case short enough
 * for one line at 390px.
 */
export function rangeLabel(start: string, end: string): string {
  if (start === end) return longDate(start);
  const [startYear] = start.split('-');
  const [endYear] = end.split('-');
  if (startYear !== endYear) return `${longDate(start)} – ${longDate(end)}`;
  const [, startMonth, startDay] = start.split('-');
  const [, endMonth, endDay] = end.split('-');
  if (startMonth === endMonth) {
    return `${Number(startDay)}–${Number(endDay)} ${MONTH_SHORT[Number(endMonth) - 1]}`;
  }
  return `${shortDate(start)} – ${shortDate(end)}`;
}

/** Signed days, for `± 3 days`. */
export function plusMinus(days: number): string {
  return `± ${days} ${days === 1 ? 'day' : 'days'}`;
}

const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Days between two floating dates.
 *
 * A plain comparison on `YYYY-MM-DD` strings via their UTC midnight, with no
 * timezone involved: both operands are floating days, which is exactly the case
 * where a zone would be wrong rather than merely redundant. This is *not* cycle
 * maths — it is "how many days is this range", used to say "in 4 days" or
 * "2 days late" about a value the server already computed.
 */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** The weekday of a floating date. */
export function weekdayShort(date: string): string {
  return WEEKDAY_SHORT[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

/** The full weekday of a floating date. */
export function weekdayLong(date: string): string {
  return WEEKDAY_LONG[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

/** `'2025-10-14'` -> `Tue 14 Oct`. */
export function weekdayDateLabel(date: string): string {
  return `${weekdayShort(date)} ${shortDate(date)}`;
}

/**
 * A relative phrase for a future date, and none for a past one.
 *
 * `daysBetween` is used in the direction the caller means, so the wording lives
 * at the call site rather than in a generic helper that would have to guess
 * whether "0" means today or now.
 */
export function inDaysLabel(date: string, today: string): string {
  const days = daysBetween(today, date);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 0) return `${Math.abs(days)} days ago`;
  return `in ${days} days`;
}
