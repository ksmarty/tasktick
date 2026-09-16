'use client';

/**
 * Priority picker: the four flags, in the colours the row and the bulk bar use.
 */
import { Check, Flag } from 'lucide-react';
import { Sheet } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { Priority } from '@/lib/types';
import { PRIORITY_ITEMS } from './priority';

export interface PriorityPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: Priority;
  onChange: (priority: Priority) => void;
  /** Heading; overridden by the bulk bar, which sets priority on many tasks. */
  title?: string;
}

export function PriorityPicker({ open, onOpenChange, value, onChange, title = 'Priority' }: PriorityPickerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} dismissible>
      <div role="radiogroup" aria-label="Priority" className="grouped pb-0">
        {PRIORITY_ITEMS.map((item, index) => {
          const selected = item.value === value;
          return (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                onChange(item.value);
                onOpenChange(false);
              }}
              className={cn(
                'flex min-h-11 w-full items-center gap-3 px-4 text-body pressable-row',
                index > 0 && 'hairline-t',
              )}
            >
              <Flag className={cn('size-5 shrink-0', item.text)} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-left text-label">{item.label}</span>
              {selected ? <Check className="size-5 shrink-0 text-tint" aria-hidden /> : null}
            </button>
          );
        })}
      </div>
      <div className="h-4" />
    </Sheet>
  );
}
