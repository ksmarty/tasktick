'use client';

/**
 * Settings → Period tracking.
 *
 * The opt-in lives here, in the app's own settings area, under its own section, so
 * that enabling the mode and finding it again are the same journey. It is
 * deliberately reachable *without* the mode being on — it is where the mode is
 * turned on from.
 *
 * The card is the same component the period interface uses for its own switch, so
 * "turn it off" exists in both places and means exactly the same thing in both.
 */
import { PeriodModeCard } from '@/components/period/PeriodModeCard';

export default function SettingsPeriodPage() {
  return (
    <div className="flex flex-col gap-stack px-gutter pt-4 pb-6">
      <PeriodModeCard />
    </div>
  );
}
