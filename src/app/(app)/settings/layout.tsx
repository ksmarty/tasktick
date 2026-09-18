/**
 * The settings area's one header.
 *
 * Every section under `/settings` is the same destination — Settings — and the
 * section list is always on screen beside (or above) the panel. A header that
 * renamed itself per section therefore told the user nothing the highlighted row
 * did not already say, and it did it at the cost of the one thing a header is
 * for: a stable place. So the title is published **once, here**, and the pages
 * below publish none. Nothing in this layout changes as the user moves between
 * sections, which is what makes the bar identical on all of them.
 *
 * ## Why a layout rather than the same string on nine pages
 *
 * A `PageHeader` per page would be nine copies of one constant, and — more to
 * the point — nine chances to unmount and remount the published content as the
 * route changes, which is exactly the churn this removes. This segment persists
 * across `/settings/*` navigation, so the header mounts once and is never
 * re-published.
 *
 * ## The back arrow is gone with it
 *
 * The sub-pages used to publish a "Back to Settings" arrow while the Account
 * landing page did not (there is nowhere to go back *to* from the root, so the
 * link was a no-op there). That inconsistency is gone with the per-page headers:
 * the section list is always visible, so a control whose only job is to return
 * to a list you can already see is redundant on every one of the nine.
 *
 * The layout renders nothing but the header publication — the pages keep their
 * own `px-gutter` column, since the calendar-style full-bleed screens and these
 * have different gutters and the shell deliberately applies neither.
 */
import { PageHeader } from '@/components/app/PageHeader';

/** The one title every settings section publishes. */
const SETTINGS_TITLE = 'Settings';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title={SETTINGS_TITLE} />
      {children}
    </>
  );
}
