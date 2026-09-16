'use client';

/**
 * Reminder picker: the eight offsets everyone actually uses, multi-selectable.
 *
 * Offsets are stored the way the server expects them — minutes *added* to the
 * due instant — so "5 minutes before" is `-5`.
 */
import { Bell, Check } from 'lucide-react';
import { Sheet } from '@/components/ui';
import { cn } from '@/lib/cn';

export interface ReminderOffset {
  offsetMinutes: number;
  label: string;
}

export const REMINDER_OFFSETS: readonly ReminderOffset[] = [
  { offsetMinutes: 0, label: 'At time of due date' },
  { offsetMinutes: -5, label: '5 minutes before' },
  { offsetMinutes: -10, label: '10 minutes before' },
  { offsetMinutes: -15, label: '15 minutes before' },
  { offsetMinutes: -30, label: '30 minutes before' },
  { offsetMinutes: -60, label: '1 hour before' },
  { offsetMinutes: -120, label: '2 hours before' },
  { offsetMinutes: -1440, label: '1 day before' },
];

/** One-line summary of a task's reminders, for the row that opens this sheet. */
export function describeReminders(offsets: readonly number[]): string {
  if (offsets.length === 0) return 'None';
  return offsets
    .map((offset) => REMINDER_OFFSETS.find((item) => item.offsetMinutes === offset)?.label ?? `${offset} minutes before`)
    .join(', ');
}

export interface ReminderPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Currently selected offsets, in minutes relative to the due instant. */
  value: readonly number[];
  /** Relative reminders cannot fire without a due date, so they are refused. */
  hasDueDate: boolean;
  onChange: (offsets: number[]) => void;
}

export function ReminderPicker({ open, onOpenChange, value, hasDueDate, onChange }: ReminderPickerProps) {
  function toggle(offset: number) {
    if (!hasDueDate) return;
    const next = value.includes(offset) ? value.filter((item) => item !== offset) : [...value, offset].sort((a, b) => b - a);
    onChange(next);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Reminders" dismissible>
      <div className="pb-2">
        <div className="grouped">
          {REMINDER_OFFSETS.map((item, index) => {
            const selected = value.includes(item.offsetMinutes);
            return (
              <button
                key={item.offsetMinutes}
                type="button"
                role="checkbox"
                aria-checked={selected}
                aria-disabled={!hasDueDate || undefined}
                onClick={() => toggle(item.offsetMinutes)}
                className={cn(
                  'flex min-h-11 w-full items-center gap-3 px-4 text-body',
                  index > 0 && 'hairline-t',
                  hasDueDate ? 'pressable-row' : 'opacity-40',
                )}
              >
                <Bell
                  className={cn('size-5 shrink-0', selected ? 'text-tint' : 'text-secondary')}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-left text-label">{item.label}</span>
                {selected ? <Check className="size-5 shrink-0 text-tint" aria-hidden /> : null}
              </button>
            );
          })}
        </div>

        <p className="px-4 pt-3 text-footnote text-secondary">
          {hasDueDate
            ? 'Each selected offset fires a notification before the task is due.'
            : 'Add a due date first — a reminder with nothing to count back from would never fire.'}
        </p>
      </div>
    </Sheet>
  );
}
