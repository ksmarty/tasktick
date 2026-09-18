'use client';

/**
 * The event editor's calendar picker: a **combobox**.
 *
 * It replaces the radiogroup the editor used to carry. The choice is the same —
 * one calendar id, committed on pick — but a list of buttons had no way to reach
 * a calendar that was not on screen, and the editor is exactly where a user with
 * several calendars has to name one quickly. Type-ahead filtering is what buys
 * that: type a few letters of the name, the list narrows, Enter commits.
 *
 * ## Why this is not the GodUI registry's `combobox`
 *
 * The registry entry was fetched and read before writing this. It is a
 * self-contained control with its own outside-press handling, its own
 * `relative w-72` shell and its own listbox chrome, and its option model is
 * `{ label, value, description }` — there is no seam for the per-calendar colour
 * dot the editor's picker has always drawn, and using it would mean vendoring a
 * new file into `components/godui` (a shared, off-limits directory) and then
 * editing it, which defeats the point of a vendored registry entry. The app
 * already has the two primitives this needs — shadcn's `Popover` for the overlay
 * and `Input`/button for the control — so the combobox is composed from those,
 * exactly as the conventions' mapping table intends, and it stays in the
 * calendar feature that owns its semantics.
 *
 * ## The value contract
 *
 * Unchanged, and deliberately so: `value` is a **calendar id** and `onChange`
 * receives a calendar id, which is the same contract the radiogroup had and the
 * same field (`draft.calendarId`) the save body carries. Nothing here knows how
 * many calendars exist, what they mean, or where they came from.
 *
 * ## The keyboard
 *
 * The trigger is the `combobox`: `aria-expanded` says whether the list is open
 * and `aria-controls` points at the listbox. Once open, the filter field owns the
 * keys — Arrow Up/Down move the active option, Home/End go to the ends, Enter
 * commits the active one, Escape (the Popover's own) closes and returns focus to
 * the trigger. The active option is published with `aria-activedescendant` on
 * the field, so a screen reader follows the highlight without focus leaving the
 * text it is typing into.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CheckIcon } from '@svg-animated-icons/react/check';
import { ChevronDownIcon } from '@svg-animated-icons/react/chevron-down';
import { MagnifyingGlassIcon } from '@svg-animated-icons/react/magnifying-glass';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { Calendar as CalendarRecord } from '@/lib/types';
import { calendarColorHex } from './colors';

export interface CalendarComboboxProps {
  /** The committed value: a calendar id. */
  value: string;
  calendars: CalendarRecord[];
  /** Called with the picked calendar's id. */
  onChange: (calendarId: string) => void;
  /** Forwarded to the trigger, so a `Label` in the caller can point at it. */
  id?: string;
  className?: string;
}

export function CalendarCombobox({ value, calendars, onChange, id, className }: CalendarComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = calendars.find((calendar) => calendar.id === value) ?? null;

  /** Type-ahead filtering over the calendar names; empty query lists them all. */
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return calendars;
    return calendars.filter((calendar) => calendar.name.toLowerCase().includes(needle));
  }, [calendars, query]);

  // Opening starts the highlight on the current selection, so Enter keeps it.
  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) {
        setQuery('');
        const index = calendars.findIndex((calendar) => calendar.id === value);
        setActive(index >= 0 ? index : 0);
      }
    },
    [calendars, value],
  );

  // Keep the highlight inside the list as the filter narrows it.
  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(0, matches.length - 1)));
  }, [matches.length]);

  const commit = useCallback(
    (calendar: CalendarRecord) => {
      onChange(calendar.id);
      setOpen(false);
    },
    [onChange],
  );

  const onInputKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((current) => Math.min(current + 1, matches.length - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((current) => Math.max(current - 1, 0));
      } else if (event.key === 'Home') {
        event.preventDefault();
        setActive(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        setActive(matches.length - 1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const match = matches[active];
        if (match) commit(match);
      }
    },
    [active, commit, matches],
  );

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={listboxId}
          aria-label="Calendar"
          className={cn(
            'flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl border border-border px-row py-2 text-left',
            className,
          )}
        >
          <span
            aria-hidden
            className="size-3 shrink-0 rounded-full"
            style={{ backgroundColor: selected ? calendarColorHex(selected) : undefined }}
          />
          <span className={cn('min-w-0 flex-1 truncate text-sm', selected ? 'font-semibold' : 'text-muted-foreground')}>
            {selected?.name ?? 'Choose a calendar'}
          </span>
          <ChevronDownIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" disableHover />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-[--radix-popover-trigger-width] overflow-hidden rounded-xl p-0"
        onOpenAutoFocus={(event) => {
          // The filter field is the list's keyboard owner; Radix's default
          // first-focusable would be the same node, but pinning it here keeps
          // that from depending on DOM order.
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <MagnifyingGlassIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" disableHover />
          <input
            ref={inputRef}
            type="text"
            aria-label="Filter calendars"
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={matches[active] ? `${listboxId}-${matches[active].id}` : undefined}
            value={query}
            placeholder="Filter calendars…"
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKeyDown}
            className="h-9 w-full min-w-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>

        <ul id={listboxId} role="listbox" aria-label="Calendars" className="max-h-64 overflow-y-auto p-1">
          {matches.map((calendar, index) => {
            const isSelected = calendar.id === value;
            return (
              <li
                key={calendar.id}
                id={`${listboxId}-${calendar.id}`}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActive(index)}
                onClick={() => commit(calendar)}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm',
                  index === active && 'bg-accent',
                )}
              >
                <span
                  aria-hidden
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: calendarColorHex(calendar) }}
                />
                <span className="min-w-0 flex-1 truncate">{calendar.name}</span>
                {isSelected ? <CheckIcon aria-hidden className="size-4 shrink-0 text-primary" /> : null}
              </li>
            );
          })}
          {matches.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">No calendars match</li>
          ) : null}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
