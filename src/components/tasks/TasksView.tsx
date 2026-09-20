'use client';

/**
 * The task list screen: every open task, grouped by urgency.
 *
 * One pass over `/api/tasks`, bucketed into Pinned / Overdue / Today /
 * Tomorrow / Next 7 days / Later by `buildListSections` — the user does not
 * choose a window here, they read one list. Calendar events for the same window
 * are merged in as non-completable rows. Filtering and sorting each live in their
 * own compact header menu (see `FilterMenu.tsx` and `SortMenu.tsx`), and both are
 * GodUI `Drawer`s so a swipe down puts them away.
 *
 * ## Search
 *
 * The scroll-reveal field is gone. It was a bespoke interaction built on a
 * hand-rolled hook (`useScrollReveal.ts`) with carefully tuned hysteresis, and
 * Material apps put a search affordance in the app bar instead. Search now lives
 * behind a header button: the button expands a field directly under the toolbar,
 * and the field stays open while a query is applied so an active filter can never
 * be invisible. That removes the whole scroll-driven mechanism — the hysteresis,
 * the out-of-flow positioning, and the shell's guaranteed overscroll that only
 * existed so the gesture was always available.
 *
 * The URL is the state — `?list=`, `?tag=`, `?window=`, `?q=`, `?sort=`,
 * `?priority=` — so a filtered view can be linked, bookmarked and reloaded, and
 * the resource cache key follows from it automatically.
 *
 * The field draws no focus ring. It is the one place the user is deliberately
 * typing into a search, and the ring read as a second border around a field that
 * already has one; the override is applied to this single `Input` via
 * `focus-visible:ring-0` in `className`, which is enough because `cn()` merges
 * it over the primitive's own `ring-[3px]` — no global `focus-visible` style is
 * touched, so every other control keeps its ring. Focus stays visible through the
 * primitive's `focus-visible:border-ring`, which repaints the border in the ring
 * colour, plus the caret.
 *
 * ## Layout
 *
 * The page is `flex flex-col gap-stack px-gutter`: the vertical rhythm between
 * section cards is stated once, by the page, rather than repeated as a margin on
 * every card (which is how the drift this migration exists to stop accumulated).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { Cross1Icon } from '@svg-animated-icons/react/cross-1';
import { ExclamationCircledIcon } from '@svg-animated-icons/react/exclamation-circled';
import { EyeNoneIcon } from '@svg-animated-icons/react/eye-none';
import { EyeOpenIcon } from '@svg-animated-icons/react/eye-open';
import { FilterIcon } from '@svg-animated-icons/react/filter';
import { MagnifyingGlassIcon } from '@svg-animated-icons/react/magnifying-glass';
import { PlusIcon } from '@svg-animated-icons/react/plus';
import { ArrowDownWideNarrow, ArrowUpDown, ArrowUpNarrowWide } from 'lucide-react';
import { useShellPane } from '@/components/app/ShellPane';
import { useAppearance } from '@/app/providers';
import { EventEditorSheet, type EventDefaults } from '@/components/calendar/EventEditorSheet';
import type { CalendarLookup } from '@/components/calendar/types';
import { accentHex } from '@/lib/colors';
import { todayIn, addDaysToDateOnly, fromDateOnly, timeIn, toDateOnly } from '@/lib/dates';
import { usePrimaryAction } from '@/lib/events';
import { useResource } from '@/lib/store';
import type { CalendarItem, Task } from '@/lib/types';
import type { BootstrapPayload, CalendarItemsPayload, CompleteTaskPayload } from '@/lib/view-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { CompletionUndo } from './CompletionUndo';
import { EmptyTasks } from './EmptyTasks';
import { TaskFilterMenu } from './FilterMenu';
import { HeaderActionButton } from './HeaderActionButton';
import { ItemDetailSheet } from './ItemDetailSheet';
import { ListManagerDialog } from './ListManagerDialog';
import { QuickAddBar } from './QuickAddBar';
import { TaskSortMenu } from './SortMenu';
import { TaskEditorSheet } from './TaskEditorSheet';
import { TaskListSection } from './TaskListSection';
import {
  activeFilters,
  DEFAULT_TASK_VIEW,
  isDirectionalSort,
  parseTaskView,
  serializeTaskView,
  sortDirLabel,
  sortTasks,
  taskQuery,
  taskViewTitle,
  updateTaskView,
  visibleEvents,
  TASK_SORTS,
  type TaskViewState,
} from './filters';
import { patchById, removeByIds, reorderList, setStatusByIds } from './optimistic';
import { buildListSections, visibleTasks, type TaskSection } from './sections';
import { taskAccentLookup } from './row-colors';
import { useTaskActions } from './useTaskActions';

/** Debounce for the search field, so typing does not fire a request per key. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * How far ahead the list reads calendar events.
 *
 * The task list's Later group is unbounded — it holds every open task past the
 * Next 7 days horizon — so an event has to be fetched past that horizon too or
 * it has nowhere to appear. A year sits under the `/api/calendar/items` 400-day
 * range guard and covers every event a personal list actually holds; a longer
 * window only buys more recurring expansion for events nobody scrolls to.
 */
