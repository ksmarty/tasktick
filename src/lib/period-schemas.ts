/**
 * Request validation for the period-tracking API.
 *
 * Kept next to `period-types.ts` rather than added to `lib/schemas.ts` so the
 * feature is self-contained: the whole domain — types, maths, CSV, validation —
 * can be read and changed without touching a shared file.
 *
 * The enums are derived from the `as const` arrays in `period-types.ts`, so a
 * value the UI can offer is always a value the server accepts, and the two can
 * never drift.
 */
import { z } from 'zod';
import {
  CERVICAL_MUCUS_TYPES,
  CONTRACEPTION_DAY_STATUSES,
  CONTRACEPTION_METHODS,
  LH_TEST_RESULTS,
  PERIOD_FLOW_LEVELS,
} from './period-types';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date');

export const periodFlow = z.enum(PERIOD_FLOW_LEVELS);
export const lhTestResult = z.enum(LH_TEST_RESULTS);
export const cervicalMucus = z.enum(CERVICAL_MUCUS_TYPES);
export const contraceptionMethod = z.enum(CONTRACEPTION_METHODS);
export const contraceptionDayStatus = z.enum(CONTRACEPTION_DAY_STATUSES);

/** Free-form tag lists, normalised (trimmed, de-duplicated, capped) by the repo. */
const tagList = z.array(z.string().trim().min(1).max(60)).max(50);

/* -------------------------------------------------------------------------- */
/* settings                                                                   */
/* -------------------------------------------------------------------------- */

export const updatePeriodSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    /**
     * Minimum 2: a prediction needs at least one measured interval, which needs
     * two period starts. `null` means "use every recorded cycle".
     */
    predictionCycleCount: z.number().int().min(2).max(36).nullable().optional(),
    /** 9–17 covers reported luteal-phase lengths; 12–14 is the usual range. */
    lutealPhaseDays: z.number().int().min(9).max(17).optional(),
    contraceptionInUse: z.boolean().optional(),
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* cycles                                                                     */
/* -------------------------------------------------------------------------- */

const intervalOrdered = { message: 'The end date cannot be before the start date.' };

const periodCycleBase = z
  .object({
    startDate: dateOnly,
    endDate: dateOnly.nullable().optional(),
    flowIntensity: periodFlow.optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();

export const createPeriodCycleSchema = periodCycleBase.refine(
  (value) => !value.endDate || value.endDate >= value.startDate,
  intervalOrdered,
);

export const updatePeriodCycleSchema = periodCycleBase
  .partial()
  .refine((value) => !value.endDate || !value.startDate || value.endDate >= value.startDate, intervalOrdered);

/* -------------------------------------------------------------------------- */
/* day logs                                                                   */
/* -------------------------------------------------------------------------- */

export const periodDayLogSchema = z
  .object({
    date: dateOnly,
    flow: periodFlow.nullable().optional(),
    symptoms: tagList.nullable().optional(),
    mood: tagList.nullable().optional(),
    /** °C. The window rejects a Fahrenheit value pasted into a Celsius field. */
    temperatureC: z.number().min(25).max(45).nullable().optional(),
    lhTest: lhTestResult.nullable().optional(),
    mucus: cervicalMucus.nullable().optional(),
    intimacy: z.boolean().optional(),
    ovulationPain: z.boolean().optional(),
    weightKg: z.number().min(20).max(500).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();

/** A patch must be able to add a single field to an existing day. */
export const updatePeriodDayLogSchema = periodDayLogSchema.partial().omit({ date: true });

/* -------------------------------------------------------------------------- */
/* contraception                                                              */
/* -------------------------------------------------------------------------- */

export const contraceptionScheduleSchema = z
  .object({
    /** Active-product days, e.g. 21. */
    onDays: z.number().int().min(1).max(365),
    /** Gap/placebo days, e.g. 7. Zero is a continuous method. */
    offDays: z.number().int().min(0).max(365),
  })
  .strict();

const contraceptionMethodBase = z
  .object({
    method: contraceptionMethod,
    label: z.string().max(120).nullable().optional(),
    startDate: dateOnly,
    /** Null means "still using"; never omitted silently — see the repo. */
    endDate: dateOnly.nullable().optional(),
    schedule: contraceptionScheduleSchema.nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();

export const createContraceptionMethodSchema = contraceptionMethodBase.refine(
  (value) => !value.endDate || value.endDate >= value.startDate,
  intervalOrdered,
);

export const updateContraceptionMethodSchema = contraceptionMethodBase
  .partial()
  .refine((value) => !value.endDate || !value.startDate || value.endDate >= value.startDate, intervalOrdered);

export const contraceptionDayLogSchema = z
  .object({
    methodId: z.string().min(1),
    date: dateOnly,
    status: contraceptionDayStatus,
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* query helpers                                                              */
/* -------------------------------------------------------------------------- */

/** Validates a `?date=YYYY-MM-DD` or path segment, rejecting anything else. */
export function parseDateParam(value: string | undefined): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}
