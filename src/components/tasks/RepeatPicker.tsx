'use client';

/**
 * Repeat picker, built from `REPEAT_PRESETS` so the rule this writes is the same
 * rule `@/lib/rrule` can describe back to the user.
 */
import { Check, Repeat } from 'lucide-react';
import { Sheet } from '@/components/ui';
import { cn } from '@/lib/cn';
import { REPEAT_PRESETS, buildRRule, describeRRule, matchPreset } from '@/lib/rrule';

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
    <Sheet open={open} onOpenChange={onOpenChange} title="Repeat" dismissible>
      <div className="pb-2">
        <div role="radiogroup" aria-label="Repeat" className="grouped">
          {REPEAT_PRESETS.map((preset, index) => {
            const selected = preset.id === current;
            return (
              <button
                key={preset.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => choose(preset.id)}
                className={cn(
                  'flex min-h-11 w-full items-center gap-3 px-4 text-body pressable-row',
                  index > 0 && 'hairline-t',
                )}
              >
                <Repeat
                  className={cn('size-5 shrink-0', selected ? 'text-tint' : 'text-secondary')}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-left text-label">{preset.label}</span>
                {selected ? <Check className="size-5 shrink-0 text-tint" aria-hidden /> : null}
              </button>
            );
          })}
        </div>

        {description ? (
          <p className="px-4 pt-3 text-footnote text-secondary">Currently: {description}.</p>
        ) : null}
      </div>
    </Sheet>
  );
}