const EVENT_HORIZON_DAYS = 365;

/** Minutes since midnight for an `HH:mm` wall-clock time. */
function minuteOfTime(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

/** Prefill for the event editor when an event row's Edit is tapped here. */
function eventEditorDefaults(event: CalendarItem, zone: string): EventDefaults {
  const startMinute = event.isAllDay ? 9 * 60 : minuteOfTime(timeIn(event.startMs, zone));
  const spanMinutes = Math.max(30, Math.round((event.endMs - event.startMs) / 60_000));
  return {
    date: toDateOnly(event.startMs, zone),
    startMinute,
    endMinute: Math.min(24 * 60, startMinute + spanMinutes),
    calendarId: event.calendarId,
  };
}

export function TasksView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // This screen owns its own scroll: the header stays put and only the list
  // moves. The shell hands the pane over as a fixed-height box; see `ShellPane`.
  useShellPane({ fullHeight: true });

  const state = useMemo(() => parseTaskView(searchParams.toString()), [searchParams]);
  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');
  const data = bootstrap.data;

  const zone = data?.settings.timezone ?? data?.user.timezone ?? 'utc';
  const timeFormat = data?.settings.timeFormat ?? '24h';
  const weekStartsOn = data?.settings.weekStartsOn ?? 1;
  const actions = useTaskActions(zone);
  /** The resolved appearance, so an accent token maps to the right hex. */
  const dark = useAppearance().resolvedTheme === 'dark';

  const lists = useMemo(() => data?.lists ?? [], [data?.lists]);
  // Resolves each row's list colour once, for the per-row colour strip.
  const accentForTask = useMemo(() => taskAccentLookup(lists), [lists]);
  // The calendars, so an event's strip can resolve the calendar's own colour —
  // a custom `#rrggbb` override included (see `itemHex`).
  const calendarLookup = useMemo<CalendarLookup>(
    () => new Map((data?.calendars ?? []).map((calendar) => [calendar.id, calendar])),
    [data?.calendars],
  );
  const tags = useMemo(() => data?.tags ?? [], [data?.tags]);
  const lookups = useMemo(() => ({ lists, tags }), [lists, tags]);

  const query = useMemo(() => taskQuery(state), [state]);
  const resource = useResource<Task[]>('/api/tasks', query);
  const tasks = useMemo(() => resource.data ?? [], [resource.data]);

  const [searchDraft, setSearchDraft] = useState(state.q);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  /** Set when the search button opens the field, so the focus is not on load. */
  const focusSearchRef = useRef(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  /** The task a completion just removed from view, while its Undo is on screen. */
  const [undoTask, setUndoTask] = useState<Task | null>(null);
  /** Completed rows are hidden until the header's eye toggle asks for them. */
  const [showCompleted, setShowCompleted] = useState(false);
  /** The event editor, opened by the detail sheet's Edit action. */
  const [eventEditor, setEventEditor] = useState<{
    open: boolean;
    eventId: string | null;
    defaults: EventDefaults;
  } | null>(null);
  /** The list manager, opened by the sidebar's `?new=list` route. */
  const [listManager, setListManager] = useState<{ open: boolean; creating: boolean }>({
    open: false,
    creating: false,
  });

  // The shell's action button asks the mounted view for its primary create action.
  usePrimaryAction(openQuickAdd);
  const [editor, setEditor] = useState<{ open: boolean; task: Task | null }>({ open: false, task: null });
  /**
   * The row whose detail sheet is open. A task carries its full record; an event
   * carries the `CalendarItem` the calendar read already returned. Exactly one
   * is set while the sheet is up.
   */
  const [detail, setDetail] = useState<
    { kind: 'task'; task: Task } | { kind: 'event'; event: CalendarItem } | null
  >(null);

  /**
   * Opens quick add *inside* the gesture that asked for it.
   *
   * iOS only raises the keyboard when `focus()` runs in the task that handled
   * the tap. The sheet arrives through a portal, so a plain `setState` here
   * leaves the input a couple of renders away — by which time the gesture is
   * over and the keyboard never comes up, however focused the field looks.
   * Flushing the open synchronously means the field is in the DOM before this
   * handler returns, and the sheet's layout effect can focus it while the tap is
   * still being processed.
   */
  function openQuickAdd() {
    flushSync(() => setQuickAddOpen(true));
  }

  function applyState(patch: Partial<TaskViewState>) {
    const next = updateTaskView(state, patch);
    const qs = serializeTaskView(next);
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // Keep the field in step with the URL (back button, a query typed elsewhere).
  useEffect(() => {
    setSearchDraft(state.q);
    if (state.q.trim()) setSearchOpen(true);
  }, [state.q]);

  // Debounced search: the request only goes out once typing settles.
  useEffect(() => {
    if (searchDraft === state.q) return;
    const timer = window.setTimeout(() => applyState({ q: searchDraft }), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // `applyState` closes over the newest state on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft, state.q]);

  /*
   * The sidebar's "New list" button routes to `/tasks?new=list`, but nothing ever
   * read the parameter — the button looked live and did nothing. Open the list
   * manager straight into its create form and strip the parameter, so a refresh
   * or a back-navigation does not reopen it.
   */
  useEffect(() => {
    if (searchParams.get('new') !== 'list') return;
    setListManager({ open: true, creating: true });
    const next = new URLSearchParams(searchParams.toString());
    next.delete('new');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchParams, pathname, router]);

  const chips = useMemo(() => activeFilters(state, lookups), [state, lookups]);
  const title = taskViewTitle(state, lookups);
  const activeList = state.listId ? (lists.find((list) => list.id === state.listId) ?? null) : null;
  const activeSort = TASK_SORTS.find((sort) => sort.value === state.sort) ?? TASK_SORTS[0];
  const directionalSort = isDirectionalSort(state.sort);
  const SortIcon = directionalSort
    ? state.sortDir === 'asc'
      ? ArrowUpNarrowWide
      : ArrowDownWideNarrow
    : ArrowUpDown;

  /** The search field is visible on demand, and always while a query is applied. */
  const searchVisible = searchOpen || state.q.trim().length > 0;

  /*
   * The search button opens the field and puts the caret in it, so the tap is
   * one action. Only the button sets the flag — a query restored from the URL
   * opens the field without stealing focus on load.
   */
  useEffect(() => {
    if (!focusSearchRef.current || !searchVisible) return;
    focusSearchRef.current = false;
    searchRef.current?.focus();
  }, [searchVisible]);

  // The API takes no direction parameter, so `desc` is applied to the fetched
  // page here; see `sortTasks`. Non-directional sorts keep the server's order.
  const sortedTasks = useMemo(
    () => sortTasks(tasks, state.sort, state.sortDir),
    [tasks, state.sort, state.sortDir],
  );

  // The day the list is grouped around, computed once so the calendar window and
  // the section buckets cannot disagree about where "today" is.
  const today = useMemo(() => todayIn(zone), [zone]);

  /*
   * Events for the window the list groups: today out to the Later horizon.
   * `/api/calendar/items` is the one read endpoint that expands recurring events
   * and projects both kinds into `CalendarItem`. Its task rows are dropped here
   * because `/api/tasks` already owns them, so the read asks for `kinds=event`
   * and `days=0`. Without those this screen downloaded every task projection
   * twice over — once in `items`, once inside `days` — and discarded it, which
   * was most of a 336 KB cold-load response.
   *
   * The window runs to `EVENT_HORIZON_DAYS`, not to the Next 7 days edge: an
   * event past that edge belongs to the Later group, and reading only to the edge
   * made it invisible (`visibleEvents` then trims the day groups to the selected
   * window, so this wider read cannot leak a far event into Next 7 days).
   */
  /*
   * The bounds are memoized on the day and the zone: they are three Luxon calls
   * (`fromDateOnly`, `addDaysToDateOnly`) that this screen rebuilt inline on
   * every render, into a fresh object that is also the resource key.
   */
  const eventWindow = useMemo(
    () => ({
      startMs: fromDateOnly(today, zone).toMillis(),
      endMs: fromDateOnly(addDaysToDateOnly(today, EVENT_HORIZON_DAYS, zone), zone).toMillis(),
      // Events only, and no per-day buckets: this screen reads `items` and
      // filters it itself. The buckets are for the calendar screen.
      kinds: 'event',
      days: '0',
    }),
    [today, zone],
  );
  const calendarItems = useResource<CalendarItemsPayload>('/api/calendar/items', eventWindow);
  const events = useMemo(
    () => (calendarItems.data?.items ?? []).filter((item) => item.kind === 'event'),
    [calendarItems.data],
  );

  /*
   * Events obey the filters that can apply to them and are excluded by the ones
   * that cannot; see `visibleEvents`. Without this they ignored every task
   * filter — a search, a list, a tag or a priority left them all on screen, and
   * even a Completed or Overdue window still drew them.
   */
  const filteredEvents = useMemo(
    () => visibleEvents(events, state, { zone, today }),
    [events, state, zone, today],
  );

  /*
   * Completed work is hidden by default. The explicit Completed filter is the
   * exception: it asks for closed rows and nothing else, so forcing them hidden
   * there would leave an empty screen.
   */
  const completedVisible = showCompleted || state.window === 'completed';
  const visibleRows = useMemo(
    () => visibleTasks(sortedTasks, completedVisible),
    [completedVisible, sortedTasks],
  );

  const sections = useMemo(
    () => buildListSections(visibleRows, { zone, today }, filteredEvents),
    [visibleRows, zone, today, filteredEvents],
  );

  /**
   * Flips the completed rows. While the list *is* the Completed filter there is
   * nothing to hide, so turning the toggle off leaves the filter for All tasks —
   * otherwise the control could never read as off there.
   */
  function toggleCompleted() {
    if (state.window === 'completed') {
      setShowCompleted(false);
      applyState({ window: 'all' });
      return;
    }
    setShowCompleted((value) => !value);
  }

  /**
   * Runs a write on top of an optimistic list change, restoring the previous list
   * when the write fails, so a row never looks saved when it is not.
   */
  function optimistic<T>(
    update: (tasks: Task[]) => Task[],
    write: () => Promise<T>,
  ): Promise<T> {
    const snapshot = resource.data;
    resource.mutate((current) => (current ? update(current) : current));
    const pending = write();
    void pending.then((result) => {
      if (result === undefined && snapshot) resource.mutate(snapshot);
    });
    return pending;
  }

  /**
   * Ticks a task off, or un-ticks it when it is already done.
   *
   * Completing a one-off task raises the small left-edge Undo (see
   * `CompletionUndo`) and deliberately raises no toast. Undo calls the same
   * endpoint with `?undo=1`, which `uncompleteTask` reverses cleanly for a
   * one-off: it restores the status and drops the completion record.
   *
   * A *recurring* task is the exception. Completing it rolls the series forward
   * rather than finishing it, and the server's undo would leave that advanced
   * due date in place, so an Undo there would lie. It is therefore suppressed
   * twice: at once by the local `recurrenceRule` (so the control never flashes
   * before the request returns) and again by the completion payload's `recurred`
   * flag, which is the server's own word on it and also catches a task whose
   * rule is not in this client's copy. That path keeps the existing
   * "Moved to <date>" toast as its feedback.
   */
  function toggleTask(task: Task) {
    const undo = task.status === 'completed';
    setUndoTask(null);

    const pending = optimistic(
      (current) => setStatusByIds(current, new Set([task.id]), undo ? 'todo' : 'completed', Date.now()),
      () => actions.complete(task, undo),
    );

    if (undo || task.recurrenceRule) return;

    setUndoTask(task);
    void pending.then((result: CompleteTaskPayload | undefined) => {
      if (result?.recurred) setUndoTask(null);
    });
  }

  /**
   * Puts the just-completed task back. The completion it recorded is removed by
   * the same `?undo=1` write, so the Undo really undoes rather than adding a
   * second row.
   */
  function undoCompletion() {
    const task = undoTask;
    if (!task) return;
    setUndoTask(null);
    optimistic(
      (current) => setStatusByIds(current, new Set([task.id]), 'todo', Date.now()),
      () => actions.complete(task, true),
    );
  }

  const refresh = () => void resource.refresh();

  /** Refreshes both reads an event write can affect on this screen. */
  const refreshAfterEventWrite = () => {
    void resource.refresh();
    void calendarItems.refresh();
  };

  function deleteTask(task: Task) {
    optimistic(
      (current) => removeByIds(current, new Set([task.id])),
      () => actions.remove(task.id),
    );
  }

  function wontDoTask(task: Task) {
    optimistic(
      (current) => setStatusByIds(current, new Set([task.id]), 'wont_do', Date.now()),
      () => actions.patch(task.id, { status: 'wont_do' }),
    );
  }

  /**
   * Flips a task's pin. The list is regrouped by `buildListSections`, so the row
   * moves into (or out of) the Pinned section as soon as the optimistic patch
   * lands, and `actions.patch` is the same write the editor's "Pin to top" uses.
   */
  function pinTask(task: Task) {
    const isPinned = !task.isPinned;
    optimistic(
      (current) => patchById(current, task.id, { isPinned }),
      () => actions.patch(task.id, { isPinned }),
    );
  }

  function reorderSection(_section: TaskSection, orderedIds: string[]) {
    optimistic(
      (current) => reorderList(current, orderedIds),
      () => actions.reorder(orderedIds),
    );
    // A manual order is the only order that survives a refetch, so ask for it.
    if (state.sort !== 'manual') applyState({ sort: 'manual' });
  }

  /** Opens the detail sheet for a tapped row. */
  function openTaskDetail(task: Task) {
    setDetail({ kind: 'task', task });
  }

  function openEventDetail(event: CalendarItem) {
    setDetail({ kind: 'event', event });
  }

  /**
   * The detail sheet's Edit action. A task opens the task editor in place; an
   * event opens the event editor, which is the editor the calendar screen uses,
   * mounted here so the action edits the event instead of navigating away.
   */
  function editDetailItem() {
    if (!detail) return;
    if (detail.kind === 'task') {
      const task = detail.task;
      setDetail(null);
      setEditor({ open: true, task });
      return;
    }
    const event = detail.event;
    setDetail(null);
    setEventEditor({
      open: true,
      eventId: event.id,
      defaults: eventEditorDefaults(event, zone),
    });
  }

  const loading = resource.data === undefined && !resource.error;
  const showEmpty = !loading && !resource.error && sections.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="z-appbar shrink-0 bg-background pt-[env(safe-area-inset-top,0px)]">
        <div className="flex min-h-14 items-center gap-2 px-gutter">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {activeList ? (
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: accentHex(activeList.color) }}
              />
            ) : null}
            <h1 className="min-w-0 truncate text-lg font-semibold">{title}</h1>
          </div>
          {/*
           * The sort, as its own icon button beside search and filter. The glyph
           * carries the direction (narrow-wide up or down) so the current order
           * is readable without opening the menu; the drawer holds the key list
           * and the ascending/descending toggle. It fills while a non-default
           * sort is applied, the way the filter button fills for active filters.
           */}
          <HeaderActionButton
            aria-label={
              directionalSort
                ? `Sort: ${activeSort.label}, ${sortDirLabel(state.sortDir)}. Change the sort`
                : `Sort: ${activeSort.label}. Change the sort`
            }
            icon={SortIcon}
            iconClassName="size-5"
            variant={state.sort === DEFAULT_TASK_VIEW.sort ? 'tinted' : 'filled'}
            onClick={() => setSortOpen(true)}
          />
          <HeaderActionButton
            aria-label={searchVisible ? 'Hide search' : 'Show search'}
            icon={MagnifyingGlassIcon}
            variant={searchVisible ? 'filled' : 'tinted'}
            onClick={() =>
              setSearchOpen((value) => {
                // Arm the focus only when the field is being opened.
                if (!value) focusSearchRef.current = true;
                return !value;
              })
            }
          />
          {/*
           * The filter menu: its own drawer, separate from the sort above.
           */}
          <HeaderActionButton
            aria-label="Filter tasks"
            icon={FilterIcon}
            variant={chips.length ? 'filled' : 'tinted'}
            onClick={() => setFilterOpen(true)}
          />
          {/*
           * The completed toggle. It fills while completed rows are showing and
           * exposes that through `aria-pressed`; events are never counted as
           * completed and are never hidden by it.
           */}
          <HeaderActionButton
            aria-label={completedVisible ? 'Hide completed tasks' : 'Show completed tasks'}
            aria-pressed={completedVisible}
            icon={completedVisible ? EyeOpenIcon : EyeNoneIcon}
            variant={completedVisible ? 'filled' : 'tinted'}
            onClick={toggleCompleted}
          />
          {/*
           * Desktop only. The floating band — and with it the action button — is
           * hidden at `lg`, so this is the only way to create a task from a
           * desktop-sized window.
           */}
          <HeaderActionButton
            aria-label="Add a task"
            icon={PlusIcon}
            onClick={openQuickAdd}
            className="hidden lg:inline-flex"
          />
        </div>

        {/*
         * Search, expanded from the header button. It is in the header's own
         * flow now, not an out-of-flow overlay: there is no scroll gesture to
         * cooperate with, so the field simply pushes the list down while it is
         * open. An applied query keeps it visible, because an active filter must
         * never be invisible.
         */}
        <AnimatePresence initial={false}>
          {searchVisible ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <div className="px-gutter pb-2">
                <div className="relative">
                  <MagnifyingGlassIcon
                    className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-base text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    ref={searchRef}
                    type="search"
                    value={searchDraft}
                    placeholder="Search"
                    aria-label="Search tasks"
                    onChange={(event) => setSearchDraft(event.target.value)}
                    /*
                     * No focus ring on this field, scoped to this one `Input`
                     * through `className` rather than globally: `cn()` runs the
                     * primitive's own classes first, so `focus-visible:ring-0`
                     * (same tailwind-merge group as the shadcn `ring-[3px]`)
                     * replaces that ring here and nowhere else. The field stays
                     * obviously focused: the primitive's
                     * `focus-visible:border-ring` still paints the border in the
                     * ring colour, and the caret sits in it. Every other control
                     * keeps the app-wide focus-visible affordance.
                     */
                    className="pr-10 pl-9 focus-visible:ring-0"
                  />
                  {searchDraft ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Clear search"
                      onClick={() => setSearchDraft('')}
                      className="absolute top-1/2 right-1 size-7 -translate-y-1/2 rounded-full"
                    >
                      <Cross1Icon className="text-sm" />
                    </Button>
                  ) : null}
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </header>

      {/*
       * The list is the scroller now, not the shell's pane. It restates the
       * mobile tab-bar clearance the pane used to carry, or the last row sits
       * under the band; at `lg` the band is gone, so the padding is too.
       */}
      <div className="fade-y min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom)_+_5.375rem)] lg:pb-0">
      {resource.error && resource.data === undefined ? (
        <div className="flex flex-col items-center gap-3 px-gutter py-6 text-center">
          <ExclamationCircledIcon className="text-4xl text-muted-foreground" aria-hidden />
          <h2 className="text-base font-medium">Couldn&apos;t load your tasks</h2>
          <p className="text-sm text-muted-foreground">{resource.error}</p>
          <Button type="button" variant="outline" className="mt-1" onClick={refresh}>
            Try again
          </Button>
        </div>
      ) : loading ? (
        <div className="flex flex-col gap-2 px-gutter py-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-7 w-full" />
          ))}
        </div>
      ) : showEmpty ? (
        <EmptyTasks
          title={chips.length ? 'Nothing matches' : title}
          description={
            chips.length
              ? 'No task fits these filters. Clear one of them, or add something new.'
              : 'This list is empty. Add the first task and it will show up here.'
          }
          onAdd={openQuickAdd}
        />
      ) : (
        <div className="flex flex-col gap-stack px-gutter py-3">
          {sections.map((section) => (
            <TaskListSection
              key={section.id}
              section={section}
              zone={zone}
              timeFormat={timeFormat}
              onToggle={toggleTask}
              onOpen={openTaskDetail}
              listColorFor={accentForTask}
              calendars={calendarLookup}
              dark={dark}
              onOpenEvent={openEventDetail}
              onDelete={deleteTask}
              onWontDo={wontDoTask}
              onPin={pinTask}
              onReorder={reorderSection}
              disabled={!actions.online}
            />
          ))}
        </div>
      )}
      </div>

      <CompletionUndo
        task={undoTask}
        onUndo={undoCompletion}
        onDismiss={() => setUndoTask(null)}
      />

      <TaskFilterMenu
        open={filterOpen}
        onOpenChange={setFilterOpen}
        state={state}
        lists={lists}
        tags={tags}
        onChange={applyState}
      />

      <TaskSortMenu
        open={sortOpen}
        onOpenChange={setSortOpen}
        state={state}
        onChange={applyState}
      />
      <ItemDetailSheet
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        task={detail?.kind === 'task' ? detail.task : null}
        event={detail?.kind === 'event' ? detail.event : null}
        listName={
          detail?.kind === 'task'
            ? (lists.find((list) => list.id === detail.task.listId)?.name ?? null)
            : null
        }
        listColor={
          detail?.kind === 'task'
            ? (lists.find((list) => list.id === detail.task.listId)?.color ?? null)
            : null
        }
        calendarName={detail?.kind === 'event' ? (detail.event.calendarName ?? null) : null}
        zone={zone}
        timeFormat={timeFormat}
        onEdit={editDetailItem}
      />

      <QuickAddBar
        open={quickAddOpen}
        onOpenChange={setQuickAddOpen}
        listId={state.listId}
        onCreated={refresh}
      />
      {/*
       * The event editor, the same one the calendar screen uses. Its Edit action
       * on the detail sheet opens it here rather than navigating to the calendar,
       * so the event is edited in place.
       */}
      <EventEditorSheet
        open={Boolean(eventEditor?.open)}
        onOpenChange={(open) => {
          if (!open) setEventEditor(null);
        }}
        eventId={eventEditor?.eventId ?? null}
        defaults={
          eventEditor?.defaults ?? {
            date: today,
            startMinute: 9 * 60,
            endMinute: 10 * 60,
            calendarId: calendarLookup.values().next().value?.id ?? null,
          }
        }
        calendars={data?.calendars ?? []}
        prefs={{ zone, weekStartsOn, timeFormat }}
        onChanged={refreshAfterEventWrite}
      />
      <ListManagerDialog
        open={listManager.open}
        onOpenChange={(open) => setListManager((current) => ({ ...current, open }))}
        startInForm={listManager.creating}
      />
      <TaskEditorSheet
        open={editor.open}
        task={editor.task}
        onSaved={refresh}
        onOpenChange={(open) => setEditor((current) => ({ ...current, open }))}
      />
    </div>
  );
}
