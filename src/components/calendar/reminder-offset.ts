/**
 * Reminder offsets, in the one representation the calendar already stores.
 *
 * An event's `reminders` is a plain `number[]` of **minutes before the
 * occurrence** — see `CalendarEvent.reminders` and the iCalendar codec
 * (`parseReminders` stores `-seconds / 60`, `valarmLines` renders `-PT…M`). `0`
 * is "at the start"; a positive value counts back. That is exactly what the
 * editor's preset buttons compile to, so a custom reminder is another number in
 * the same list rather than a second representation.
 *
 * A custom reminder is a **relative offset** and not an absolute instant because
 * the event model and the CalDAV round trip can only carry a relative
 * `TRIGGER`: `parseReminders` skips a trigger that is not relative (`Only
 * relative TRIGGERs can be expressed as "minutes before"`), so an absolute value
 * stored here would be silently dropped on the next sync. An offset also counts
 * back from *each* occurrence of a recurring event, which is the behaviour an
 * event user expects and which an absolute instant cannot express.
 *
 * The task-side `Reminder` record (`offsetMinutes` / `absoluteAtMs` /
 * `fireAtMs`) is deliberately not reused: it belongs to tasks, whose rows go
 * through a scheduler and whose API accepts an absolute reminder. An event has
 * no such field, and inventing one would be the second representation this
 * avoids.
 *
 * 100 800 minutes (70 days) is the bound `createEventSchema` enforces on the
 * wire, so the picker refuses anything larger instead of letting the server
 * reject the whole save with a 422.
 */

export const MAX_REMINDER_MINUTES = 100_800;

export const REMINDER_UNITS = [
  { value: 'minutes', label: 'Minutes', minutes: 1 },
  { value: 'hours', label: 'Hours', minutes: 60 },
  { value: 'days', label: 'Days', minutes: 1440 },
] as const;

export type ReminderUnit = (typeof REMINDER_UNITS)[number]['value'];

/** "At the start", "45 min before", "2 hours before", "1 day before". */
export function formatReminderOffset(minutes: number): string {
  if (minutes <= 0) return 'At the start';
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} ${days === 1 ? 'day' : 'days'} before`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} before`;
  }
  return `${minutes} min before`;
}

/**
 * The offsets in a reminder list that the presets do not already cover — the
 * ones that need their own removable chip rather than a toggle button.
 */
export function customReminderOffsets(reminders: readonly number[], presets: readonly number[]): number[] {
  return reminders.filter((minutes) => !presets.includes(minutes)).sort((a, b) => a - b);
}

/**
 * What an amount + unit compiles to, or a message to show under the field.
 *
 * The bound and the integer check live here rather than inline so they can be
 * tested without a renderer, and so the picker and the schema cannot disagree
 * about what a valid reminder is.
 */
export function reminderOffsetFrom(
  amount: number,
  unit: ReminderUnit,
): { ok: true; minutes: number } | { ok: false; error: string } {
  if (!Number.isInteger(amount) || amount < 1) {
    return { ok: false, error: 'Enter a whole number of 1 or more.' };
  }
  const factor = REMINDER_UNITS.find((candidate) => candidate.value === unit)?.minutes ?? 1;
  const minutes = amount * factor;
  if (minutes > MAX_REMINDER_MINUTES) {
    return { ok: false, error: 'A reminder can be at most 70 days before the event.' };
  }
  return { ok: true, minutes };
}
