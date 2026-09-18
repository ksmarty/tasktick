'use client';

/**
 * The sort menu: in what order the list is shown.
 *
 * The sort used to be the last section of the combined Filter & Sort sheet. It
 * is its own control now, driven by the header's sort label (the quiet
 * `Smart` / `Due date` / … button), so the answer to "what order is this list
 * in?" is both visible without opening anything and changeable in one tap.
 *
 * The overlay is the same GodUI `Drawer` the filter menu uses — content-height,
 * swipe-down to dismiss, scrim, scroll lock, Escape — so the two halves read as
 * one system.
 *
 * The sort is a single choice out of a fixed set, so picking a row applies it
 * and closes the menu, exactly as a filter row does.
 */
import { CheckIcon } from '@svg-animated-icons/react/check';
import { ArrowUpDown } from 'lucide-react';
import { Drawer } from '@/components/godui/drawer';
import { cn } from '@/lib/utils';
import { TASK_SORTS, type TaskViewState } from './filters';

export interface TaskSortMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: TaskViewState;
  onChange: (patch: Partial<TaskViewState>) => void;
}

export function TaskSortMenu({ open, onOpenChange, state, onChange }: TaskSortMenuProps) {
  function choose(sort: TaskViewState['sort']) {
    onChange({ sort });
    onOpenChange(false);
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      side="bottom"
      title="Sort"
      className="max-h-[70dvh] p-0 px-card pt-2 pb-[max(1rem,env(safe-area-inset-bottom,0px))]"
    >
      <div role="radiogroup" aria-label="Sort">
        {TASK_SORTS.map((option) => {
          const selected = state.sort === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => choose(option.value)}
              className={cn(
                'flex min-h-11 w-full items-center gap-3 rounded-lg px-row py-2 text-left',
                selected ? 'text-primary' : 'text-foreground',
              )}
            >
              <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>
                <ArrowUpDown className="size-5 text-muted-foreground" aria-hidden />
              </span>
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
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
