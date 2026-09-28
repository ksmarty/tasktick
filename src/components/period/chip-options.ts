/**
 * Pure rules for the day log's chip controls.
 *
 * Small, but not trivial enough to inline in a component: the flow slider's
 * position-to-level mapping and the question "is this recorded value still one of
 * the user's options" both have a failure mode a screenshot would not show. A
 * slider whose positions drifted from the levels writes the wrong rung; a filter
 * measured against the wrong list hides a day's value when the user edits their
 * options. So both live here, framework-free, and are tested as values rather
 * than pinned from the JSX.
 *
 * This is the same shape as `today-categories.ts` and `intimacy.ts` next to it:
 * one decision, one module, one test.
 */

/**
 * The slider position for a level: its index, or 0 for "not logged".
 *
 * `null` (nothing recorded) and `none` (recorded as no bleeding) both sit at
 * position 0, which is deliberate: the slider has to rest somewhere, and the
 * level is only written when the user actually moves it. A value the option list
 * does not contain also falls back to 0 rather than throwing — the form renders
 * unknown values in their own row, but a stale one must not break the control.
 */
export function flowPosition(options: readonly string[], value: string | null): number {
  if (value === null) return 0;
  const index = options.indexOf(value);
  return index < 0 ? 0 : index;
}

/** The level at a slider position, or null when there is no such position. */
export function flowAtPosition(options: readonly string[], position: number): string | null {
  return options[position] ?? null;
}

/**
 * Recorded values the current option list does not contain.
 *
 * This is what keeps an edited-away symptom visible: the day log stores the
 * words themselves, so a value the user has since removed from their options is
 * still rendered (as one of "your own") on the days that recorded it. Filtering
 * against the contract's fixed vocabulary instead would silently hide history.
 */
export function valuesOutsideOptions(options: readonly string[], values: readonly string[]): string[] {
  return values.filter((value) => !options.includes(value));
}
