'use client';

/**
 * List picker: the user's projects, plus "No list" for tasks that belong only to
 * the inbox.
 */
import type { ReactNode } from 'react';
import { CheckIcon } from '@svg-animated-icons/react/check';
import { Inbox } from 'lucide-react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { accentHex } from '@/lib/colors';
import type { List as TaskList } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface ListPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lists: readonly TaskList[];
  value: string | null;
  onChange: (listId: string | null) => void;
  /** Offers a "No list" row. Off for the bulk "Move to" action. */
  allowNone?: boolean;
  title?: string;
}

interface OptionRowProps {
  selected: boolean;
  label: string;
  leading: ReactNode;
  onSelect: () => void;
}

function OptionRow({ selected, label, leading, onSelect }: OptionRowProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex min-h-11 w-full items-center gap-3 rounded-lg px-row py-2 text-left',
        selected ? 'text-primary' : 'text-foreground',
      )}
    >
      <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>
        {leading}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {selected ? (
        <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>
          <CheckIcon className="size-5" />
        </span>
      ) : null}
    </button>
  );
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        aria-label={title}
        aria-modal={true}
        className="max-h-[90vh] gap-0 overflow-y-auto rounded-t-2xl p-card pb-[max(1rem,env(safe-area-inset-bottom,0px))]"
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>

        <h2 className="pb-2 text-lg font-semibold text-foreground">{title}</h2>

        <div role="radiogroup" aria-label={title}>
          {allowNone ? (
            <OptionRow
              selected={value === null}
              label="No list"
              leading={<Inbox className="size-5 text-muted-foreground" aria-hidden />}
              onSelect={() => choose(null)}
            />
          ) : null}

          {lists.map((list) => (
            <OptionRow
              key={list.id}
              selected={list.id === value}
              label={list.name}
              leading={
                list.emoji ? (
                  <span className="flex size-5 items-center justify-center text-base">{list.emoji}</span>
                ) : (
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: accentHex(list.color) }}
                  />
                )
              }
              onSelect={() => choose(list.id)}
            />
          ))}
        </div>

        {lists.length === 0 ? (
          <p className="pt-3 text-xs text-muted-foreground">You have no lists yet.</p>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
