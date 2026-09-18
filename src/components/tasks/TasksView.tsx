'use client';

/**
 * The task list screen: every open task, grouped by urgency.
 *
 * One pass over `/api/tasks`, bucketed into Pinned / Overdue / Next 7 days /
 * Later by `buildListSections` — the user does not choose a window here, they
 * read one list. Filtering and sorting both live in the header's single menu.
 *
 * ## Search
 *
 * The scroll-reveal field is gone. It was a bespoke interaction built on a
 * hand-rolled hook (`useScrollReveal.ts`) with carefully tuned hysteresis, and
 * Material apps put a search affordance in the app bar instead. Search now lives
 * behind a MUI `IconButton` in the app bar: the button expands a
 * `Collapse`-animated `TextField` directly under the toolbar, and the field stays
 * open while a query is applied so an active filter can never be invisible. That
 * removes the whole scroll-driven mechanism — the hysteresis, the out-of-flow
 * positioning, and the shell's guaranteed overscroll that only existed so the
 * gesture was always available.
 *
 * The URL is the state — `?list=`, `?tag=`, `?window=`, `?q=`, `?sort=`,
 * `?priority=` — so a filtered view can be linked, bookmarked and reloaded, and
 * the resource cache key follows from it automatically.
 */
import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import FilterAltIcon from '@mui/icons-material/FilterAlt';
import FlagIcon from '@mui/icons-material/Flag';
import LabelIcon from '@mui/icons-material/Label';
import SearchIcon from '@mui/icons-material/Search';
import { accentHex } from '@/lib/colors';
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
   * the tap. The dialog arrives through a portal, so a plain `setState` here
   * leaves the input a couple of renders away — by which time the gesture is
   * over and the keyboard never comes up, however focused the field looks.
   * Flushing the open synchronously means the field is in the DOM before this
   * handler returns, and the dialog's layout effect can focus it while the tap is
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

  /** The search field is visible on demand, and always while a query is applied. */
  const searchVisible = searchOpen || state.q.trim().length > 0;

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
    <Box>
      <AppBar
        position="sticky"
        color="default"
        elevation={0}
        sx={{
          bgcolor: 'background.default',
          backgroundImage: 'none',
          borderBottom: 1,
          borderColor: 'divider',
          // The app paints under the Dynamic Island, so the bar carries the inset.
          pt: 'env(safe-area-inset-top, 0px)',
        }}
      >
        <Toolbar sx={{ gap: 0.75, minHeight: 56, px: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: 1 }}>
            {activeList ? (
              <Box
                aria-hidden
                sx={{ width: 10, height: 10, flexShrink: 0, borderRadius: '50%', bgcolor: accentHex(activeList.color) }}
              />
            ) : null}
            <Typography variant="h6" component="h1" noWrap>
              {title}
            </Typography>
          </Box>
          {/*
           * The active sort, as a quiet label rather than a control of its own:
           * it answers "what order is this list in?" without opening anything,
           * and tapping it opens the same menu the funnel does.
           */}
          <Button
            size="small"
            color="inherit"
            onClick={() => setFilterOpen(true)}
            aria-label={`Sort: ${activeSort.label}. Change the sort`}
            sx={{ minWidth: 0, px: 0.5, flexShrink: 0, color: 'text.secondary', textTransform: 'none' }}
          >
            {activeSort.label}
          </Button>
          <HeaderActionButton
            aria-label={searchVisible ? 'Hide search' : 'Show search'}
            icon={SearchIcon}
            variant={searchVisible ? 'filled' : 'tinted'}
            onClick={() => setSearchOpen((value) => !value)}
          />
          {/*
           * One menu for both halves of list setup: filtering and sorting.
           */}
          <HeaderActionButton
            aria-label="Filter and sort tasks"
            icon={FilterAltIcon}
            variant={chips.length ? 'filled' : 'tinted'}
            onClick={() => setFilterOpen(true)}
          />
          <HeaderActionButton
            aria-label={selectionMode ? 'Done selecting' : 'Select tasks'}
            icon={selectionMode ? CloseIcon : DoneAllIcon}
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
            icon={AddIcon}
            onClick={openQuickAdd}
            sx={{ display: { xs: 'none', lg: 'inline-flex' } }}
          />
        </Toolbar>

        {/*
         * Search, expanded from the app-bar button. It is in the header's own
         * flow now, not an out-of-flow overlay: there is no scroll gesture to
         * cooperate with, so the field simply pushes the list down while it is
         * open. An applied query keeps it visible, because an active filter must
         * never be invisible.
         */}
        <Collapse in={searchVisible} timeout={200}>
          <Box sx={{ px: 1.5, pb: 1 }}>
            <TextField
              type="search"
              size="small"
              fullWidth
              value={searchDraft}
              placeholder="Search"
              onChange={(event) => setSearchDraft(event.target.value)}
              slotProps={{
                htmlInput: { 'aria-label': 'Search tasks' },
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon sx={{ fontSize: 18, color: 'text.secondary' }} aria-hidden />
                    </InputAdornment>
                  ),
                  endAdornment: searchDraft ? (
                    <InputAdornment position="end">
                      <IconButton aria-label="Clear search" size="small" onClick={() => setSearchDraft('')}>
                        <CloseIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                    </InputAdornment>
                  ) : undefined,
                },
              }}
            />
          </Box>
        </Collapse>
      </AppBar>

      {resource.error && resource.data === undefined ? (
        <Stack spacing={1} sx={{ alignItems: 'center', px: 4, py: 6, textAlign: 'center' }}>
          <ErrorOutlineIcon sx={{ fontSize: 40, color: 'text.disabled' }} aria-hidden />
          <Typography variant="subtitle1" component="h2">
            Couldn&apos;t load your tasks
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {resource.error}
          </Typography>
          <Button variant="outlined" onClick={refresh} sx={{ mt: 1 }}>
            Try again
          </Button>
        </Stack>
      ) : loading ? (
        <Stack spacing={1} sx={{ px: 2, py: 2 }}>
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} variant="text" height={28} />
          ))}
        </Stack>
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
        <Box>
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
        </Box>
      )}

      {/*
       * The bulk-action bar is the only thing left that wants the band above the
       * tab bar: adding a task is the shell's action button opening the dialog,
       * the same gesture as every other screen.
       */}
      {selectionMode ? (
        <ViewportDock
          sx={{
            position: 'fixed',
            left: 0,
            right: 0,
            px: 1.5,
            bottom: isDesktop ? '0.75rem' : 'calc(env(safe-area-inset-bottom, 0px) + 5rem)',
            zIndex: 30,
          }}
        >
          <Paper
            elevation={6}
            sx={{
              mx: 'auto',
              maxWidth: 448,
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              p: 0.75,
              borderRadius: 3,
            }}
          >
            <Typography
              variant="caption"
              sx={{ px: 1, flexShrink: 0, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}
            >
              {selectedIds.size} selected
            </Typography>
            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center' }}>
              <IconButton
                aria-label="Complete selected tasks"
                disabled={selectedIds.size === 0}
                onClick={() => void runBulk('complete')}
              >
                <DoneAllIcon />
              </IconButton>
              <IconButton
                aria-label="Move selected tasks"
                disabled={selectedIds.size === 0}
                onClick={() => setBulkSheet('move')}
              >
                <DriveFileMoveIcon />
              </IconButton>
              <IconButton
                aria-label="Set the priority of the selected tasks"
                disabled={selectedIds.size === 0}
                onClick={() => setBulkSheet('priority')}
              >
                <FlagIcon />
              </IconButton>
              <IconButton
                aria-label="Add a tag to the selected tasks"
                disabled={selectedIds.size === 0}
                onClick={() => setBulkSheet('tag')}
              >
                <LabelIcon />
              </IconButton>
              <IconButton
                aria-label="Delete selected tasks"
                color="error"
                disabled={selectedIds.size === 0}
                onClick={() => setConfirmBulkDelete(true)}
              >
                <DeleteIcon />
              </IconButton>
            </Box>
          </Paper>
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

      <Dialog open={confirmBulkDelete} onClose={() => setConfirmBulkDelete(false)}>
        <DialogTitle>{`Delete ${selectedIds.size} task${selectedIds.size === 1 ? '' : 's'}?`}</DialogTitle>
        <DialogContent>
          <DialogContentText>They will be removed from every list. This cannot be undone.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmBulkDelete(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            disableElevation
            onClick={() => {
              setConfirmBulkDelete(false);
              void runBulk('delete');
            }}
          >
            Delete
          </Button>
        </DialogActions>
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
    </Box>
  );
}
