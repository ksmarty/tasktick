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
 * Material owns the surfaces: a MUI `TextField` with the magnifier as an input
 * adornment, a `List` per section under a `ListSubheader`, and `ListItemButton`
 * rows — which is also what makes the focus-follows-selection design above work,
 * since `ListItemButton` forwards its ref to the focusable root element.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import InputAdornment from '@mui/material/InputAdornment';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import SearchIcon from '@mui/icons-material/Search';
import SearchOffIcon from '@mui/icons-material/SearchOff';
import type { SvgIconProps } from '@mui/material/SvgIcon';
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
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

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
    <Box onKeyDown={onKeyDown}>
      {/*
       * No back control: Search is a top-level destination reached from the Tools
       * list and the More sheet, not a child of Today. A back arrow pointing at
       * Today would misrepresent where the user came from.
       */}
      <Box
        component="header"
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 'appBar',
          bgcolor: 'background.default',
          px: 2,
          pt: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)',
          pb: 0.5,
        }}
      >
        <Typography variant="h6" component="h1">
          Search
        </Typography>
      </Box>

      <Box sx={{ px: 2, pb: 1 }}>
        <TextField
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Tasks, events and habits"
          // A search screen that does not focus its field wastes the one thing
          // the user came here to do.
          autoFocus
          fullWidth
          slotProps={{
            htmlInput: {
              'aria-label': 'Search everything',
              enterKeyHint: 'search',
              autoComplete: 'off',
              autoCorrect: 'off',
              spellCheck: false,
            },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
              endAdornment:
                search.isLoading && ready ? (
                  <InputAdornment position="end">
                    <CircularProgress size={16} aria-label="Searching" />
                  </InputAdornment>
                ) : undefined,
            },
          }}
        />
      </Box>

      {!ready ? (
        <EmptyNotice
          icon={SearchIcon}
          title="Search everything"
          description="Type at least two characters to search across your tasks, calendar events and habits."
        />
      ) : search.error ? (
        <EmptyNotice icon={SearchOffIcon} title="Search failed" description={search.error} />
      ) : search.isInitialLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          {/* `status` + a name, so the wait is announced rather than silent. */}
          <CircularProgress role="status" aria-label="Searching" />
        </Box>
      ) : total === 0 ? (
        <EmptyNotice
          icon={SearchOffIcon}
          title="No results"
          description={`Nothing matches “${debounced}”. Try a shorter word, or check another spelling.`}
        />
      ) : (
        <>
          {SEARCH_SECTIONS.map((section) => {
            const items = resultsFor(groups, section.kind);
            if (items.length === 0) return null;

            return (
              <Box component="section" key={section.kind} aria-label={section.label}>
                <List
                  sx={{ py: 0 }}
                  subheader={
                    <ListSubheader
                      disableSticky
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 1,
                        px: 2,
                        py: 0.5,
                        lineHeight: 'normal',
                        bgcolor: 'transparent',
                      }}
                    >
                      <span>{section.label}</span>
                      <Typography component="span" variant="caption" color="text.secondary">
                        {items.length}
                      </Typography>
                    </ListSubheader>
                  }
                >
                  {items.map((result) => {
                    const index = flat.findIndex((candidate) => candidate.key === result.key);
                    const isActive = index === active;
                    return (
                      <ListItem key={result.key} disablePadding>
                        <ListItemButton
                          ref={(node) => {
                            itemRefs.current[index] = node;
                          }}
                          onClick={() => open(index)}
                          onPointerEnter={() => setActive(index)}
                          sx={{
                            minHeight: 44,
                            gap: 1.5,
                            px: 2,
                            py: 1,
                            ...(isActive ? { bgcolor: 'action.selected' } : {}),
                          }}
                        >
                          <ListItemText
                            primary={result.title}
                            secondary={result.subtitle}
                            slotProps={{
                              primary: { sx: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                              secondary: { sx: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                            }}
                          />
                          <ChevronRightIcon sx={{ flexShrink: 0, color: 'text.disabled' }} aria-hidden />
                        </ListItemButton>
                      </ListItem>
                    );
                  })}
                </List>
              </Box>
            );
          })}

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, pt: 2 }}>
            {total} {total === 1 ? 'result' : 'results'} · use ↑ ↓ and Enter
          </Typography>
        </>
      )}
    </Box>
  );
}

/** The centred "nothing here" panel: a disc, a title and one sentence. */
function EmptyNotice({
  icon: Icon,
  title,
  description,
}: {
  icon: ComponentType<SvgIconProps>;
  title: string;
  description: string;
}) {
  return (
    <Stack spacing={1} sx={{ alignItems: 'center', px: 6, py: 6, textAlign: 'center' }}>
      <Box
        aria-hidden
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 56,
          height: 56,
          mb: 1,
          borderRadius: '50%',
          bgcolor: 'action.hover',
          color: 'text.secondary',
        }}
      >
        <Icon />
      </Box>
      <Typography variant="subtitle1" component="h2">
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 288 }}>
        {description}
      </Typography>
    </Stack>
  );
}
