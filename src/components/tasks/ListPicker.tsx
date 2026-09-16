'use client';

/**
 * List picker: the user's projects, plus "No list" for tasks that belong only to
 * the inbox.
 */
import { Check, Inbox } from 'lucide-react';
import { Sheet } from '@/components/ui';
import { cn } from '@/lib/cn';
import { accentHex } from '@/lib/colors';
import type { List } from '@/lib/types';

export interface ListPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lists: readonly List[];
  value: string | null;
  onChange: (listId: string | null) => void;
  /** Offers a "No list" row. Off for the bulk "Move to" action. */
  allowNone?: boolean;
  title?: string;
}

export function ListPicker({
  open,
  onOpenChange,
  lists,
  value,
  onChange,
  allowNone = true,
  title = 'List',
}: ListPickerProps) {
  function choose(listId: string | null) {
    onChange(listId);
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} dismissible>
      <div className="pb-2">
        <div role="radiogroup" aria-label={title} className="grouped">
          {allowNone ? (
            <button
              type="button"
              role="radio"
              aria-checked={value === null}
              onClick={() => choose(null)}
              className="flex min-h-11 w-full items-center gap-3 px-4 text-body pressable-row"
            >
              <Inbox className="size-5 shrink-0 text-secondary" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-left text-label">No list</span>
              {value === null ? <Check className="size-5 shrink-0 text-tint" aria-hidden /> : null}
            </button>
          ) : null}

          {lists.map((list, index) => {
            const selected = list.id === value;
            return (
              <button
                key={list.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => choose(list.id)}
                className={cn(
                  'flex min-h-11 w-full items-center gap-3 px-4 text-body pressable-row',
                  (index > 0 || allowNone) && 'hairline-t',
                )}
              >
                {list.emoji ? (
                  <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>
                    {list.emoji}
                  </span>
                ) : (
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: accentHex(list.color) }}
                  />
                )}
                <span className="min-w-0 flex-1 truncate text-left text-label">{list.name}</span>
                {selected ? <Check className="size-5 shrink-0 text-tint" aria-hidden /> : null}
              </button>
            );
          })}
        </div>

        {lists.length === 0 ? (
          <p className="px-4 pt-3 text-footnote text-secondary">You have no lists yet.</p>
        ) : null}
      </div>
    </Sheet>
  );
}
