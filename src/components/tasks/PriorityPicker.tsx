'use client';

/**
 * Priority picker: the four flags, in the colours the row and the bulk bar use.
 *
 * The overlay is the GodUI `Drawer` — the app's bottom sheet, with
 * swipe-down-to-dismiss and a content-height panel — matching the other pickers.
 */
import { CheckIcon } from '@svg-animated-icons/react/check';
import { Flag } from 'lucide-react';
import { Drawer } from '@/components/godui/drawer';
import type { Priority } from '@/lib/types';
import { cn } from '@/lib/utils';
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
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      side="bottom"
      title={title}
      className="max-h-[70dvh] p-0 px-card pt-2 pb-[max(1rem,env(safe-area-inset-bottom,0px))]"
    >
      <div role="radiogroup" aria-label="Priority">
        {PRIORITY_ITEMS.map((item) => {
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
                'flex min-h-11 w-full items-center gap-3 rounded-lg px-row py-2 text-left',
                selected ? 'text-primary' : 'text-foreground',
              )}
            >
              <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>
                <Flag className={cn('size-5', item.color)} aria-hidden />
              </span>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {selected ? (
                <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>
                  <CheckIcon className="size-5" />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </Drawer>
  );
}
