'use client';

/**
 * The legacy `/settings/advanced` route.
 *
 * Advanced used to be a catch-all holding Focus, Data and the instance facts.
 * Those are now their own sections, but `/settings/advanced` must keep working:
 * the focus timer links to it ("Change in Settings"), and it is a bookmarked
 * URL. Rather than orphan it — or leave a redirect, which the served-page smoke
 * test treats as a failure — it renders the Focus controls through the shared
 * `FocusSection`.
 *
 * The section navigation marks Focus as the active section, because that is what
 * the controls are; the header is the area's constant "Settings", as on every
 * other section. Clicking Focus canonicalises the URL to `/settings/focus`.
 */
import { FocusSection } from '../focus/FocusSection';

export default function AdvancedSettingsPage() {
  return <FocusSection />;
}
