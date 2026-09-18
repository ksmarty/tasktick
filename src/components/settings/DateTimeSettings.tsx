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
 * two-value week start are `TextField select`, and the clock format — a genuine
 * either/or pair — is a `ToggleButtonGroup`.
 */
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ListItem from '@mui/material/ListItem';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import { api } from '@/lib/api-client';
import { useMutation } from '@/lib/store';
import { formatTime, nowIn } from '@/lib/dates';
import { useToast } from '@/components/app/Toast';
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
      <ListItem sx={{ display: 'block', px: 2, py: 1.5 }}>
        <TextField
          select
          fullWidth
          label="Time zone"
          value={settings.timezone}
          onChange={(event) => void persist.run({ timezone: event.target.value })}
        >
          {zones.map((zone) => (
            <MenuItem key={zone} value={zone}>
              {zone}
            </MenuItem>
          ))}
        </TextField>

        {localZone && localZone !== settings.timezone ? (
          <Button
            variant="text"
            size="small"
            onClick={() => void persist.run({ timezone: localZone })}
            sx={{ mt: 0.5, px: 0.5 }}
          >
            Use this device&apos;s zone ({localZone})
          </Button>
        ) : null}
      </ListItem>

      <ListItem sx={{ display: 'block', px: 2, py: 1.5 }}>
        <TextField
          select
          fullWidth
          label="Start of week"
          value={String(settings.weekStartsOn)}
          onChange={(event) => void persist.run({ weekStartsOn: event.target.value === '1' ? 1 : 0 })}
        >
          <MenuItem value="1">Monday</MenuItem>
          <MenuItem value="0">Sunday</MenuItem>
        </TextField>
      </ListItem>

      <ListItem sx={{ display: 'block', px: 2, py: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box
            component="span"
            id="clock-format-label"
            sx={{ flex: 1, minWidth: 0, typography: 'body1' }}
          >
            Clock format
          </Box>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={settings.timeFormat}
            onChange={(_event, value: '12h' | '24h' | null) => {
              if (!value) return;
              void persist.run({ timeFormat: value });
            }}
            aria-labelledby="clock-format-label"
          >
            <ToggleButton value="24h">24-hour</ToggleButton>
            <ToggleButton value="12h">12-hour</ToggleButton>
          </ToggleButtonGroup>
        </Box>
      </ListItem>
    </SettingsGroup>
  );
}
