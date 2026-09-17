'use client';

/**
 * The task list screen: every open task, grouped by urgency.
 *
 * One pass over `/api/tasks`, bucketed into Pinned / Overdue / Next 7 days /
 * Later by `buildListSections` — the user does not choose a window here, they
 * read one list. Filtering and sorting both live in the header's single menu,
 * and the search field is revealed by a scroll-up gesture rather than sitting
 * permanently under the title.
 *
 * The URL is the state — `?list=`, `?tag=`, `?window=`, `?q=`, `?sort=`,
 * `?priority=` — so a filtered view can be linked, bookmarked and reloaded, and
 * the resource cache key follows from it automatically.
 */
import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  CheckCheck,
  CircleAlert,
  Flag,
  FolderInput,
  Funnel,
  Plus,
  Search,
  Tag as TagIcon,
  Trash,
  X,
} from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  NavBar,
  Skeleton,
  TextField,
} from '@/components/ui';
import { accentHex } from '@/lib/colors';
import { cn } from '@/lib/cn';
import { todayIn } from '@/lib/dates';
import { useIsDesktop, useResource } from '@/lib/store';
import type { Task } from '@/lib/types';
import type { BootstrapPayload } from '@/lib/view-types';
import { EmptyTasks } from './EmptyTasks';
import { TaskFilterSheet } from './FilterMenu';
import { HeaderActionButton } from './HeaderActionButton';
import { ListPicker } from './ListPicker';
import { PriorityPicker } from './PriorityPicker';
import { QuickAddBar } from './QuickAddBar';
import { usePrimaryAction } from '@/lib/events';
import { TagPicker } from './TagPicker';
import { TaskEditorSheet } from './TaskEditorSheet';
import { TaskListSection } from './TaskListSection';
import { ViewportDock } from './ViewportDock';
import {
  activeFilters,
  parseTaskView,
  serializeTaskView,
  taskQuery,
  taskViewTitle,
  updateTaskView,
  TASK_SORTS,
  type TaskViewState,
} from './filters';
import { removeByIds, reorderList, setPriorityByIds, setStatusByIds } from './optimistic';
import type { BulkAction, BulkPayload } from './payloads';
import { buildListSections, type TaskSection } from './sections';
import { useScrollReveal } from './useScrollReveal';
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
  const [searchFocused, setSearchFocused] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [bulkSheet, setBulkSheet] = useState<BulkSheet>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  // The shell's action button asks the mounted view for its primary create action.
  usePrimaryAction(() => setQuickAddOpen(true));
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [editor, setEditor] = useState<{ open: boolean; task: Task | null }>({ open: false, task: null });

  function applyState(patch: Partial<TaskViewState>) {
    const next = updateTaskView(state, patch);
    const qs = serializeTaskView(next);
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // Keep the field in step with the URL (back button, a query typed elsewhere).
  useEffect(() => {
    setSearchDraft(state.q);
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

  const scrollReveal = useScrollReveal();
  /*
   * The field is on screen while the list is being scrolled up, while it holds
   * focus (so a tap on the freshly revealed field cannot make it disappear from
   * under the finger), and whenever a query is actually applied — an active
   * filter must never be invisible. `useScrollReveal` also reports the field as
   * revealed when the pane cannot scroll at all, which is the one case where
   * hiding it would put search out of reach: a list too short to gesture on.
   */
  const searchVisible = scrollReveal || searchFocused || state.q.trim().length > 0;

  const sections = useMemo(
    () => buildListSections(tasks, { zone, today: todayIn(zone) }),
    [tasks, zone],
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
    <div>
      <NavBar
        largeTitle
        title={
          <span className="inline-flex items-center gap-2">
            {activeList ? (
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: accentHex(activeList.color) }}
              />
            ) : null}
            {title}
          </span>
        }
        trailing={
          <>
            {/*
             * Desktop only. The floating band — and with it the action
             * button — is hidden at `lg`, so this is the only way to create a
             * task from a desktop-sized window.
             */}
            <HeaderActionButton
              aria-label="Add a task"
              icon={Plus}
              className="hidden lg:inline-flex"
              onClick={() => setQuickAddOpen(true)}
            />
            {/*
             * The active sort, as a quiet label rather than a control of its
             * own: it answers "what order is this list in?" without opening
             * anything, and tapping it opens the same menu the funnel does. The
             * hit slop is what keeps a 13px word a usable target; it is
             * invisible and costs no layout.
             */}
            <button
              type="button"
              onClick={() => setFilterOpen(true)}
              aria-label={`Sort: ${activeSort.label}. Change the sort`}
              className="relative shrink-0 rounded-ios px-1 text-footnote text-secondary pressable after:absolute after:-inset-2 after:content-['']"
            >
              {activeSort.label}
            </button>
            {/*
             * One menu for both halves of list setup: filtering and sorting.
             * It used to be a filter button next to the search field plus a
             * "Smart" select under it, which is two spellings of one idea.
             */}
            <HeaderActionButton
              aria-label="Filter and sort tasks"
              icon={Funnel}
              variant={chips.length ? 'filled' : 'tinted'}
              onClick={() => setFilterOpen(true)}
            />
            <HeaderActionButton
              aria-label={selectionMode ? 'Done selecting' : 'Select tasks'}
              icon={selectionMode ? X : CheckCheck}
              variant={selectionMode ? 'filled' : 'tinted'}
              onClick={() => (selectionMode ? exitSelection() : setSelectionMode(true))}
            />
          </>
        }
      >
        {/*
         * Search, revealed by a scroll-up gesture — see `useScrollReveal`. It is
         * hidden on load and stays hidden while the user reads down the list;
         * only scrolling back up brings it out (or a list too short to scroll,
         * where the field is always visible).
         *
         * It sits inside the nav bar's own band rather than in the scrolling
         * content, because the gesture has to bring it into *view*: a row in the
         * content is scrolled past the top of the pane by the same scroll that
         * asks for it back, so it would reveal off screen. In the chrome it drops
         * in under the title, which is exactly what iOS does.
         *
         * The row is a `grid` whose single track animates between `0fr` and `1fr`,
         * so a hidden field collapses to nothing instead of leaving a hole, and
         * `inert` takes it out of the tab order and off the accessibility tree: a
         * field nobody can see must not be reachable. The transition rides the
         * gesture, so the row unfolds as the list comes back up and folds away as
         * it goes down again.
         */}
        <div
          className={cn(
            'grid transition-[grid-template-rows,opacity] duration-200 ease-ios-out',
            searchVisible ? 'grid-rows-[1fr]' : 'grid-rows-[0fr] opacity-0',
          )}
          inert={!searchVisible}
        >
          <div className="overflow-hidden">
            <div className="px-4 pt-0.5 pb-2">
              <TextField
                aria-label="Search tasks"
                placeholder="Search"
                value={searchDraft}
                leading={<Search className="size-4" />}
                trailing={
                  searchDraft ? (
                    <IconButton aria-label="Clear search" icon={X} size="sm" onClick={() => setSearchDraft('')} />
                  ) : undefined
                }
                onChange={(event) => setSearchDraft(event.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
              />
            </div>
          </div>
        </div>
      </NavBar>

      {resource.error && resource.data === undefined ? (
        <EmptyState
          icon={CircleAlert}
          title="Couldn't load your tasks"
          description={resource.error}
          action={
            <Button variant="tinted" onClick={refresh}>
              Try again
            </Button>
          }
        />
      ) : loading ? (
        <div className="space-y-6 px-4">
          <Skeleton variant="text" lines={3} />
          <Skeleton variant="text" lines={3} />
        </div>
      ) : showEmpty ? (
        <EmptyTasks
          title={chips.length ? 'Nothing matches' : title}
          description={
            chips.length
              ? 'No task fits these filters. Clear one of them, or add something new.'
              : 'This list is empty. Add the first task and it will show up here.'
          }
          onAdd={() => setQuickAddOpen(true)}
        />
      ) : (
        <div>
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
        /*
         * Docked rather than `fixed` in place: the route wrapper's animation keeps
         * a transform on it, and a transform makes it the containing block for a
         * `fixed` descendant — which pinned this bar to the foot of the *content*,
         * off screen until the list was scrolled to its end. See `ViewportDock`.
         */
        <ViewportDock
          className="fixed inset-x-0 px-3"
          style={{ bottom: isDesktop ? '0.75rem' : 'var(--tabbar-total)', zIndex: 30 }}
        >
          <div className="material mx-auto flex max-w-md items-center gap-0.5 rounded-ios-xl p-1.5 shadow-ios-lg">
            <span className="tnum shrink-0 px-2 text-footnote text-secondary">
              {selectedIds.size} selected
            </span>
            <div className="ml-auto flex items-center">
              <IconButton
                aria-label="Complete selected tasks"
                icon={CheckCheck}
                disabled={selectedIds.size === 0}
                onClick={() => void runBulk('complete')}
              />
              <IconButton
                aria-label="Move selected tasks"
                icon={FolderInput}
                disabled={selectedIds.size === 0}
                onClick={() => setBulkSheet('move')}
              />
              <IconButton
                aria-label="Set the priority of the selected tasks"
                icon={Flag}
                disabled={selectedIds.size === 0}
                onClick={() => setBulkSheet('priority')}
              />
              <IconButton
                aria-label="Add a tag to the selected tasks"
                icon={TagIcon}
                disabled={selectedIds.size === 0}
                onClick={() => setBulkSheet('tag')}
              />
              <IconButton
                aria-label="Delete selected tasks"
                icon={Trash}
                className="text-danger"
                disabled={selectedIds.size === 0}
                onClick={() => setConfirmBulkDelete(true)}
              />
            </div>
          </div>
        </ViewportDock>
      ) : null}

      <TaskFilterSheet
        open={filterOpen}
        onOpenChange={setFilterOpen}
        state={state}
        lists={lists}
        tags={tags}
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

      <ConfirmDialog
        open={confirmBulkDelete}
        onOpenChange={setConfirmBulkDelete}
        title={`Delete ${selectedIds.size} task${selectedIds.size === 1 ? '' : 's'}?`}
        message="They will be removed from every list. This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={() => runBulk('delete')}
      />

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
