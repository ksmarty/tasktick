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
import { CheckIcon } from '@svg-animated-icons/react/check';
import { ArrowUpDown, Flag } from 'lucide-react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { accentHex } from '@/lib/colors';
import type { List as TaskList, Tag } from '@/lib/types';
import { cn } from '@/lib/utils';
import { TASK_SORTS, TASK_WINDOWS, type TaskViewState } from './filters';
import { PRIORITY_ITEMS } from './priority';

export interface TaskFilterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: TaskViewState;
  lists: readonly TaskList[];
  tags: readonly Tag[];
  onChange: (patch: Partial<TaskViewState>) => void;
}

interface OptionRowProps {
  selected: boolean;
  label: string;
  onSelect: () => void;
  leading?: ReactNode;
}

/** Section heading inside the sheet; the sheet owns the spacing, not the list. */
const HEADING_CLASS = 'pb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase';
/** The first heading follows the sheet title, so it needs less air above it. */
const FIRST_HEADING_CLASS = cn('pt-2', HEADING_CLASS);
const LATER_HEADING_CLASS = cn('pt-4', HEADING_CLASS);

function OptionRow({ selected, label, onSelect, leading }: OptionRowProps) {
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        aria-label="Filter & Sort"
        aria-modal={true}
        className="max-h-[90vh] gap-0 overflow-y-auto rounded-t-2xl p-card pb-[max(1rem,env(safe-area-inset-bottom,0px))]"
      >
        <SheetTitle className="sr-only">Filter &amp; Sort</SheetTitle>

        <h2 className="pb-2 text-lg font-semibold text-foreground">Filter &amp; Sort</h2>

        <h3 className={FIRST_HEADING_CLASS}>Due</h3>
        <div role="radiogroup" aria-label="Due window">
          {TASK_WINDOWS.map((option) => (
            <OptionRow
              key={option.value}
              selected={state.window === option.value}
              label={option.label}
              onSelect={() => choose({ window: option.value })}
            />
          ))}
        </div>

        <h3 className={LATER_HEADING_CLASS}>Priority</h3>
        <div role="radiogroup" aria-label="Priority">
          {PRIORITY_ITEMS.map((item) => (
            <OptionRow
              key={item.value}
              selected={state.priority === item.value}
              label={item.label}
              leading={<Flag className={cn('size-5', item.color)} aria-hidden />}
              onSelect={() => choose({ priority: state.priority === item.value ? null : item.value })}
            />
          ))}
        </div>

        {lists.length ? (
          <>
            <h3 className={LATER_HEADING_CLASS}>Lists</h3>
            <div role="radiogroup" aria-label="List">
              <OptionRow
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
            <h3 className={LATER_HEADING_CLASS}>Tags</h3>
            <div role="radiogroup" aria-label="Tag">
              {tags.map((tag) => (
                <OptionRow
                  key={tag.id}
                  selected={state.tagId === tag.id}
                  label={`#${tag.name}`}
                  onSelect={() => choose({ tagId: state.tagId === tag.id ? null : tag.id })}
                />
              ))}
            </div>
          </>
        ) : null}

        <h3 className={LATER_HEADING_CLASS}>Sort</h3>
        <div role="radiogroup" aria-label="Sort">
          {TASK_SORTS.map((option) => (
            <OptionRow
              key={option.value}
              selected={state.sort === option.value}
              label={option.label}
              leading={<ArrowUpDown className="size-5 text-muted-foreground" aria-hidden />}
              onSelect={() => choose({ sort: option.value })}
            />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
