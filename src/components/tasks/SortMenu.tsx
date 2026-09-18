'use client';

/**
 * The sort menu: in what order the list is shown.
 *
 * The sort used to be the last section of the combined Filter & Sort sheet, then
 * a quiet `Smart` / `Due date` / … text label in the header. It is an icon
 * button now, matching search and filter (see `TasksView`), and this drawer is
 * what that button opens.
 *
 * ## Where the direction lives
 *
 * The order has two axes: the key (`Due date`) and the way (`ascending` /
 * `descending`). The key is the radio list; the way is the two-button radiogroup
 * under it, shown only when the selected key can actually be reversed. Putting it
 * here — rather than on a hidden second tap of the trigger — is the discoverable
 * option: both states are named, both are ordinary focusable buttons, and the
 * choice is visible the moment the menu opens. The trigger still shows the
 * direction at a glance (its arrow flips), so the menu is not the only place to
 * read it. Toggling a direction leaves the menu open, because the point is to
 * watch the list behind it reorder.
 *
 * The overlay is the same GodUI `Drawer` the filter menu uses — content-height,
 * swipe-down to dismiss, scrim, scroll lock, Escape — so the two halves read as
 * one system.
 */
import { CheckIcon } from '@svg-animated-icons/react/check';
import { ArrowDownWideNarrow, ArrowUpDown, ArrowUpNarrowWide } from 'lucide-react';
import { Drawer } from '@/components/godui/drawer';
import { cn } from '@/lib/utils';
import {
  defaultSortDir,
  isDirectionalSort,
  TASK_SORTS,
  type TaskSort,
  type TaskSortDir,
  type TaskViewState,
} from './filters';

export interface TaskSortMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: TaskViewState;
  onChange: (patch: Partial<TaskViewState>) => void;
}

const DIRECTION_OPTIONS: readonly {
  value: TaskSortDir;
  label: string;
  icon: typeof ArrowUpNarrowWide;
}[] = [
  { value: 'asc', label: 'Ascending', icon: ArrowUpNarrowWide },
  { value: 'desc', label: 'Descending', icon: ArrowDownWideNarrow },
];

export function TaskSortMenu({ open, onOpenChange, state, onChange }: TaskSortMenuProps) {
  const directional = isDirectionalSort(state.sort);

  function choose(sort: TaskSort) {
    // A new key starts in its own natural direction, rather than inheriting the
    // previous key's reversal — picking `Title` should not silently give Z→A.
    onChange({ sort, sortDir: defaultSortDir(sort) });
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

      {directional ? (
        <div className="mt-2 border-t border-border pt-4">
          <h3 className="pb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Order
          </h3>
          <div role="radiogroup" aria-label="Sort direction" className="grid grid-cols-2 gap-2">
            {DIRECTION_OPTIONS.map(({ value, label, icon: Icon }) => {
              const selected = state.sortDir === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onChange({ sortDir: value })}
                  className={cn(
                    'flex min-h-11 items-center justify-center gap-2 rounded-lg border px-2 text-sm',
                    selected
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border text-muted-foreground',
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}
