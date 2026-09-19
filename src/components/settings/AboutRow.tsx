'use client';

/**
 * Which version is running.
 *
 * Read from a build-time constant rather than fetched: it is baked into the
 * bundle, so it cannot disagree with the code that is actually running — and the
 * standalone image does not ship `package.json`, so a runtime read would work in
 * development and fail in the container, which is the one place the question is
 * asked. There is a `for-the-user` reason too: the first thing anyone does when
 * something looks wrong is check what they are running.
 */
import { InfoCircledIcon } from '@svg-animated-icons/react/info-circled';
import { SettingsGroup, SettingsRow } from './SettingsGroup';

export function AboutRow() {
  const version = process.env.APP_VERSION ?? 'dev';

  return (
    <SettingsGroup title="About" footer="Include this when reporting a problem.">
      <SettingsRow>
        <span aria-hidden className="inline-flex shrink-0 text-base text-muted-foreground">
          <InfoCircledIcon />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">TaskTick</p>
          <p className="text-xs text-muted-foreground">
            Version <span className="tabular-nums">{version}</span>
          </p>
        </div>
      </SettingsRow>
    </SettingsGroup>
  );
}
