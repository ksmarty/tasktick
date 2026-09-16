'use client';

/**
 * The focus timer's defaults.
 *
 * Four numbers, saved on change. Steppers fire once per press, so the writes are
 * coalesced through a 400 ms debounce with the pending fields merged: pressing
 * "focus +" five times sends one PATCH with the final value instead of five
 * racing ones, and the timer itself re-reads these values the next time it is
 * idle.
 */
import { useEffect, useRef, useState } from 'react';
import { Switch, Stepper, useToast } from '@/components/ui';
import { api, errorMessage } from '@/lib/api-client';
import { invalidate } from '@/lib/store';
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
      <div className="flex min-h-11 items-center justify-between gap-3 px-4 py-2">
        <span className="text-body text-label">Focus</span>
        <Stepper
          label="Focus minutes"
          value={draft.pomodoroFocus}
          min={1}
          max={180}
          onChange={(value) => queue({ pomodoroFocus: value })}
          formatValue={(value) => `${value} min`}
        />
      </div>

      <div className="hairline-t flex min-h-11 items-center justify-between gap-3 px-4 py-2">
        <span className="text-body text-label">Short break</span>
        <Stepper
          label="Short break minutes"
          value={draft.pomodoroShortBreak}
          min={1}
          max={60}
          onChange={(value) => queue({ pomodoroShortBreak: value })}
          formatValue={(value) => `${value} min`}
        />
      </div>

      <div className="hairline-t flex min-h-11 items-center justify-between gap-3 px-4 py-2">
        <span className="text-body text-label">Long break</span>
        <Stepper
          label="Long break minutes"
          value={draft.pomodoroLongBreak}
          min={1}
          max={120}
          onChange={(value) => queue({ pomodoroLongBreak: value })}
          formatValue={(value) => `${value} min`}
        />
      </div>

      <div className="hairline-t flex min-h-11 items-center justify-between gap-3 px-4 py-2">
        <span className="text-body text-label">Long break every</span>
        <Stepper
          label="Sessions before a long break"
          value={draft.pomodoroLongBreakEvery}
          min={1}
          max={12}
          onChange={(value) => queue({ pomodoroLongBreakEvery: value })}
          formatValue={(value) => `${value}×`}
        />
      </div>

      <div className="hairline-t px-4 py-2">
        <Switch
          label="Start breaks automatically"
          checked={draft.pomodoroAutoStartBreaks}
          onCheckedChange={(value) => queue({ pomodoroAutoStartBreaks: value })}
        />
      </div>
    </SettingsGroup>
  );
}
