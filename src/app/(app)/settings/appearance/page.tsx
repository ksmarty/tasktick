'use client';

/**
 * Appearance: the theme, and the inert accent preference.
 *
 * The theme control applies immediately and persists to `/api/settings` so the
 * choice follows the account. The accent picker is disabled on purpose — the
 * Celestial Sapphire palette is monochrome, so it has nothing to recolour — and
 * the explanation lives beside it in `AppearanceSettings`.
 *
 * A `flex flex-col gap-stack` column inset by `px-gutter`, like every other
 * settings section.
 */
import { AppearanceSettings } from '@/components/settings/AppearanceSettings';
import { MotionSettings } from '@/components/settings/MotionSettings';

export default function AppearanceSettingsPage() {
  return (
    <div className="flex flex-col gap-stack px-gutter pt-4 pb-6">
      <AppearanceSettings />
      <MotionSettings />
    </div>
  );
}
