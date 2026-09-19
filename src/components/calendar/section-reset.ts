'use client';

/**
 * "You pressed the tab you were already on — go back to today."
 *
 * ## Why this is a DOM event and not a prop
 *
 * The bottom tab bar lives in the app shell, but "today" belongs to the screen:
 * the calendar's `?date=` window and the habits screen's selected day. A screen
 * mounted on one of those tabs is the only thing that knows what its own
 * "today" is, and only one screen is mounted at a time, so the intent is a
 * one-to-many, time-scoped announcement — exactly the shape of
 * `requestPrimaryAction` in `@/lib/events`. The shell raises it, whichever
 * screen is mounted answers.
 *
 * A prop would not work here: re-tapping the active tab does not navigate, so
 * there is no new render to carry a prop, and this is the signal the shell has
 * to add. The shell side is a single call:
 *
 *     if (next === routeTab) {
 *       requestSectionReset(next);
 *       return;
 *     }
 *
 * (`calendar` and `habits` are the sections that have a "today"; the other two
 * tabs ignore the event.)
 *
 * ## Why it is not `router.push`ing the bare route
 *
 * The earlier attempt reused the calendar's `?date=` channel and pushed the bare
 * `/calendar`, leaving `CalendarScreen` to notice `initialDate === null` and
 * reset. That works in isolation, but a tab tap is not a navigation: the shell
 * short-circuits a tap on the active tab so the press is acknowledged
 * immediately, so no push reaches the screen and the reset never runs. Habits
 * has no query parameter to push at all. An explicit "reset" announcement is
 * the one channel that covers both screens.
 */
import { useEffect, useRef } from 'react';

/** The window event the shell raises when the active tab is re-tapped. */
export const SECTION_RETAP_EVENT = 'tasktick:section-retap';

/** The sections that have a "today" to return to. */
export type SectionTab = 'calendar' | 'habits';

interface SectionRetapDetail {
  tab: SectionTab;
}

/**
 * Raises "return this section to today".
 *
 * Called by the shell when the user presses the tab for the route they are
 * already on. Safe to call anywhere; a no-op during server rendering.
 */
export function requestSectionReset(tab: SectionTab): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<SectionRetapDetail>(SECTION_RETAP_EVENT, { detail: { tab } }));
}

/**
 * Runs `onReset` when the shell re-taps `tab`.
 *
 * `onReset` is held in a ref so a caller can pass an inline arrow without
 * re-subscribing the listener on every render. The callback is invoked inside
 * the dispatch, but it only moves dates around, so it does not need the
 * synchronous flush `usePrimaryAction` uses to beat the iOS keyboard.
 */
export function useSectionReset(tab: SectionTab, onReset: () => void): void {
  const latest = useRef(onReset);
  latest.current = onReset;

  useEffect(() => {
    const handler = (event: Event) => {
      if ((event as CustomEvent<SectionRetapDetail>).detail?.tab !== tab) return;
      latest.current();
    };
    window.addEventListener(SECTION_RETAP_EVENT, handler);
    return () => window.removeEventListener(SECTION_RETAP_EVENT, handler);
  }, [tab]);
}
