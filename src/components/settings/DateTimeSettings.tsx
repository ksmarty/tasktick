'use client';

/**
 * Date and time preferences.
 *
 * The timezone list comes from the browser (`Intl.supportedValuesOf('timeZone')`)
 * rather than a bundled table, which keeps it correct as the IANA database moves
 * and costs nothing to ship. Where that API is missing (older Safari) a curated
 * short list plus the current zone is used instead of an empty picker.
 *
 * Every change saves immediately — these are single-choice rows with nothing to
 * confirm — and the preview line underneath shows the effect of both the zone and
 * the clock format together, so "12h in Tokyo" can be verified at a glance.
 */
import { Select, SegmentedControl, useToast } from '@/components/ui';
import { api } from '@/lib/api-client';
import { useMutation } from '@/lib/store';
import { formatTime, nowIn } from '@/lib/dates';
import { SettingsGroup } from './SettingsGroup';
import type { UserSettings } from '@/lib/types';

/** Zones offered when `Intl.supportedValuesOf` is unavailable. */
const FALLBACK_ZONES = [
  'UTC',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Paris',
  'Europe/Stockholm',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
];

interface IntlWithValues {
  supportedValuesOf?: (key: 'timeZone') => string[];
}

/** Every zone the browser knows, current one first, plus its zone list fallback. */
export function listTimeZones(current: string): string[] {
  const intl = Intl as typeof Intl & IntlWithValues;
  let zones: string[] = [];
  try {
    zones = intl.supportedValuesOf?.('timeZone') ?? [];
  } catch {
    zones = [];
  }

  const base = zones.length > 0 ? zones : FALLBACK_ZONES;
  const all = new Set([current, ...base, 'UTC']);
  return [...all].sort((a, b) => a.localeCompare(b));
}

export interface DateTimeSettingsProps {
  settings: UserSettings;
}

export function DateTimeSettings({ settings }: DateTimeSettingsProps) {
  const { toast } = useToast();

  const persist = useMutation(
    async (patch: { timezone?: string; weekStartsOn?: 0 | 1; timeFormat?: '12h' | '24h' }) =>
      api.patch<UserSettings>('/api/settings', patch),
    {
      invalidates: ['/api/settings', '/api/bootstrap'],
      onError: (message) => toast({ title: 'Could not save that preference', description: message, variant: 'error' }),
    },
  );

  const zones = listTimeZones(settings.timezone);
  const localZone = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return null;
    }
  })();

  const preview = formatTime(nowIn(settings.timezone).toMillis(), {
    zone: settings.timezone,
    timeFormat: settings.timeFormat,
    weekStartsOn: settings.weekStartsOn,
  });

  return (
    <SettingsGroup
      title="Date and time"
      footer={`Stored once on your server, so every device agrees. Times are shown in ${settings.timezone}; it is ${preview} there now.`}
    >
      <div className="px-4 py-3">
        <Select
          value={settings.timezone}
          onChange={(value) => void persist.run({ timezone: value })}
          options={zones.map((zone) => ({ value: zone, label: zone }))}
          label="Time zone"
          sheetTitle="Time zone"
        />
        {localZone && localZone !== settings.timezone ? (
          <button
            type="button"
            className="mt-2 min-h-6 text-footnote font-semibold text-tint pressable"
            onClick={() => void persist.run({ timezone: localZone })}
          >
            Use this device&apos;s zone ({localZone})
          </button>
        ) : null}
      </div>

      <div className="hairline-t px-4 py-3">
        <Select
          value={String(settings.weekStartsOn)}
          onChange={(value) => void persist.run({ weekStartsOn: value === '1' ? 1 : 0 })}
          options={[
            { value: '1', label: 'Monday' },
            { value: '0', label: 'Sunday' },
          ]}
          label="Start of week"
          sheetTitle="Start of week"
        />
      </div>

      <div className="hairline-t px-4 py-3">
        <SegmentedControl
          options={[
            { value: '24h', label: '24-hour' },
            { value: '12h', label: '12-hour' },
          ]}
          value={settings.timeFormat}
          onChange={(value) => void persist.run({ timeFormat: value === '12h' ? '12h' : '24h' })}
          label="Clock format"
          size="sm"
        />
      </div>
    </SettingsGroup>
  );
}
