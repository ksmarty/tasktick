'use client';

/**
 * The focus timer's defaults.
 *
 * Four numbers, saved on change. Steppers fire once per press, so the writes are
 * coalesced through a 400 ms debounce with the pending fields merged: pressing
 * "focus +" five times sends one PATCH with the final value instead of five
 * racing ones, and the timer itself re-reads these values the next time it is
 * idle.
 *
 * Material has no numeric stepper, so the control is two `IconButton`s around an
 * `<output>`. The accessible names and the `aria-live` announcement are the ones
 * the old `Stepper` exposed: a `group` named by its label, `Decrease`/`Increase`
 * buttons, and a polite live region for the value.
 */
import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import { api, errorMessage } from '@/lib/api-client';
import { invalidate } from '@/lib/store';
import { useToast } from '@/components/app/Toast';
import { SettingsGroup } from './SettingsGroup';
import type { UserSettings } from '@/lib/types';

/** Milliseconds of quiet before the coalesced PATCH goes out. */
export const FOCUS_SAVE_DEBOUNCE_MS = 400;

export interface FocusSettingsProps {
  settings: UserSettings;
}

export function FocusSettings({ settings }: FocusSettingsProps) {
  const { toast } = useToast();

  // The steppers are controlled by a local draft: the PATCH is debounced, so the
  // server value would otherwise lag a press by a whole round trip and the
  // control would appear frozen.
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);

  const pending = useRef<Partial<UserSettings>>({});
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  function queue(patch: Partial<UserSettings>) {
    setDraft((current) => ({ ...current, ...patch }));
    pending.current = { ...pending.current, ...patch };
    if (timer.current !== null) window.clearTimeout(timer.current);

    timer.current = window.setTimeout(() => {
      const body = pending.current;
      pending.current = {};
      timer.current = null;

      void api
        .patch<UserSettings>('/api/settings', body)
        .then(() => {
          invalidate('/api/settings');
          invalidate('/api/bootstrap');
        })
        .catch((error: unknown) => {
          toast({ title: 'Could not save the timer settings', description: errorMessage(error), variant: 'error' });
        });
    }, FOCUS_SAVE_DEBOUNCE_MS);
  }

  return (
    <SettingsGroup
      title="Focus defaults"
      footer={`The timer starts each phase at these lengths and offers a long break after every ${draft.pomodoroLongBreakEvery} completed focus sessions.`}
    >
      <NumberRow
        label="Focus"
        stepperLabel="Focus minutes"
        value={draft.pomodoroFocus}
        min={1}
        max={180}
        formatValue={(value) => `${value} min`}
        onChange={(value) => queue({ pomodoroFocus: value })}
      />
      <NumberRow
        label="Short break"
        stepperLabel="Short break minutes"
        value={draft.pomodoroShortBreak}
        min={1}
        max={60}
        formatValue={(value) => `${value} min`}
        onChange={(value) => queue({ pomodoroShortBreak: value })}
      />
      <NumberRow
        label="Long break"
        stepperLabel="Long break minutes"
        value={draft.pomodoroLongBreak}
        min={1}
        max={120}
        formatValue={(value) => `${value} min`}
        onChange={(value) => queue({ pomodoroLongBreak: value })}
      />
      <NumberRow
        label="Long break every"
        stepperLabel="Sessions before a long break"
        value={draft.pomodoroLongBreakEvery}
        min={1}
        max={12}
        formatValue={(value) => `${value}×`}
        onChange={(value) => queue({ pomodoroLongBreakEvery: value })}
      />

      <ListItem>
        <FormControlLabel
          sx={{ m: 0, flex: 1, justifyContent: 'space-between' }}
          labelPlacement="start"
          label="Start breaks automatically"
          control={
            <Switch
              checked={draft.pomodoroAutoStartBreaks}
              onChange={(_event, checked) => queue({ pomodoroAutoStartBreaks: checked })}
              slotProps={{ input: { 'aria-label': 'Start breaks automatically' } }}
            />
          }
        />
      </ListItem>
    </SettingsGroup>
  );
}

/** One `label … − value +` row. */
function NumberRow({
  label,
  stepperLabel,
  value,
  min,
  max,
  formatValue,
  onChange,
}: {
  label: string;
  stepperLabel: string;
  value: number;
  min: number;
  max: number;
  formatValue: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <ListItem>
      <ListItemText primary={label} />
      <NumberStepper
        label={stepperLabel}
        value={value}
        min={min}
        max={max}
        formatValue={formatValue}
        onChange={onChange}
      />
    </ListItem>
  );
}

/**
 * `− value +`, as an ARIA group.
 *
 * Each button disables and dims itself at its own bound, so the user can see
 * which direction is still available.
 */
function NumberStepper({
  label,
  value,
  min,
  max,
  formatValue,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  formatValue: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const canDecrease = value > min;
  const canIncrease = value < max;

  return (
    <Box role="group" aria-label={label} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
      <IconButton
        aria-label={`Decrease ${label}`}
        disabled={!canDecrease}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        <RemoveIcon fontSize="small" aria-hidden />
      </IconButton>

      <Typography
        component="output"
        aria-live="polite"
        variant="body1"
        sx={{ minWidth: 56, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}
      >
        {formatValue(value)}
      </Typography>

      <IconButton
        aria-label={`Increase ${label}`}
        disabled={!canIncrease}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        <AddIcon fontSize="small" aria-hidden />
      </IconButton>
    </Box>
  );
}
