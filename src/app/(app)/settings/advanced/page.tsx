'use client';

/**
 * The legacy `/settings/advanced` route.
 *
 * Advanced used to be a catch-all holding Focus, Data and the instance facts.
 * Those are now their own sections, but `/settings/advanced` must keep working:
 * the focus timer links to it ("Change in Settings"), and it is a bookmarked
 * URL. Rather than orphan it — or leave a redirect, which the served-page smoke
 * test treats as a failure — it renders the Focus section, so the pomodoro link
 * lands on the controls it promises. The navigation marks Focus as the active
 * section, and clicking Focus canonicalises the URL to `/settings/focus`.
 */
export { default } from '../focus/page';
