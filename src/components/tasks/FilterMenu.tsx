'use client';

/**
 * The filter menu: what is in the list.
 *
 * It used to share a sheet with the sort, on the theory that "what is in this
 * list, and in what order" are two halves of one question. The user disagrees —
 * a filter and an order are reached at different moments, and one full-height
 * sheet forced the same scroll for both. So there are now two menus behind two
 * header buttons; this is the filter half (see `SortMenu.tsx` for the sort).
 *
 * ## The overlay
 *
 * The panel is the GodUI `Drawer`, the app's bottom-sheet primitive (see
 * `components/godui/drawer.tsx` and the component mapping in
 * `GODUI-CONVENTIONS.md`). Unlike the shadcn `Sheet` it does not park a
 * full-height column on screen: the drawer panel is content-height, so a short
 * menu is a short rectangle, and it brings its own swipe-down-to-dismiss
 * (rubber-band drag, flick, scrim, scroll lock and Escape) rather than a
 * hand-rolled gesture. `p-0` neutralises the vendored panel's `p-5` so every
 * inset below comes from a layout token.
 *
 * ## One choice, then out of the way
 *
 * Each filter dimension is a single-choice list, so the URL state can only ever
 * hold one of each. Picking any row applies it and closes the menu — see
 * `choose` — because there is nothing left to do once it has been picked, and
 * leaving the menu up made the user dismiss a thing they had already finished
 * with. The patch goes in first, so the list behind is already updated when the
 * menu slides away.
 */
import type { ReactNode } from 'react';
import { CheckIcon } from '@svg-animated-icons/react/check';
import { Flag } from 'lucide-react';
import { Drawer } from '@/components/godui/drawer';
import { accentHex } from '@/lib/colors';
import type { List as TaskList, Tag } from '@/lib/types';
import { cn } from '@/lib/utils';
import { TASK_WINDOWS, type TaskViewState } from './filters';
import { PRIORITY_ITEMS } from './priority';

export interface TaskFilterMenuProps {
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

/** Section heading inside the menu; the menu owns the spacing, not the list. */
const HEADING_CLASS = 'pb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase';
/** The first heading follows the title, so it needs less air above it. */
const FIRST_HEADING_CLASS = 'pt-1';
const LATER_HEADING_CLASS = 'pt-4';

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

export function TaskFilterMenu({ open, onOpenChange, state, lists, tags, onChange }: TaskFilterMenuProps) {
  /** Applies a choice, then gets out of the way. */
  function choose(patch: Partial<TaskViewState>) {
    onChange(patch);
    onOpenChange(false);
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      side="bottom"
      title="Filter"
      className="max-h-[70dvh] p-0 px-card pt-2 pb-[max(0.25rem,env(safe-area-inset-bottom,0px))]"
    >
      <div className="flex flex-col">
        <h3 className={cn(FIRST_HEADING_CLASS, HEADING_CLASS)}>Due</h3>
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

        <h3 className={cn(LATER_HEADING_CLASS, HEADING_CLASS)}>Priority</h3>
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
            <h3 className={cn(LATER_HEADING_CLASS, HEADING_CLASS)}>Lists</h3>
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
            <h3 className={cn(LATER_HEADING_CLASS, HEADING_CLASS)}>Tags</h3>
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
      </div>
    </Drawer>
  );
}
