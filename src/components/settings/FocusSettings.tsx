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
 * Neither Material nor shadcn ships a numeric stepper, so the control stays two
 * buttons around an `<output>` — the shadcn `Button` at its icon size, which is
 * the same 40px target the `IconButton` had. The accessible names and the
 * `aria-live` announcement are the ones the old `Stepper` exposed: a `group`
 * named by its label, `Decrease`/`Increase` buttons, and a polite live region for
 * the value. Each button disables itself at its own bound so it is visible which
 * direction is still available.
 */
import { useEffect, useRef, useState } from 'react';
import { MinusIcon } from '@svg-animated-icons/react/minus';
import { PlusIcon } from '@svg-animated-icons/react/plus';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { api, errorMessage } from '@/lib/api-client';
import { invalidate } from '@/lib/store';
import { useToast } from '@/components/app/Toast';
import { SettingsGroup, SettingsRow } from './SettingsGroup';
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

      <SettingsRow>
        <Label htmlFor="focus-autostart" className="min-w-0 flex-1">
          Start breaks automatically
        </Label>
        <Switch
          id="focus-autostart"
          aria-label="Start breaks automatically"
          checked={draft.pomodoroAutoStartBreaks}
          onCheckedChange={(checked) => queue({ pomodoroAutoStartBreaks: checked })}
        />
      </SettingsRow>
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
    <SettingsRow>
      <span className="min-w-0 flex-1 text-sm">{label}</span>
      <NumberStepper
        label={stepperLabel}
        value={value}
        min={min}
        max={max}
        formatValue={formatValue}
        onChange={onChange}
      />
    </SettingsRow>
  );
}

/** `− value +`, as an ARIA group. */
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
    <div role="group" aria-label={label} className="inline-flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon-lg"
        aria-label={`Decrease ${label}`}
        disabled={!canDecrease}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        <MinusIcon />
      </Button>

      <output
        aria-live="polite"
        className="min-w-14 text-center text-sm tabular-nums"
      >
        {formatValue(value)}
      </output>

      <Button
        type="button"
        variant="outline"
        size="icon-lg"
        aria-label={`Increase ${label}`}
        disabled={!canIncrease}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        <PlusIcon />
      </Button>
    </div>
  );
}
