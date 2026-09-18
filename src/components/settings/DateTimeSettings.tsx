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
 *
 * The two pickers keep the semantics they had: the long timezone list and the
 * two-value week start stay `Select`s, and the clock format — a genuine either/or
 * pair — is the GodUI `SegmentedControl`, which is what the MUI `ToggleButtonGroup`
 * was standing in for.
 */
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SegmentedControl, type SegmentedOption } from '@/components/godui/segmented-control';
import { api } from '@/lib/api-client';
import { useMutation } from '@/lib/store';
import { formatTime, nowIn } from '@/lib/dates';
import { useToast } from '@/components/app/Toast';
import { SettingsGroup, SettingsRow } from './SettingsGroup';
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

const CLOCK_FORMAT_OPTIONS: SegmentedOption[] = [
  { value: '24h', label: '24-hour' },
  { value: '12h', label: '12-hour' },
];

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
      <SettingsRow stacked>
        <Label htmlFor="settings-timezone">Time zone</Label>
        <Select value={settings.timezone} onValueChange={(zone) => void persist.run({ timezone: zone })}>
          <SelectTrigger id="settings-timezone" className="w-full">
            <SelectValue />
          </SelectTrigger>
          {/* `popper` so a four-hundred-entry zone list scrolls in a box sized to
              the viewport instead of stretching to the selected item. */}
          <SelectContent position="popper">
            {zones.map((zone) => (
              <SelectItem key={zone} value={zone}>
                {zone}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {localZone && localZone !== settings.timezone ? (
          <Button
            variant="link"
            size="sm"
            className="h-auto self-start p-0"
            onClick={() => void persist.run({ timezone: localZone })}
          >
            Use this device&apos;s zone ({localZone})
          </Button>
        ) : null}
      </SettingsRow>

      <SettingsRow stacked>
        <Label htmlFor="settings-week-start">Start of week</Label>
        <Select
          value={String(settings.weekStartsOn)}
          onValueChange={(value) => void persist.run({ weekStartsOn: value === '1' ? 1 : 0 })}
        >
          <SelectTrigger id="settings-week-start" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="1">Monday</SelectItem>
            <SelectItem value="0">Sunday</SelectItem>
          </SelectContent>
        </Select>
      </SettingsRow>

      <SettingsRow>
        <span id="clock-format-label" className="min-w-0 flex-1 text-sm font-medium">
          Clock format
        </span>
        <SegmentedControl
          aria-labelledby="clock-format-label"
          options={CLOCK_FORMAT_OPTIONS}
          value={settings.timeFormat}
          onChange={(value) => void persist.run({ timeFormat: value === '12h' ? '12h' : '24h' })}
        />
      </SettingsRow>
    </SettingsGroup>
  );
}
