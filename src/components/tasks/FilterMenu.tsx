'use client';

/**
 * The filter sheet behind the list screen's filter button.
 *
 * One group per filter dimension, each a single-choice list, so the URL state can
 * only ever hold one of each — which is exactly what the chips row in the list
 * header is able to describe and clear.
 */
import type { ReactNode } from 'react';
import { Check, Flag } from 'lucide-react';
import { SectionHeader, Sheet } from '@/components/ui';
import { cn } from '@/lib/cn';
import { accentHex } from '@/lib/colors';
import type { List, Tag } from '@/lib/types';
import { TASK_WINDOWS, type TaskViewState } from './filters';
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
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Filter" dismissible>
      <div className="pb-4">
        <SectionHeader title="Due" className="px-0 pt-2 pb-2" />
        <div role="radiogroup" aria-label="Due window" className="grouped">
          {TASK_WINDOWS.map((option, index) => (
            <OptionRow
              key={option.value}
              first={index === 0}
              selected={state.window === option.value}
              label={option.label}
              onSelect={() => onChange({ window: option.value })}
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
              onSelect={() => onChange({ priority: state.priority === item.value ? null : item.value })}
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
                onSelect={() => onChange({ listId: null })}
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
                  onSelect={() => onChange({ listId: state.listId === list.id ? null : list.id })}
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
                  onSelect={() => onChange({ tagId: state.tagId === tag.id ? null : tag.id })}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
