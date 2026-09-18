'use client';

/**
 * The task list screen: every open task, grouped by urgency.
 *
 * One pass over `/api/tasks`, bucketed into Pinned / Overdue / Next 7 days /
 * Later by `buildListSections` — the user does not choose a window here, they
 * read one list. Filtering and sorting each live in their own compact header
 * menu (see `FilterMenu.tsx` and `SortMenu.tsx`), and both are GodUI `Drawer`s so
 * a swipe down puts them away.
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
 * ## Layout
 *
 * The page is `flex flex-col gap-stack px-gutter`: the vertical rhythm between
 * section cards is stated once, by the page, rather than repeated as a margin on
 * every card (which is how the drift this migration exists to stop accumulated).
 */
import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircledIcon } from '@svg-animated-icons/react/check-circled';
import { Cross1Icon } from '@svg-animated-icons/react/cross-1';
import { ExclamationCircledIcon } from '@svg-animated-icons/react/exclamation-circled';
import { FilterIcon } from '@svg-animated-icons/react/filter';
import { MagnifyingGlassIcon } from '@svg-animated-icons/react/magnifying-glass';
import { PlusIcon } from '@svg-animated-icons/react/plus';
import { TrashIcon } from '@svg-animated-icons/react/trash';
import { Folder } from 'lucide-react';
import { ArrowDownWideNarrow, ArrowUpDown, ArrowUpNarrowWide, Flag, Tag } from 'lucide-react';
import { accentHex } from '@/lib/colors';
import { todayIn } from '@/lib/dates';
import { usePrimaryAction } from '@/lib/events';
import { useIsDesktop, useResource } from '@/lib/store';
import type { Task } from '@/lib/types';
import type { BootstrapPayload } from '@/lib/view-types';
import { FloatingToolbar } from '@/components/godui/floating-toolbar';
import { HoldConfirmButton } from '@/components/godui/hold-confirm-button';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { EmptyTasks } from './EmptyTasks';
import { TaskFilterMenu } from './FilterMenu';
import { HeaderActionButton } from './HeaderActionButton';
import { ListPicker } from './ListPicker';
import { PriorityPicker } from './PriorityPicker';
import { QuickAddBar } from './QuickAddBar';
import { TaskSortMenu } from './SortMenu';
import { TagPicker } from './TagPicker';
import { TaskEditorSheet } from './TaskEditorSheet';
import { TaskListSection } from './TaskListSection';
import { ViewportDock } from './ViewportDock';
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
  TASK_SORTS,
  type TaskViewState,
} from './filters';
import { removeByIds, reorderList, setPriorityByIds, setStatusByIds } from './optimistic';
import type { BulkAction, BulkPayload } from './payloads';
import { buildListSections, type TaskSection } from './sections';
import { useTaskActions } from './useTaskActions';

/** Debounce for the search field, so typing does not fire a request per key. */
const SEARCH_DEBOUNCE_MS = 250;

type BulkSheet = 'move' | 'priority' | 'tag' | null;

