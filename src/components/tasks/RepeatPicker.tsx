'use client';

/**
 * Repeat picker, built from `REPEAT_PRESETS` so the rule this writes is the same
 * rule `@/lib/rrule` can describe back to the user.
 *
 * The overlay is the GodUI `Drawer`, matching the other pickers: content-height
 * panel, swipe-down to dismiss.
 */
import { CheckIcon } from '@svg-animated-icons/react/check';
import { Repeat } from 'lucide-react';
import { Drawer } from '@/components/godui/drawer';
import { REPEAT_PRESETS, buildRRule, describeRRule, matchPreset } from '@/lib/rrule';
import { cn } from '@/lib/utils';

export interface RepeatPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The task's current RRULE body, or `null` when it does not repeat. */
  value: string | null;
  /** Weekday (0 = Sunday) the weekly presets anchor on. */
  dueDay: number;
  /** `null` clears the repeat rule. */
  onChange: (rule: string | null) => void;
}

export function RepeatPicker({ open, onOpenChange, value, dueDay, onChange }: RepeatPickerProps) {
  const current = matchPreset(value, dueDay);
  const description = describeRRule(value);

  function choose(presetId: string) {
    const preset = REPEAT_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    const spec = preset.build({ dueDay, dueDate: null });
    onChange(spec ? buildRRule(spec) : null);
    onOpenChange(false);
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      side="bottom"
      title="Repeat"
      className="max-h-[70dvh] p-0 px-card pt-2 pb-[max(1rem,env(safe-area-inset-bottom,0px))]"
    >
      <div role="radiogroup" aria-label="Repeat">
        {REPEAT_PRESETS.map((preset) => {
          const selected = preset.id === current;
          return (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => choose(preset.id)}
              className={cn(
                'flex min-h-11 w-full items-center gap-3 rounded-lg px-row py-2 text-left',
                selected ? 'text-primary' : 'text-foreground',
              )}
            >
              <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>
                <Repeat
                  className={cn('size-5', selected ? 'text-primary' : 'text-muted-foreground')}
                  aria-hidden
                />
              </span>
              <span className="min-w-0 flex-1 truncate">{preset.label}</span>
              {selected ? (
                <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>
                  <CheckIcon className="size-5" />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {description ? (
        <p className="pt-3 text-xs text-muted-foreground">Currently: {description}.</p>
      ) : null}
    </Drawer>
  );
}
