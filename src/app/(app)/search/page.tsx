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
 *
 * shadcn/GodUI own the surfaces now: the magnifier is an absolutely positioned
 * adornment over a shadcn `Input`, a `<section aria-label>` per kind holds a
 * heading row and a `<ul>` of rows, and each row is a real `<button>` — which is
 * what keeps the focus-follows-selection design above working, since a button is
 * focusable and activates itself on Enter. Every button refs itself into
 * `itemRefs` by its index in the *flat* list, so the arrow keys walk the sections
 * as one list.
 *
 * Each section is wrapped in `ScrollReveal`, so an answer that arrives after the
 * debounce reads as an answer rather than as a layout jump.
 *
 * Spacing: every margin, padding and gap is a layout token (`px-gutter`,
 * `px-card`, `px-row`, `gap-stack`) or a step on Tailwind's own scale — see
 * `GODUI-CONVENTIONS.md`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { MagnifyingGlassIcon } from '@svg-animated-icons/react/magnifying-glass';
import { ChevronRight, SearchX } from 'lucide-react';
import { ScrollReveal } from '@/components/godui/scroll-reveal';
import { Input } from '@/components/ui/input';
import { useResource } from '@/lib/store';
import { todayIn } from '@/lib/dates';
import { cn } from '@/lib/utils';
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

/** The API ignores anything shorter than this, so neither do we. */
const MIN_QUERY_LENGTH = 2;

/**
 * Positions the decorative field glyph inside a `relative` input wrapper.
 *
 * The animated icons forward a `className` but no ARIA props, so the hide lives
 * on a wrapper `<span>` while the position lives on the icon. The wrapper is
 * deliberately static: the glyph then lines up against the `relative` field box
 * itself, not against a span that has no size of its own.
 */
const GLYPH =
  'pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 size-4 text-base text-muted-foreground';

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
    // No `min-h-dvh` and no opaque full-height wrapper.
    //
    // This view renders inside the shell's scrolling `main`, and the shell owns
    // the background and the tab-bar clearance. The header below is sticky
    // against that pane and paints the shell's own background colour, so a row
    // scrolling under it stays legible without a separate surface appearing at
    // the top of the screen.
    //
    // The column gap is the page's vertical rhythm, stated once here rather than
    // repeated as a bottom margin on each block.
    <div onKeyDown={onKeyDown} className="flex flex-col gap-stack">
      {/*
       * No back control: Search is a top-level destination reached from the Tools
       * list and the More sheet, not a child of Today. A back arrow pointing at
       * Today would misrepresent where the user came from.
       */}
      <header className="sticky top-0 z-appbar bg-background px-gutter pt-[calc(env(safe-area-inset-top,0px)+0.5rem)] pb-2">
        <h1 className="truncate text-lg font-semibold">Search</h1>
      </header>

      <div className="px-gutter">
        <div className="relative">
          <span aria-hidden>
            <MagnifyingGlassIcon className={GLYPH} />
          </span>
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tasks, events and habits"
            // A search screen that does not focus its field wastes the one thing
            // the user came here to do.
            autoFocus
            aria-label="Search everything"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="h-11 pr-10 pl-10"
          />
          {search.isLoading && ready ? (
            // `progressbar` + a name, as the Material spinner had: the wait is
            // announced rather than silent, and it never blocks the field.
            <span
              role="progressbar"
              aria-label="Searching"
              className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"
            />
          ) : null}
        </div>
      </div>

      {!ready ? (
        <EmptyNotice
          icon={MagnifyingGlassIcon}
          title="Search everything"
          description="Type at least two characters to search across your tasks, calendar events and habits."
        />
      ) : search.error ? (
        <EmptyNotice icon={SearchX} title="Search failed" description={search.error} />
      ) : search.isInitialLoading ? (
        <div className="flex justify-center py-6">
          {/* `status` + a name, so the wait is announced rather than silent. */}
          <span
            role="status"
            aria-label="Searching"
            className="size-10 animate-spin rounded-full border-4 border-muted-foreground/30 border-t-muted-foreground"
          />
        </div>
      ) : total === 0 ? (
        <EmptyNotice
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
              <ScrollReveal key={section.kind}>
                <section aria-label={section.label}>
                  <div className="flex items-center justify-between gap-2 px-gutter py-2">
                    <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                      {section.label}
                    </h2>
                    <span className="text-xs tabular-nums text-muted-foreground">{items.length}</span>
                  </div>

                  <ul>
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
                            // The button's own two lines are what Material
                            // computed the name from; state it explicitly so the
                            // selected row reads out the same as before.
                            aria-label={result.subtitle ? `${result.title}, ${result.subtitle}` : result.title}
                            className={cn(
                              'flex min-h-11 w-full items-center gap-3 px-row py-2 text-left outline-none transition-colors',
                              'hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring',
                              isActive && 'bg-accent',
                            )}
                          >
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="truncate text-sm">{result.title}</span>
                              {result.subtitle ? (
                                <span className="truncate text-xs text-muted-foreground">{result.subtitle}</span>
                              ) : null}
                            </span>
                            <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground/60" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              </ScrollReveal>
            );
          })}

          <p className="px-gutter text-xs text-muted-foreground">
            {total} {total === 1 ? 'result' : 'results'} · use ↑ ↓ and Enter
          </p>
        </>
      )}
    </div>
  );
}

/** The centred "nothing here" panel: a disc, a title and one sentence. */
function EmptyNotice({
  icon: Icon,
  title,
  description,
}: {
  // The animated set and lucide both take a bare `className`; that is the whole
  // contract this panel needs from an icon.
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1 px-card py-6 text-center">
      <div
        aria-hidden
        className="mb-1 flex size-14 items-center justify-center rounded-full bg-accent text-muted-foreground"
      >
        <Icon className="size-6 text-2xl" />
      </div>
      <h2 className="text-base font-medium">{title}</h2>
      <p className="max-w-72 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
