'use client';

/**
 * The one menu behind the list screen's header button: filtering and sorting.
 *
 * They are two halves of the same question — "what is in this list, and in what
 * order" — so they share a sheet rather than a filter button plus a separate
 * sort select that the user had to find on its own.
 *
 * Each filter dimension is a single-choice list, so the URL state can only ever
 * hold one of each, and the active sort is a single-choice list too. Picking any
 * row applies it and closes the sheet — see `choose` below.
 */
import type { ReactNode } from 'react';
import { ArrowDownWideNarrow, Check, Flag } from 'lucide-react';
import { SectionHeader, Sheet } from '@/components/ui';
import { cn } from '@/lib/cn';
import { accentHex } from '@/lib/colors';
import type { List, Tag } from '@/lib/types';
import { TASK_SORTS, TASK_WINDOWS, type TaskViewState } from './filters';
import { PRIORITY_ITEMS } from './priority';

export interface TaskFilterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: TaskViewState;
  lists: readonly List[];
  tags: readonly Tag[];
  onChange: (patch: Partial<TaskViewState>) => void;
}

interface OptionRowProps {
  selected: boolean;
  label: string;
  onSelect: () => void;
  leading?: ReactNode;
  first?: boolean;
}

function OptionRow({ selected, label, onSelect, leading, first = false }: OptionRowProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex min-h-11 w-full items-center gap-3 px-4 text-body pressable-row',
        !first && 'hairline-t',
      )}
    >
      {leading ?? <span aria-hidden className="size-5 shrink-0" />}
      <span className={cn('min-w-0 flex-1 truncate text-left', selected ? 'text-tint' : 'text-label')}>{label}</span>
      {selected ? <Check className="size-5 shrink-0 text-tint" aria-hidden /> : null}
    </button>
  );
}

export function TaskFilterSheet({ open, onOpenChange, state, lists, tags, onChange }: TaskFilterSheetProps) {
  /**
   * Applies a choice, then gets out of the way.
   *
   * Every row here is a single choice that takes effect behind the sheet, so
   * there is nothing left to do once it has been picked — leaving the sheet up
   * made the user dismiss a menu they had already finished with. The patch goes
   * in first, so the list behind is already updated when the sheet slides away.
   *
   * Sort closes too. It is the same kind of row as the filters — one choice out
   * of a fixed set — and a user comparing two orders is served better by one
   * consistent rule than by a special case they have to learn: pick, look, and
   * reopen in one tap if it was not the one.
   */
  function choose(patch: Partial<TaskViewState>) {
    onChange(patch);
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Filter & Sort" dismissible>
      <div className="pb-4">
        <SectionHeader title="Due" className="px-0 pt-2 pb-2" />
        <div role="radiogroup" aria-label="Due window" className="grouped">
          {TASK_WINDOWS.map((option, index) => (
            <OptionRow
              key={option.value}
              first={index === 0}
              selected={state.window === option.value}
              label={option.label}
              onSelect={() => choose({ window: option.value })}
            />
          ))}
        </div>

        <SectionHeader title="Priority" className="px-0 pt-6 pb-2" />
        <div role="radiogroup" aria-label="Priority" className="grouped">
          {PRIORITY_ITEMS.map((item, index) => (
            <OptionRow
              key={item.value}
              first={index === 0}
              selected={state.priority === item.value}
              label={item.label}
              leading={<Flag className={cn('size-5 shrink-0', item.text)} aria-hidden />}
              onSelect={() => choose({ priority: state.priority === item.value ? null : item.value })}
            />
          ))}
        </div>

        {lists.length ? (
          <>
            <SectionHeader title="Lists" className="px-0 pt-6 pb-2" />
            <div role="radiogroup" aria-label="List" className="grouped">
              <OptionRow
                first
                selected={state.listId === null}
                label="All lists"
                onSelect={() => choose({ listId: null })}
              />
              {lists.map((list) => (
                <OptionRow
                  key={list.id}
                  selected={state.listId === list.id}
                  label={list.name}
                  leading={
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: accentHex(list.color) }}
                    />
                  }
                  onSelect={() => choose({ listId: state.listId === list.id ? null : list.id })}
                />
              ))}
            </div>
          </>
        ) : null}

        {tags.length ? (
          <>
            <SectionHeader title="Tags" className="px-0 pt-6 pb-2" />
            <div role="radiogroup" aria-label="Tag" className="grouped">
              {tags.map((tag, index) => (
                <OptionRow
                  key={tag.id}
                  first={index === 0}
                  selected={state.tagId === tag.id}
                  label={`#${tag.name}`}
                  onSelect={() => choose({ tagId: state.tagId === tag.id ? null : tag.id })}
                />
              ))}
            </div>
          </>
        ) : null}

        <SectionHeader title="Sort" className="px-0 pt-6 pb-2" />
        <div role="radiogroup" aria-label="Sort" className="grouped">
          {TASK_SORTS.map((option, index) => (
            <OptionRow
              key={option.value}
              first={index === 0}
              selected={state.sort === option.value}
              label={option.label}
              leading={<ArrowDownWideNarrow className="size-5 shrink-0 text-secondary" aria-hidden />}
              onSelect={() => choose({ sort: option.value })}
            />
          ))}
        </div>
      </div>
    </Sheet>
  );
}
