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
 */
import { INTIMACY_PROTECTION, type PeriodDayLog } from '@/lib/period-types';

/** The chip and row wording for each protection value. */
export const INTIMACY_PROTECTION_LABEL: Record<(typeof INTIMACY_PROTECTION)[number], string> = {
  protected: 'Protected',
  unprotected: 'Unprotected',
};

/** The words for a day's record, or null when there is nothing to say. */
export function intimacyLabel(log: Pick<PeriodDayLog, 'intimacy' | 'intimacyProtection'> | null | undefined): string | null {
  if (!log?.intimacy) return null;
  const protection = log.intimacyProtection ?? null;
  if (protection === null) return 'Recorded (not stated)';
  return INTIMACY_PROTECTION_LABEL[protection];
}

/**
 * True for the one state a user can be nudged to complete.
 *
 * Used by the form to explain itself rather than to nag: a day recorded before
 * protection existed is complete enough, and the sentence exists so the user
 * knows the app has not lost it.
 */
export function hasUnstatedProtection(
  log: Pick<PeriodDayLog, 'intimacy' | 'intimacyProtection'> | null | undefined,
): boolean {
  return log?.intimacy === true && (log.intimacyProtection ?? null) === null;
}
