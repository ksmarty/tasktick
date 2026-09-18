'use client';

/**
 * Priority picker: the four flags, in the colours the row and the bulk bar use.
 */
import { CheckIcon } from '@svg-animated-icons/react/check';
import { Flag } from 'lucide-react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        aria-label={title}
        aria-modal={true}
        className="max-h-[90vh] gap-0 overflow-y-auto rounded-t-2xl p-card pb-[max(1rem,env(safe-area-inset-bottom,0px))]"
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>

        <h2 className="pb-2 text-lg font-semibold text-foreground">{title}</h2>

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
      </SheetContent>
    </Sheet>
  );
}
