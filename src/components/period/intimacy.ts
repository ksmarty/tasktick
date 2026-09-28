/**
 * How a recorded intimacy is worded, everywhere it is shown.
 *
 * Three states, not two: `protected`, `unprotected`, and *remembered but not
 * stated* — the last being what a day recorded through the old boolean reads as.
 * It gets its own words on purpose. Rendering that row as "No" would be a lie
 * about data the user entered, and rendering it as "Yes" would drop the
 * distinction the whole field exists for, so the day detail says what actually
 * happened: sex was recorded, and nobody said which kind.
 *
 * A pure function with its own test, because the calendar's day detail, the log
 * form and the future anything-else must not disagree about what a null
 * protection means — the value is null in two different situations and the
 * difference is the `intimacy` flag beside it.
 *
 * A day may hold several occurrences of different kinds, and one level cannot
 * describe them, so `intimacyLabel` counts them instead. The repository leaves
 * `intimacyProtection` null in that case for exactly this reason.
 */
import { INTIMACY_PROTECTION, type PeriodDayLog } from '@/lib/period-types';

/** The chip and row wording for each protection value. */
export const INTIMACY_PROTECTION_LABEL: Record<(typeof INTIMACY_PROTECTION)[number], string> = {
  protected: 'Protected',
  unprotected: 'Unprotected',
};

/** A day's intimacy fields, as this module reads them. */
type IntimacyFields = Pick<PeriodDayLog, 'intimacy' | 'intimacyProtection'> &
  Partial<Pick<PeriodDayLog, 'intimacyOccurrences'>>;

/**
 * The words for a day's record, or null when there is nothing to say.
 *
 * Several occurrences cannot be summarised by one protection level — the
 * repository stores `intimacyProtection: null` for a mixed day on purpose — so
 * they are counted instead. The single-occurrence and legacy cases still read as
 * one value, or as "Recorded (not stated)" for a row written before protection
 * was a field.
 */
export function intimacyLabel(log: IntimacyFields | null | undefined): string | null {
  if (!log?.intimacy) return null;
  const occurrences = log.intimacyOccurrences ?? [];
  if (occurrences.length > 1) {
    const protectedCount = occurrences.filter((entry) => entry === 'protected').length;
    const unprotectedCount = occurrences.filter((entry) => entry === 'unprotected').length;
    const unstatedCount = occurrences.length - protectedCount - unprotectedCount;
    const parts: string[] = [];
    if (protectedCount > 0) parts.push(`${protectedCount} protected`);
    if (unprotectedCount > 0) parts.push(`${unprotectedCount} unprotected`);
    if (unstatedCount > 0) parts.push(`${unstatedCount} not stated`);
    return `${occurrences.length} occurrences (${parts.join(', ')})`;
  }
  const protection = log.intimacyProtection ?? null;
  if (protection === null) return 'Recorded (not stated)';
  return INTIMACY_PROTECTION_LABEL[protection];
}

/**
 * True for an occurrence where nobody said which kind.
 *
 * Used by the form to explain itself rather than to nag: a day recorded before
 * protection existed is complete enough, and the sentence exists so the user
 * knows the app has not lost it. With several occurrences it is true when any of
 * them is unstated.
 */
export function hasUnstatedProtection(log: IntimacyFields | null | undefined): boolean {
  if (log?.intimacy !== true) return false;
  const occurrences = log.intimacyOccurrences ?? [];
  if (occurrences.length > 0) return occurrences.some((entry) => entry === null);
  return (log.intimacyProtection ?? null) === null;
}
