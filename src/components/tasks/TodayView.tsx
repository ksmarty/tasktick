'use client';

/**
 * The Today screen: everything that is due or overdue, in one chronological
 * scroll, with today's progress in the header.
 *
 * Data comes from the bootstrap agenda (already bucketed server-side), and every
 * checkbox tick publishes an optimistic agenda, so the row moves immediately and
 * the cache revalidates behind it. MUI owns the chrome: an `AppBar` header, a
 * `Paper` progress card with a determinate `CircularProgress`, and the same
 * `TaskListSection` the list screen uses.
 */
import { useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useRouter } from 'next/navigation';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import SearchIcon from '@mui/icons-material/Search';
import type { AgendaBuckets } from '@/lib/agenda-types';
import { formatFullDate } from '@/lib/dates';
import { useResource } from '@/lib/store';
import type { Task } from '@/lib/types';
import type { BootstrapPayload } from '@/lib/view-types';
import { EmptyTasks } from './EmptyTasks';
import { HeaderActionButton } from './HeaderActionButton';
import { QuickAddBar } from './QuickAddBar';
import { usePrimaryAction } from '@/lib/events';
import { TaskEditorSheet } from './TaskEditorSheet';
import { TaskListSection } from './TaskListSection';
import { removeFromAgenda, reorderAgendaSection, setAgendaStatus } from './optimistic';
import { buildTodaySections, countRemaining, todayProgress, type TaskSection } from './sections';
import { useTaskActions } from './useTaskActions';

export function TodayView() {
  const router = useRouter();
  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');
  const data = bootstrap.data;

  const zone = data?.settings.timezone ?? data?.user.timezone ?? 'utc';
  const timeFormat = data?.settings.timeFormat ?? '24h';
  const weekStartsOn = data?.settings.weekStartsOn ?? 1;
  const actions = useTaskActions(zone);

  const [quickAddOpen, setQuickAddOpen] = useState(false);

  // The shell's action button asks the mounted view for its primary create action.
  usePrimaryAction(openQuickAdd);
  const [editor, setEditor] = useState<{ open: boolean; task: Task | null }>({ open: false, task: null });

  /**
   * Opens quick add *inside* the gesture that asked for it — see `TasksView` for
   * why: iOS raises the keyboard only for a `focus()` in the task that handled
   * the tap, and the dialog's panel is a couple of renders away otherwise.
   */
  function openQuickAdd() {
    flushSync(() => setQuickAddOpen(true));
  }

  const sections = useMemo(() => buildTodaySections(data?.agenda), [data?.agenda]);
  const remaining = countRemaining(sections);
  const progress = todayProgress(data?.agenda);
  const listColors = useMemo(
    () => new Map((data?.lists ?? []).map((list) => [list.id, list.color])),
    [data?.lists],
  );

  /** Publishes a new agenda without mutating the resource's own object. */
  function mutateAgenda(update: (agenda: AgendaBuckets) => AgendaBuckets) {
    bootstrap.mutate((current) => (current ? { ...current, agenda: update(current.agenda) } : current));
  }

  /**
   * Runs a write with an optimistic agenda change, restoring the previous agenda
   * if the write fails — a failed request must never leave the row looking saved.
   */
  function optimistic(
    update: (agenda: AgendaBuckets) => AgendaBuckets,
    write: () => Promise<unknown>,
  ) {
    const snapshot = bootstrap.data;
    mutateAgenda(update);
    void write().then((result) => {
      if (result === undefined && snapshot) bootstrap.mutate(snapshot);
    });
  }

  function toggleTask(task: Task) {
    const undo = task.status === 'completed';
    optimistic(
      (agenda) => setAgendaStatus(agenda, task.id, undo ? 'todo' : 'completed', Date.now()),
      () => actions.complete(task, undo),
    );
  }

  const refresh = () => void bootstrap.refresh();

  function wontDoTask(task: Task) {
    optimistic(
      (agenda) => setAgendaStatus(agenda, task.id, 'wont_do', Date.now()),
      () => actions.patch(task.id, { status: 'wont_do' }),
    );
  }

  function deleteTask(task: Task) {
    optimistic(
      (agenda) => removeFromAgenda(agenda, new Set([task.id])),
      () => actions.remove(task.id),
    );
  }

  function reorderSection(section: TaskSection, orderedIds: string[]) {
    optimistic(
      (agenda) => reorderAgendaSection(agenda, section.id, orderedIds),
      () => actions.reorder(orderedIds),
    );
  }

  const loading = data === undefined && !bootstrap.error;
  const ratio = progress.total === 0 ? 0 : Math.round(progress.value * 100);

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
          <Typography variant="h6" component="h1" noWrap sx={{ flex: 1 }}>
            Today
          </Typography>
          <HeaderActionButton
            aria-label="Search everything"
            icon={SearchIcon}
            onClick={() => router.push('/search')}
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
      </AppBar>

      {data ? (
        <Box sx={{ px: 1, pt: 0.5, pb: 1 }}>
          {/*
           * The ring and the copy are one block, so they share one surface. The
           * fraction is absolutely positioned inside the ring, so it reads as the
           * ring's own label rather than as a datum beside it.
           */}
          <Paper
            variant="outlined"
            sx={{ display: 'flex', alignItems: 'center', gap: 1.75, px: 2, py: 1.5, borderRadius: 3 }}
          >
            <Box
              sx={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}
              role="progressbar"
              aria-valuenow={ratio}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${progress.completed} of ${progress.total} tasks done today`}
            >
              <CircularProgress variant="determinate" value={ratio} size={54} thickness={5} />
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Typography variant="caption" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {progress.completed}/{progress.total}
                </Typography>
              </Box>
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" noWrap sx={{ fontWeight: 600 }}>
                {remaining === 0 ? 'Nothing left for today' : `${remaining} task${remaining === 1 ? '' : 's'} left`}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap component="p">
                {formatFullDate(Date.now(), { zone, timeFormat, weekStartsOn })}
              </Typography>
            </Box>
          </Paper>
        </Box>
      ) : (
        <Box sx={{ px: 1, pt: 1, pb: 1.5 }}>
          <Skeleton variant="rounded" height={80} />
        </Box>
      )}

      {!actions.online ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, pb: 1 }}>
          {actions.offlineNotice}
        </Typography>
      ) : null}

      {bootstrap.error && !data ? (
        <Stack spacing={1} sx={{ alignItems: 'center', px: 4, py: 6, textAlign: 'center' }}>
          <ErrorOutlineIcon sx={{ fontSize: 40, color: 'text.disabled' }} aria-hidden />
          <Typography variant="subtitle1" component="h2">
            Couldn&apos;t load today
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {bootstrap.error}
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
      ) : sections.length === 0 ? (
        <EmptyTasks
          title="Today is clear"
          description="Nothing is due and nothing is overdue. Add something now, or enjoy the quiet."
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
              disabled={!actions.online}
            />
          ))}
        </Box>
      )}

      <QuickAddBar open={quickAddOpen} onOpenChange={setQuickAddOpen} onCreated={refresh} />
      <TaskEditorSheet
        open={editor.open}
        task={editor.task}
        onSaved={refresh}
        onOpenChange={(open) => setEditor((current) => ({ ...current, open }))}
      />
    </Box>
  );
}
