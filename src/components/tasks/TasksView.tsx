'use client';

/**
 * The task list screen: a filtered, grouped, reorderable view of `/api/tasks`.
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
  Chip,
  ConfirmDialog,
  EmptyState,
  IconButton,
  NavBar,
  Select,
  Skeleton,
  TextField,
} from '@/components/ui';
import { accentHex } from '@/lib/colors';
import { todayIn } from '@/lib/dates';
import { useIsDesktop, useResource } from '@/lib/store';
import type { Task } from '@/lib/types';
import type { BootstrapPayload } from '@/lib/view-types';
import { EmptyTasks } from './EmptyTasks';
import { TaskFilterSheet } from './FilterMenu';
import { ListPicker } from './ListPicker';
import { PriorityPicker } from './PriorityPicker';
import { QuickAddBar } from './QuickAddBar';
import { usePrimaryAction } from '@/lib/events';
import { TagPicker } from './TagPicker';
import { TaskEditorSheet } from './TaskEditorSheet';
import { TaskFilterBar } from './TaskFilterBar';
import { TaskListSection } from './TaskListSection';
import {
  activeFilters,
  clearFilter,
  parseTaskView,
  serializeTaskView,
  shouldGroupByDay,
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
  const listNames = useMemo(() => new Map(lists.map((list) => [list.id, list.name])), [lists]);
  const listColors = useMemo(() => new Map(lists.map((list) => [list.id, list.color])), [lists]);

  const [searchDraft, setSearchDraft] = useState(state.q);
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

  // Keep the field in step with the URL (back button, chip removal).
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

  const sections = useMemo(
    () =>
      buildListSections(tasks, {
        zone,
        today: todayIn(zone),
        groupByDay: shouldGroupByDay(state.sort),
        title,
      }),
    [tasks, zone, state.sort, title],
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
             * Desktop only: on a phone the floating `QuickAddFab` is the add
             * affordance, and a second one in the corner is just noise.
             */}
            <IconButton
              aria-label="Add a task"
              icon={Plus}
              className="hidden lg:inline-flex"
              onClick={() => setQuickAddOpen(true)}
            />
            <IconButton
              aria-label={selectionMode ? 'Done selecting' : 'Select tasks'}
              icon={selectionMode ? X : CheckCheck}
              variant={selectionMode ? 'tinted' : 'plain'}
              onClick={() => (selectionMode ? exitSelection() : setSelectionMode(true))}
            />
          </>
        }
      />

      {/*
       * The window filter sits directly under the title: the list below it is
       * one of these four slices of the data, and Today (the old tab) is one of
       * them. Kept out of the search/count block so it reads as chrome for the
       * list rather than as part of the search row.
       */}
      <TaskFilterBar className="pt-1 pb-1.5" />

      <div className="space-y-2 px-4 pt-1 pb-3">
        <div className="flex items-center gap-2">
          <TextField
            className="flex-1"
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
          />
          <IconButton
            aria-label="Filter tasks"
            icon={Funnel}
            variant={chips.length ? 'tinted' : 'plain'}
            onClick={() => setFilterOpen(true)}
          />
        </div>

        {chips.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {chips.map((chip) => (
              <Chip
                key={chip.key}
                onRemove={() => applyState(clearFilter(state, chip.key))}
                removeLabel={`Clear ${chip.label}`}
                color={
                  chip.key === 'list'
                    ? (lists.find((list) => list.id === chip.value)?.color ?? undefined)
                    : chip.key === 'tag'
                      ? (tags.find((tag) => tag.id === chip.value)?.color ?? undefined)
                      : undefined
                }
              >
                {chip.label}
              </Chip>
            ))}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <span className="tnum text-footnote text-secondary">
            {loading ? 'Loading…' : `${tasks.length} task${tasks.length === 1 ? '' : 's'}`}
          </span>
          <Select
            label="Sort"
            className="w-40"
            value={state.sort}
            options={TASK_SORTS.map((sort) => ({ value: sort.value, label: sort.label }))}
            onChange={(value) => {
              const next = TASK_SORTS.find((sort) => sort.value === value);
              if (next) applyState({ sort: next.value });
            }}
          />
        </div>
      </div>

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
              listNames={listNames}
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

      <div className="pt-4 pb-6">
        <QuickAddBar
          variant="inline"
          listId={state.listId ?? data?.inboxListId ?? null}
          onCreated={refresh}
        />
      </div>

      {selectionMode ? (
        <div
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
        </div>
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
        variant="sheet"
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
