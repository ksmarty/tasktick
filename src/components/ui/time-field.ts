/**
 * Floating clock-time string maths for `TimeField` — pure, no timezone work.
 *
 * A `TimeOnly` is `HH:mm`, 24-hour, with no zone. It is a wall-clock label, not
 * an instant: `08:00` means "eight in the morning wherever the user is", so
 * nothing here ever converts it.
 */
import type { TimeOnly } from '@/lib/types';

const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

export interface TimeParts {
  hour: number;
  minute: number;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Parses `HH:mm` (or `H:mm`) strictly; `null` when out of range or malformed. */
export function parseTimeOnly(value: string | null | undefined): TimeParts | null {
  if (!value) return null;
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;

  return { hour, minute };
}

/** Formats clock parts as `HH:mm`. Does not validate. */
export function formatTimeOnly(parts: TimeParts): TimeOnly {
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** Round-trips a string through parse+format, wrapping nothing — `null` if invalid. */
export function normaliseTimeOnly(value: string | null | undefined): TimeOnly | null {
  const parts = parseTimeOnly(value);
  return parts ? formatTimeOnly(parts) : null;
}

/** Minutes since midnight, or `null` for an invalid string. */
export function minutesOfDay(value: string | null | undefined): number | null {
  const parts = parseTimeOnly(value);
  return parts ? parts.hour * 60 + parts.minute : null;
}

/** Inverse of {@link minutesOfDay}; wraps values outside `0..1439`. */
export function timeOnlyFromMinutes(total: number): TimeOnly {
  const wrapped = ((Math.round(total) % 1440) + 1440) % 1440;
  return formatTimeOnly({ hour: Math.floor(wrapped / 60), minute: wrapped % 60 });
}

/** The 24 hours of the day, in order. */
export function listHours(): number[] {
  return Array.from({ length: 24 }, (_, hour) => hour);
}

/** Minute marks of the day at `step`, always including 0. */
export function listMinutes(step = 5): number[] {
  const safe = Number.isInteger(step) && step > 0 && step <= 60 ? step : 5;
  const out: number[] = [];
  for (let minute = 0; minute < 60; minute += safe) out.push(minute);
  return out;
}

/** Snaps a minute value onto the nearest `step` mark, wrapping at 60 → next hour. */
export function snapTimeToStep(value: TimeOnly, step = 5): TimeOnly {
  const parts = parseTimeOnly(value);
  if (!parts) return value;
  const safe = Number.isInteger(step) && step > 0 && step <= 60 ? step : 5;
  return timeOnlyFromMinutes(parts.hour * 60 + Math.round(parts.minute / safe) * safe);
}

/** `"14:30"` → `"2:30 PM"` or `"14:30"`. */
export function formatTimeLong(value: TimeOnly, timeFormat: '12h' | '24h' = '24h'): string {
  const parts = parseTimeOnly(value);
  if (!parts) return value;
  if (timeFormat === '24h') return formatTimeOnly(parts);

  const suffix = parts.hour < 12 ? 'AM' : 'PM';
  const hour12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
  return `${hour12}:${pad(parts.minute)} ${suffix}`;
}

/** The half-hour "day parts" iOS lists above a time wheel. */
export function dayPartOptions(): { label: string; time: TimeOnly }[] {
  return [
    { label: 'Morning', time: '09:00' },
    { label: 'Noon', time: '12:00' },
    { label: 'Afternoon', time: '15:00' },
    { label: 'Evening', time: '18:00' },
    { label: 'Night', time: '21:00' },
  ];
}
