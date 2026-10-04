'use client';

/**
 * The filter field the drawer pickers share.
 *
 * Each of these pickers lists something a user may have dozens of — calendars,
 * lists, tags — and a drawer shows only a handful of rows at a time. One typed
 * word narrows the list, which is the difference between naming a thing and
 * scrolling to find it.
 *
 * It lives here, in one place, because three pickers would otherwise carry three
 * copies of the same input and the same case-insensitive `includes`, and those
 * copies drift. The *rows* stay in their own pickers: what is being filtered, and
 * what "selected" means, is different in each.
 */
import { MagnifyingGlassIcon } from '@svg-animated-icons/react/magnifying-glass';

export interface PickerFilterProps {
  value: string;
  onChange: (value: string) => void;
  /**
   * What is being filtered, plural and lower-case: used for the field's label
   * and its placeholder ("Filter calendars…").
   */
  noun: string;
}

export function PickerFilter({ value, onChange, noun }: PickerFilterProps) {
  return (
    <div className="flex items-center gap-2 border-b border-border">
      <MagnifyingGlassIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" disableHover />
      <input
        type="text"
        aria-label={`Filter ${noun}`}
        value={value}
        placeholder={`Filter ${noun}…`}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full min-w-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
