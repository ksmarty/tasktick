'use client';

/**
 * Global search.
 *
 * A full-screen field that focuses itself, debounced at 250 ms so typing does not
 * issue a request per keystroke, over one flat result list that the arrow keys
 * walk across the section boundaries.
 *
 * Keyboard design: the arrow keys move *focus* onto the result buttons rather
 * than painting a separate highlight, so Enter is the button's own activation and
 * a screen reader follows the selection exactly as a sighted user sees it. The
 * field is a real `searchbox`; there is no `combobox`/`listbox` pairing because
 * these results are a page, not a dropdown, and claiming otherwise would misdescribe
 * the widget.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, Search, SearchX } from 'lucide-react';
import { EmptyState, NavBar, SectionHeader, Spinner, TextField } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useResource } from '@/lib/store';
import { todayIn } from '@/lib/dates';
import {
  SEARCH_DEBOUNCE_MS,
  SEARCH_SECTIONS,
  buildSearchResults,
  flattenResults,
  moveSelection,
  resultsFor,
  totalResults,
} from './results';
import type { BootstrapPayload, SearchPayload } from '@/lib/view-types';
import type { KeyboardEvent } from 'react';

/** The API ignores anything shorter than this, so neither do we. */
const MIN_QUERY_LENGTH = 2;

/** Debounces a value: the echo only follows once the typing pauses. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debounced;
}

export default function SearchPage() {
  const router = useRouter();

  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');
  const settings = bootstrap.data?.settings;
  const zone = settings?.timezone ?? 'utc';

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const debounced = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  const ready = debounced.length >= MIN_QUERY_LENGTH;

  const search = useResource<SearchPayload>('/api/search', { q: debounced }, { enabled: ready });

  const today = useMemo(() => todayIn(zone), [zone]);
  const groups = useMemo(
    () =>
      buildSearchResults(
        search.data,
        { zone, timeFormat: settings?.timeFormat ?? '24h', weekStartsOn: settings?.weekStartsOn ?? 1 },
        today,
      ),
    [search.data, settings?.timeFormat, settings?.weekStartsOn, today, zone],
  );

  const flat = useMemo(() => flattenResults(groups), [groups]);
  const total = totalResults(groups);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // A new result set invalidates the previous selection.
  useEffect(() => {
    setActive(-1);
  }, [debounced, search.data]);

  // Focus follows the selection, so Enter is a plain button activation.
  useEffect(() => {
    if (active < 0) return;
    itemRefs.current[active]?.focus({ preventScroll: false });
  }, [active]);

  function open(index: number) {
    const result = flat[index];
    if (!result) return;
    router.push(result.href);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const key = event.key;
    if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Home' && key !== 'End' && key !== 'Enter') return;
    if (total === 0) return;

    if (key === 'Enter') {
      // A focused result button activates itself; only the field needs help.
      if (event.target instanceof HTMLInputElement) {
        event.preventDefault();
        open(active < 0 ? 0 : active);
      }
      return;
    }

    event.preventDefault();
    setActive((current) => moveSelection(current, total, key));
  }

  return (
    //
    // No `min-h-dvh` and no opaque background.
    //
    // This view renders inside the shell's scroll pane, and the shell paints
    // `app-backdrop` behind it. A full-height opaque wrapper here would cover
    // that backdrop, so every `glass-*` surface in the view would have nothing
    // to refract and would read as flat grey. The shell also owns tab-bar
    // clearance, so `pb-8` was double-padding.
    <div onKeyDown={onKeyDown}>
      // No back control: Search is a top-level destination reached from the Tools
      // list and the More sheet, not a child of Today. A back arrow pointing at
      // Today would misrepresent where the user came from.
      <NavBar title="Search" />

      <div className="px-4 pb-2">
        <TextField
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Tasks, events and habits"
          aria-label="Search everything"
          // A search screen that does not focus its field wastes the one thing
          // the user came here to do.
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          leading={<Search className="size-5" aria-hidden />}
          trailing={search.isLoading && ready ? <Spinner size={16} label="Searching" /> : undefined}
        />
      </div>

      {!ready ? (
        <EmptyState
          icon={Search}
          title="Search everything"
          description="Type at least two characters to search across your tasks, calendar events and habits."
        />
      ) : search.error ? (
        <EmptyState icon={SearchX} title="Search failed" description={search.error} />
      ) : search.isInitialLoading ? (
        <div className="flex justify-center py-12">
          <Spinner label="Searching" />
        </div>
      ) : total === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No results"
          description={`Nothing matches “${debounced}”. Try a shorter word, or check another spelling.`}
        />
      ) : (
        <>
          {SEARCH_SECTIONS.map((section) => {
            const items = resultsFor(groups, section.kind);
            if (items.length === 0) return null;

            return (
              <section key={section.kind} aria-label={section.label}>
                <SectionHeader
                  title={section.label}
                  action={<span className="tnum text-caption-1 text-tertiary">{items.length}</span>}
                />
                <ul className="grouped mx-4">
                  {items.map((result) => {
                    const index = flat.findIndex((candidate) => candidate.key === result.key);
                    const isActive = index === active;
                    return (
                      <li key={result.key}>
                        <button
                          type="button"
                          ref={(node) => {
                            itemRefs.current[index] = node;
                          }}
                          onClick={() => open(index)}
                          onPointerEnter={() => setActive(index)}
                          className={cn(
                            'flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left pressable-row',
                            isActive && 'bg-tint-soft',
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-body text-label">{result.title}</span>
                            {result.subtitle ? (
                              <span className="mt-0.5 block truncate text-footnote text-secondary">{result.subtitle}</span>
                            ) : null}
                          </span>
                          <ChevronRight className="size-4 shrink-0 text-tertiary" aria-hidden />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}

          <p className="px-4 pt-4 text-caption-1 text-tertiary">
            {total} {total === 1 ? 'result' : 'results'} · use ↑ ↓ and Enter
          </p>
        </>
      )}
    </div>
  );
}
