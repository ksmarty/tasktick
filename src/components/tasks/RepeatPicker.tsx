'use client';

/**
 * Repeat picker, built from `REPEAT_PRESETS` so the rule this writes is the same
 * rule `@/lib/rrule` can describe back to the user.
 *
 * The overlay is the GodUI `Drawer`, matching the other pickers: content-height
 * panel, swipe-down to dismiss.
 */
import { useState } from 'react';
import { CheckIcon } from '@svg-animated-icons/react/check';
import { Repeat } from 'lucide-react';
import { Drawer } from '@/components/godui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { REPEAT_PRESETS, buildRRule, describeRRule, matchPreset } from '@/lib/rrule';
import { parseCron } from '@/lib/cron';
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
  /**
   * The expression last applied in advanced mode, so reopening the picker shows
   * what is in force instead of an empty box.
   */
  cron?: string;
  /** Receives the expression as typed; the server reads it into the rule. */
  onCronChange?: (cron: string) => void;
}

export function RepeatPicker({
  open,
  onOpenChange,
  value,
  dueDay,
  onChange,
  cron,
  onCronChange,
}: RepeatPickerProps) {
  const current = matchPreset(value, dueDay);
  const description = describeRRule(value);

  /*
   * Advanced mode is the escape hatch from the presets, not a second way to do
   * the same thing: "every weekday except Wednesday, at 07:30" fits no preset.
   * The expression is read as you type with the same parser the server uses, so
   * the sentence under the box is the truth about what will be stored — including
   * the refusals, in the words the API would answer with.
   */
  const [advanced, setAdvanced] = useState(Boolean(cron));
  const [expression, setExpression] = useState(cron ?? '');
  const parsed = expression.trim() ? parseCron(expression) : null;

  function choose(presetId: string) {
    const preset = REPEAT_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    const spec = preset.build({ dueDay, dueDate: null });
    onChange(spec ? buildRRule(spec) : null);
    /* A preset replaces the expression: two sources of one repeat is a bug. */
    onCronChange?.('');
    onOpenChange(false);
  }

  function applyExpression() {
    if (!parsed?.ok || !onCronChange) return;
    onCronChange(expression.trim());
    onOpenChange(false);
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      side="bottom"
      title="Repeat"
      className="max-h-[70dvh] p-0 px-card pt-2 pb-[max(0.25rem,env(safe-area-inset-bottom,0px))]"
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

      <div className="mt-3 border-t pt-3">
        <Button
          type="button"
          variant="ghost"
          className="h-8 w-full justify-start px-0 text-xs text-muted-foreground"
          aria-expanded={advanced}
          onClick={() => setAdvanced((open) => !open)}
        >
          {advanced ? 'Hide advanced (cron)' : 'Advanced (cron)'}
        </Button>

        {advanced ? (
          <div className="pt-2">
            <Label htmlFor="repeat-cron" className="text-xs text-muted-foreground">
              Five-field cron, e.g. <code>0 9 * * 1-5</code>
            </Label>
            <Input
              id="repeat-cron"
              value={expression}
              onChange={(event) => setExpression(event.target.value)}
              placeholder="minute hour day-of-month month day-of-week"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={parsed ? !parsed.ok : undefined}
              aria-describedby="repeat-cron-help"
              className="mt-1 font-mono"
            />
            <p
              id="repeat-cron-help"
              role={parsed && !parsed.ok ? 'alert' : 'status'}
              className={cn(
                'pt-1 text-xs',
                parsed && !parsed.ok ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {parsed
                ? parsed.ok
                  ? `${parsed.description}. Sets the due time and a reminder at it.`
                  : parsed.error
                : 'Reads as the repeat and the due time of the task.'}
            </p>
            <Button
              type="button"
              className="mt-2 w-full"
              disabled={!parsed?.ok}
              onClick={applyExpression}
            >
              Use this expression
            </Button>
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}
