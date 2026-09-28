'use client';

/**
 * Appearance: the theme, the accent preference, motion, and the period switch.
 *
 * The theme control applies immediately and persists to `/api/settings` so the
 * choice follows the account. The accent picker is disabled on purpose — the
 * Celestial Sapphire palette is monochrome, so it has nothing to recolour — and
 * the explanation lives beside it in `AppearanceSettings`.
 *
 * Period tracking is here rather than in a section of its own: enabling it is a
 * look/behaviour choice (a whole second interface) rather than a feature with
 * its own settings, and the user asked for its switch to sit under Appearance.
 * The detailed period settings still live inside the mode, on `/period/settings`.
 *
 * A `flex flex-col gap-stack` column inset by `px-gutter`, like every other
 * settings section.
 */
import { AppearanceSettings } from '@/components/settings/AppearanceSettings';
import { MotionSettings } from '@/components/settings/MotionSettings';
import { PeriodModeCard } from '@/components/period/PeriodModeCard';

export default function AppearanceSettingsPage() {
  return (
    <div className="flex flex-col gap-stack px-gutter pt-4 pb-6">
      <AppearanceSettings />
      <PeriodModeCard />
      <MotionSettings />
    </div>
  );
}
