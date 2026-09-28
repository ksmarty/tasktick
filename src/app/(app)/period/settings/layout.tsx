/**
 * The period settings' one header, and the shell it sits above.
 *
 * Like the app's own settings (`app/(app)/settings/layout.tsx`), the title is
 * published once here and never per section: the pinned section rows already say
 * which section is open, so a per-section header would rename the destination and
 * give the user no stable place. Because this segment persists across
 * `/period/settings/*` navigation, the bar mounts once and never churns as the
 * user moves between sections, and the header stays constant on a deep link.
 *
 * The navigation is a client component because it derives the open section from
 * the pathname; keeping it in the layout rather than on each page means it is
 * mounted once and never remounts as the user moves between sections.
 */
import { PageHeader } from '@/components/app/PageHeader';
import { PeriodSettingsNav } from '@/components/period/PeriodSettings';

/** The one title every period-settings section publishes. */
const PERIOD_SETTINGS_TITLE = 'Period settings';

export default function PeriodSettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader title={PERIOD_SETTINGS_TITLE} />
      <PeriodSettingsNav>{children}</PeriodSettingsNav>
    </>
  );
}