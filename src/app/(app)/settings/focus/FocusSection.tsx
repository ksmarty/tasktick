'use client';

/**
 * The Focus section, shared by `/settings/focus` and its legacy
 * `/settings/advanced` alias.
 *
 * The two routes show the same controls and, since the settings header became
 * constant (see `../layout`), they now present identically — there is no longer a
 * title to parameterise. The body lives here so the two pages cannot drift apart.
 *
 * The alias still marks Focus as the active section: the controls are Focus's,
 * whatever the URL says, and clicking Focus in the section list canonicalises the
 * URL to `/settings/focus`.
 *
 * A `flex flex-col gap-stack` column inset by `px-gutter`, like every other
 * settings section.
 */
import { Skeleton } from '@/components/ui/skeleton';
import { useResource } from '@/lib/store';
import { FocusSettings } from '@/components/settings/FocusSettings';
import type { BootstrapPayload } from '@/lib/view-types';

export function FocusSection() {
  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');

  return (
    <div className="flex flex-col gap-stack px-gutter pt-4 pb-6">
      {!bootstrap.data ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <FocusSettings settings={bootstrap.data.settings} />
      )}
    </div>
  );
}
