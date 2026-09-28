/**
 * Period settings → Log sections: the switches for the Today form.
 *
 * A route of its own, like every other section, so a deep link selects both nav
 * rows and the header stays constant (`app/(app)/period/settings/layout.tsx`
 * publishes it once).
 */
import { PeriodSectionsSection } from '@/components/period/TodaySectionsSettings';

export default function PeriodSectionsSettingsPage() {
  return <PeriodSectionsSection />;
}