export function TasksView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isDesktop = useIsDesktop();

  const state = useMemo(() => parseTaskView(searchParams.toString()), [searchParams]);
  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');
  const data = bootstrap.data;

  const zone = data?.settings.timezone ?? data?.user.timezone ?? 'utc';
  const timeFormat = data?.settings.timeFormat ?? '24h';
  const actions = useTaskActions(zone);

  const lists = useMemo(() => data?.lists ?? [], [data?.lists]);
  const tags = useMemo(() => data?.tags ?? [], [data?.tags]);
  const lookups = useMemo(() => ({ lists, tags }), [lists, tags]);

  const query = useMemo(() => taskQuery(state), [state]);
  const resource = useResource<Task[]>('/api/tasks', query);
  const tasks = useMemo(() => resource.data ?? [], [resource.data]);
  const listColors = useMemo(() => new Map(lists.map((list) => [list.id, list.color])), [lists]);

  const [searchDraft, setSearchDraft] = useState(state.q);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [bulkSheet, setBulkSheet] = useState<BulkSheet>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  // The shell's action button asks the mounted view for its primary create action.
  usePrimaryAction(openQuickAdd);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [editor, setEditor] = useState<{ open: boolean; task: Task | null }>({ open: false, task: null });

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

  // The API takes no direction parameter, so `desc` is applied to the fetched
  // page here; see `sortTasks`. Non-directional sorts keep the server's order.
  const sortedTasks = useMemo(
    () => sortTasks(tasks, state.sort, state.sortDir),
    [tasks, state.sort, state.sortDir],
  );

  const sections = useMemo(
    () => buildListSections(sortedTasks, { zone, today: todayIn(zone) }),
    [sortedTasks, zone],
  );

  function toggleSelect(task: Task) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
      return next;
    });
  }

  function exitSelection() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  /**
   * Runs a write on top of an optimistic list change, restoring the previous list
   * when the write fails, so a row never looks saved when it is not.
   */
  function optimistic(
    update: (tasks: Task[]) => Task[],
    write: () => Promise<unknown>,
  ) {
    const snapshot = resource.data;
    resource.mutate((current) => (current ? update(current) : current));
    void write().then((result) => {
      if (result === undefined && snapshot) resource.mutate(snapshot);
    });
  }

  function toggleTask(task: Task) {
    const undo = task.status === 'completed';
    optimistic(
      (current) => setStatusByIds(current, new Set([task.id]), undo ? 'todo' : 'completed', Date.now()),
      () => actions.complete(task, undo),
    );
  }

  const refresh = () => void resource.refresh();

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

  function reorderSection(_section: TaskSection, orderedIds: string[]) {
    optimistic(
      (current) => reorderList(current, orderedIds),
      () => actions.reorder(orderedIds),
    );
    // A manual order is the only order that survives a refetch, so ask for it.
    if (state.sort !== 'manual') applyState({ sort: 'manual' });
  }

  async function runBulk(action: BulkAction, payload: BulkPayload = {}) {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const selection = new Set(ids);

    if (action === 'complete') {
      optimistic(
        (current) => setStatusByIds(current, selection, 'completed', Date.now()),
        () => actions.bulk(ids, action, payload),
      );
    } else if (action === 'delete') {
      optimistic(
        (current) => removeByIds(current, selection),
        () => actions.bulk(ids, action, payload),
      );
    } else if (action === 'priority' && payload.priority) {
      const priority = payload.priority;
      optimistic(
        (current) => setPriorityByIds(current, selection, priority),
        () => actions.bulk(ids, action, payload),
      );
    } else if (action === 'move' && state.listId) {
      // Moving out of the list being viewed: the rows no longer belong here.
      optimistic(
        (current) => removeByIds(current, selection),
        () => actions.bulk(ids, action, payload),
      );
    } else {
      await actions.bulk(ids, action, payload);
    }

    exitSelection();
  }

  const loading = resource.data === undefined && !resource.error;
  const showEmpty = !loading && !resource.error && sections.length === 0;

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-appbar border-b border-border bg-background pt-[env(safe-area-inset-top,0px)]">
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
            onClick={() => setSearchOpen((value) => !value)}
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
          <HeaderActionButton
            aria-label={selectionMode ? 'Done selecting' : 'Select tasks'}
            icon={selectionMode ? Cross1Icon : CheckCircledIcon}
            variant={selectionMode ? 'filled' : 'tinted'}
            onClick={() => (selectionMode ? exitSelection() : setSelectionMode(true))}
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
                    type="search"
                    value={searchDraft}
                    placeholder="Search"
                    aria-label="Search tasks"
                    onChange={(event) => setSearchDraft(event.target.value)}
                    className="pr-10 pl-9"
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
              listColors={listColors}
              onToggle={toggleTask}
              onOpen={(task) => setEditor({ open: true, task })}
              onDelete={deleteTask}
              onWontDo={wontDoTask}
              onReorder={reorderSection}
              selectionMode={selectionMode}
              selectedIds={selectedIds}
              onSelect={toggleSelect}
              disabled={!actions.online}
            />
          ))}
        </div>
      )}

      {/*
       * The bulk-action bar is the only thing left that wants the band above the
       * tab bar: adding a task is the shell's action button opening the sheet,
       * the same gesture as every other screen.
       */}
      {selectionMode ? (
        <ViewportDock
          className={cn(
            'fixed inset-x-0 z-modal flex items-center justify-center gap-2 px-gutter',
            isDesktop
              ? 'bottom-3'
              : 'bottom-[calc(env(safe-area-inset-bottom,0px)+5rem)]',
          )}
        >
          <span className="shrink-0 rounded-xl border border-border bg-popover/90 px-2 py-2 text-xs tabular-nums text-muted-foreground shadow-lg backdrop-blur-md">
            {selectedIds.size} selected
          </span>
          <FloatingToolbar
            actions={[
              {
                icon: <CheckCircledIcon className="text-base" aria-hidden />,
                label: 'Complete selected tasks',
                disabled: selectedIds.size === 0,
                onClick: () => void runBulk('complete'),
              },
              {
                icon: <Folder className="size-4" aria-hidden />,
                label: 'Move selected tasks',
                disabled: selectedIds.size === 0,
                onClick: () => setBulkSheet('move'),
              },
              {
                icon: <Flag className="size-4" aria-hidden />,
                label: 'Set the priority of the selected tasks',
                disabled: selectedIds.size === 0,
                onClick: () => setBulkSheet('priority'),
              },
              {
                icon: <Tag className="size-4" aria-hidden />,
                label: 'Add a tag to the selected tasks',
                disabled: selectedIds.size === 0,
                onClick: () => setBulkSheet('tag'),
              },
              {
                icon: <TrashIcon className="text-base" aria-hidden />,
                label: 'Delete selected tasks',
                disabled: selectedIds.size === 0,
                onClick: () => setConfirmBulkDelete(true),
              },
            ]}
          />
        </ViewportDock>
      ) : null}

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

      <ListPicker
        open={bulkSheet === 'move'}
        onOpenChange={(open) => setBulkSheet(open ? 'move' : null)}
        lists={lists}
        value={null}
        allowNone={false}
        title={`Move ${selectedIds.size} tasks`}
        onChange={(listId) => void runBulk('move', { listId })}
      />

      <PriorityPicker
        open={bulkSheet === 'priority'}
        onOpenChange={(open) => setBulkSheet(open ? 'priority' : null)}
        value="none"
        title={`Priority for ${selectedIds.size} tasks`}
        onChange={(priority) => void runBulk('priority', { priority })}
      />

      <TagPicker
        open={bulkSheet === 'tag'}
        onOpenChange={(open) => setBulkSheet(open ? 'tag' : null)}
        tags={tags}
        value={[]}
        title={`Add a tag to ${selectedIds.size} tasks`}
        onCreate={actions.createTag}
        onChange={(next) => {
          const tagId = next[next.length - 1];
          setBulkSheet(null);
          if (tagId) void runBulk('addTag', { tagId });
        }}
      />

      {/*
       * Deleting a selection is the one irreversible bulk action, so it is the
       * one that asks for a hold rather than a tap.
       */}
      <Dialog open={confirmBulkDelete} onOpenChange={setConfirmBulkDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{`Delete ${selectedIds.size} task${selectedIds.size === 1 ? '' : 's'}?`}</DialogTitle>
            <DialogDescription>They will be removed from every list. This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmBulkDelete(false)}>
              Cancel
            </Button>
            <HoldConfirmButton
              onConfirm={() => {
                setConfirmBulkDelete(false);
                void runBulk('delete');
              }}
            >
              Delete
            </HoldConfirmButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <QuickAddBar
        open={quickAddOpen}
        onOpenChange={setQuickAddOpen}
        listId={state.listId}
        onCreated={refresh}
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
