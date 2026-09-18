'use client';

/**
 * The task editor — every field a task has, in a Material dialog (full-screen on
 * a phone via `fullScreen` at the `sm` breakpoint).
 *
 * Saving is debounced (600ms after the last keystroke) and flushed immediately
 * when the dialog closes, so a user who edits and swipes away never loses a
 * change. Picking a value inside a sub-drawer makes the editor undismissible for
 * the duration, which keeps Escape from closing both at once.
 *
 * The date and time fields are `@mui/x-date-pickers` (Luxon adapter, matching the
 * `luxon` the rest of the app already uses); the pickers for repeat, reminders,
 * priority, list and tags are the shared MUI `Drawer`s in this folder.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DeleteIcon from '@mui/icons-material/Delete';
import FlagIcon from '@mui/icons-material/Flag';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import LabelIcon from '@mui/icons-material/Label';
import LinkIcon from '@mui/icons-material/Link';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import PushPinIcon from '@mui/icons-material/PushPin';
import RemoveIcon from '@mui/icons-material/Remove';
import RepeatIcon from '@mui/icons-material/Repeat';
import ScheduleIcon from '@mui/icons-material/Schedule';
import { AdapterLuxon } from '@mui/x-date-pickers/AdapterLuxon';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { TimePicker } from '@mui/x-date-pickers/TimePicker';
import { humanDuration, timeIn, todayIn } from '@/lib/dates';
import { describeRRule, weekdayOfDate } from '@/lib/rrule';
import { useResource } from '@/lib/store';
import type { Task } from '@/lib/types';
import type { BootstrapPayload } from '@/lib/view-types';
import { ListPicker } from './ListPicker';
import { PriorityPicker } from './PriorityPicker';
import { ReminderPicker, describeReminders } from './ReminderPicker';
import { RepeatPicker } from './RepeatPicker';
import { SubTaskList } from './SubTaskList';
import { TagPicker } from './TagPicker';
import { priorityColor, priorityLabel } from './priority';
import type { TaskPatch } from './payloads';
import { useTaskActions } from './useTaskActions';

/** Quiet period after the last edit before the PATCH goes out. */
const SAVE_DEBOUNCE_MS = 600;

type PickerId = 'repeat' | 'reminder' | 'priority' | 'list' | 'tags';

export interface TaskEditorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The task being edited; `null` renders an empty dialog body. */
  task: Task | null;
  /**
   * Called after a write lands. The views use it to refresh the list the task
   * came from — an editor write cannot be applied optimistically to a filtered
   * collection it does not own.
   */
  onSaved?: () => void;
}

/** One tappable field row: icon, label, current value, chevron. */
function EditorRow({
  icon,
  title,
  value,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  value: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <ListItemButton disabled={disabled} onClick={onClick} sx={{ minHeight: 48, gap: 1.5, px: 1 }}>
      <ListItemIcon sx={{ minWidth: 0, color: 'text.secondary' }}>{icon}</ListItemIcon>
      <ListItemText primary={title} slotProps={{ primary: { variant: 'body1' } }} sx={{ my: 0 }} />
      <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: '45%' }}>
        {value}
      </Typography>
      <ChevronRightIcon sx={{ fontSize: 18, color: 'text.disabled' }} aria-hidden />
    </ListItemButton>
  );
}

export function TaskEditorSheet({ open, onOpenChange, task, onSaved }: TaskEditorSheetProps) {
  const { data: bootstrap } = useResource<BootstrapPayload>('/api/bootstrap', undefined, { staleAfterMs: 60_000 });
  const zone = bootstrap?.settings.timezone ?? bootstrap?.user.timezone ?? 'utc';
  const timeFormat = bootstrap?.settings.timeFormat ?? '24h';
  const lists = bootstrap?.lists ?? [];
  const tags = bootstrap?.tags ?? [];

  const actions = useTaskActions(zone);
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));

  const [draft, setDraft] = useState<TaskPatch>({});
  const [picker, setPicker] = useState<PickerId | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  /** A save failure is surfaced inline rather than only as a toast. */
  const [saveError, setSaveError] = useState<string | null>(null);

  // The debounce and the close-flush both need the newest values without
  // re-creating themselves on every keystroke.
  const latest = useRef({ draft, task, actions, onSaved });
  latest.current = { draft, task, actions, onSaved };
  const editSeq = useRef(0);
  /** Set when a save failed, so the debounce does not hammer the server. */
  const blocked = useRef(false);

  useEffect(() => {
    setDraft({});
    setPicker(null);
    setConfirmOpen(false);
    setSaveError(null);
    blocked.current = false;
  }, [task?.id, open]);

  const flush = useCallback(async () => {
    const current = latest.current;
    const pending = current.draft;
    if (!current.task || Object.keys(pending).length === 0) return;

    const seq = editSeq.current;
    const saved = await current.actions.patch(current.task.id, pending);

    if (!saved) {
      // Nothing the user typed is dropped — the draft stays and the error was
      // already surfaced as a toast. Editing again re-arms the save.
      blocked.current = true;
      return;
    }
    setSaveError(null);
    current.onSaved?.();
    // Only clear the draft when no further edit arrived while this one was in
    // flight; otherwise those later edits would be wiped from the form.
    if (editSeq.current === seq) setDraft({});
  }, []);

  useEffect(() => {
    if (!open || !task) return;
    if (Object.keys(draft).length === 0 || blocked.current) return;
    if (!actions.online) return;
    const timer = window.setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, open, task, actions.online, flush]);

  function edit(patch: TaskPatch) {
    editSeq.current += 1;
    blocked.current = false;
    setDraft((current) => ({ ...current, ...patch }));
  }

  function handleOpenChange(next: boolean) {
    if (!next) void flush();
    onOpenChange(next);
  }

  /* ------------------------------------------------------------------ values */

  const fallbackDueTime = task?.dueAtMs && !task.isAllDay ? timeIn(task.dueAtMs, zone) : null;

  const title = draft.title ?? task?.title ?? '';
  const notes = draft.notes ?? task?.notes ?? '';
  const url = draft.url ?? task?.url ?? '';
  const dueDate = draft.clearDue ? null : draft.dueDate !== undefined ? draft.dueDate : (task?.dueDate ?? null);
  const dueTime =
    draft.clearDue || draft.dueTime === null
      ? null
      : draft.dueTime !== undefined
        ? draft.dueTime
        : fallbackDueTime;
  const recurrenceRule =
    draft.clearRecurrence || draft.recurrenceRule === null
      ? null
      : draft.recurrenceRule !== undefined
        ? draft.recurrenceRule
        : (task?.recurrenceRule ?? null);
  const reminderOffsets =
    draft.clearReminders
      ? []
      : draft.reminders !== undefined
        ? draft.reminders.map((item) => item.offsetMinutes).filter((value): value is number => value !== null)
        : (task?.reminders ?? []).map((item) => item.offsetMinutes).filter((value): value is number => value !== null);
  const priority = draft.priority ?? task?.priority ?? 'none';
  const listId = draft.listId !== undefined ? draft.listId : (task?.listId ?? null);
  const tagIds = draft.tagIds ?? task?.tagIds ?? [];
  const estimateMinutes = (draft.estimateMinutes !== undefined ? draft.estimateMinutes : task?.estimateMinutes) ?? 0;
  const isPinned = draft.isPinned ?? task?.isPinned ?? false;
  const subtasks = task?.subtasks ?? [];

  const activeList = lists.find((list) => list.id === listId) ?? null;
  const selectedTags = tags.filter((tag) => tagIds.includes(tag.id));
  const repeatAnchorDay = weekdayOfDate(dueDate ?? todayIn(zone));

  const disabled = !actions.online;

  const dateValue = dueDate ? DateTime.fromISO(dueDate, { zone }) : null;
  const timeValue = dueTime
    ? DateTime.fromISO(`${dueDate ?? todayIn(zone)}T${dueTime}`, { zone })
    : null;

  return (
    <LocalizationProvider dateAdapter={AdapterLuxon}>
      <Dialog
        open={open}
        onClose={(_event, reason) => {
          // A sub-picker is open: Escape and the backdrop must not close the
          // editor out from under it.
          if (picker || confirmOpen) return;
          handleOpenChange(false);
        }}
        fullScreen={fullScreen}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Task</DialogTitle>
        <DialogContent dividers sx={{ pb: 2 }}>
          <List disablePadding>
            <Box sx={{ px: 1, pt: 1 }}>
              <TextField
                variant="standard"
                fullWidth
                multiline
                maxRows={3}
                placeholder="Title"
                value={title}
                disabled={disabled}
                onChange={(event) => edit({ title: event.target.value })}
                onKeyDown={(event) => {
                  // A title is one line; Enter files it away instead of adding a newline.
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
                slotProps={{
                  htmlInput: { 'aria-label': 'Title', style: { fontSize: '1.25rem', fontWeight: 600 } },
                }}
              />
            </Box>
            <Divider sx={{ my: 1 }} />
            <Box sx={{ px: 1 }}>
              <TextField
                variant="standard"
                fullWidth
                multiline
                minRows={2}
                maxRows={8}
                placeholder="Notes"
                value={notes}
                disabled={disabled}
                onChange={(event) => edit({ notes: event.target.value })}
                slotProps={{ htmlInput: { 'aria-label': 'Notes' } }}
              />
            </Box>
          </List>

          <Divider sx={{ my: 2 }} />

          <Stack spacing={1.5}>
            <DatePicker
              label="Due date"
              value={dateValue}
              disabled={disabled}
              onChange={(value) => {
                if (!value) {
                  edit({ clearDue: true, dueDate: null, dueTime: null });
                  return;
                }
                edit({ dueDate: value.toISODate(), clearDue: false });
              }}
              slotProps={{
                textField: { fullWidth: true, size: 'small' },
                field: { clearable: true },
              }}
            />
            <TimePicker
              label="Time"
              value={timeValue}
              ampm={timeFormat === '12h'}
              disabled={disabled || !dueDate}
              onChange={(value) => {
                if (!value) {
                  edit({ dueTime: null, clearDue: false });
                  return;
                }
                edit({ dueDate: dueDate ?? todayIn(zone), dueTime: value.toFormat('HH:mm'), clearDue: false });
              }}
              slotProps={{
                textField: { fullWidth: true, size: 'small' },
                field: { clearable: true },
              }}
            />
          </Stack>

          <List disablePadding sx={{ mt: 2 }}>
            <EditorRow
              icon={<RepeatIcon sx={{ fontSize: 20 }} aria-hidden />}
              title="Repeat"
              value={describeRRule(recurrenceRule) ?? 'Never'}
              disabled={disabled}
              onClick={() => setPicker('repeat')}
            />
            <EditorRow
              icon={<NotificationsNoneIcon sx={{ fontSize: 20 }} aria-hidden />}
              title="Reminder"
              value={describeReminders(reminderOffsets)}
              disabled={disabled}
              onClick={() => setPicker('reminder')}
            />
            <EditorRow
              icon={<FlagIcon sx={{ fontSize: 20, color: priorityColor(priority) }} aria-hidden />}
              title="Priority"
              value={priorityLabel(priority)}
              disabled={disabled}
              onClick={() => setPicker('priority')}
            />
          </List>

          <Divider sx={{ my: 2 }} />

          <List disablePadding>
            <EditorRow
              icon={<FormatListBulletedIcon sx={{ fontSize: 20 }} aria-hidden />}
              title="List"
              value={activeList?.name ?? 'No list'}
              disabled={disabled}
              onClick={() => setPicker('list')}
            />
            <EditorRow
              icon={<LabelIcon sx={{ fontSize: 20 }} aria-hidden />}
              title="Tags"
              value={selectedTags.length ? selectedTags.map((tag) => `#${tag.name}`).join(' ') : 'None'}
              disabled={disabled}
              onClick={() => setPicker('tags')}
            />
            <ListItem
              disablePadding
              secondaryAction={
                <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                  <IconButton
                    aria-label="Decrease estimated time"
                    disabled={disabled || estimateMinutes === 0}
                    onClick={() => {
                      const next = Math.max(0, estimateMinutes - 5);
                      edit({ estimateMinutes: next === 0 ? null : next });
                    }}
                  >
                    <RemoveIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                  <Typography variant="body2" sx={{ minWidth: 48, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                    {estimateMinutes === 0 ? 'None' : humanDuration(estimateMinutes)}
                  </Typography>
                  <IconButton
                    aria-label="Increase estimated time"
                    disabled={disabled || estimateMinutes >= 1440}
                    onClick={() => edit({ estimateMinutes: Math.min(1440, estimateMinutes + 5) })}
                  >
                    <AddIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </Stack>
              }
            >
              <ListItemIcon sx={{ minWidth: 0, mr: 1.5, color: 'text.secondary' }}>
                <ScheduleIcon sx={{ fontSize: 20 }} aria-hidden />
              </ListItemIcon>
              <ListItemText primary="Estimated time" slotProps={{ primary: { variant: 'body1' } }} sx={{ my: 0 }} />
            </ListItem>

            <Box sx={{ px: 1, py: 1 }}>
              <TextField
                variant="standard"
                fullWidth
                placeholder="https://…"
                value={url}
                disabled={disabled}
                onChange={(event) => edit({ url: event.target.value })}
                slotProps={{
                  htmlInput: { 'aria-label': 'Link', inputMode: 'url' },
                  input: {
                    startAdornment: <LinkIcon sx={{ fontSize: 18, color: 'text.secondary', mr: 1 }} aria-hidden />,
                  },
                }}
              />
            </Box>

            <ListItem
              disablePadding
              secondaryAction={
                <Switch
                  checked={isPinned}
                  disabled={disabled}
                  /*
                   * A switch keeps one name and reports its state through
                   * `aria-checked` — a name that flips between "Pin…" and
                   * "Unpin…" would be announced as a different control.
                   */
                  slotProps={{ input: { 'aria-label': 'Pin to top' } }}
                  onChange={(event) => edit({ isPinned: event.target.checked })}
                />
              }
            >
              <ListItemIcon sx={{ minWidth: 0, mr: 1.5, color: 'text.secondary' }}>
                <PushPinIcon sx={{ fontSize: 20 }} aria-hidden />
              </ListItemIcon>
              <ListItemText primary="Pin to top" slotProps={{ primary: { variant: 'body1' } }} sx={{ my: 0 }} />
            </ListItem>
          </List>

          <Divider sx={{ my: 2 }} />

          <Typography variant="subtitle2" sx={{ px: 1, pb: 1 }}>
            Subtasks
          </Typography>
          <SubTaskList
            subtasks={subtasks}
            disabled={disabled}
            onToggle={(subtask) =>
              void actions.complete(subtask, subtask.status === 'completed').then((result) => {
                if (result) onSaved?.();
              })
            }
            onRename={(subtask, nextTitle) =>
              void actions.patch(subtask.id, { title: nextTitle }).then((result) => {
                if (result) onSaved?.();
              })
            }
            onDelete={(subtask) =>
              void actions.remove(subtask.id).then((removed) => {
                if (removed) onSaved?.();
              })
            }
            onAdd={async (nextTitle) => {
              if (!task) return;
              const created = await actions.create({ title: nextTitle, parentId: task.id, listId });
              if (created) onSaved?.();
            }}
          />
        </DialogContent>

        <DialogActions
          sx={{
            flexDirection: 'column',
            alignItems: 'stretch',
            gap: 1,
            px: 2,
            pt: 1.5,
            pb: 'max(1rem, env(safe-area-inset-bottom, 0px))',
          }}
        >
          {disabled ? (
            <Typography variant="caption" color="text.secondary">
              {actions.offlineNotice}
            </Typography>
          ) : null}
          {actions.isSaving ? (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', color: 'text.secondary' }}>
              <CircularProgress size={14} aria-label="Saving" />
              <Typography variant="caption">Saving…</Typography>
            </Stack>
          ) : null}
          <Button
            variant="contained"
            color="error"
            disableElevation
            fullWidth
            startIcon={<DeleteIcon />}
            disabled={disabled || !task}
            onClick={() => setConfirmOpen(true)}
          >
            Delete task
          </Button>
        </DialogActions>
      </Dialog>

      <RepeatPicker
        open={picker === 'repeat'}
        onOpenChange={(next) => setPicker(next ? 'repeat' : null)}
        value={recurrenceRule}
        dueDay={repeatAnchorDay}
        onChange={(rule) => edit({ recurrenceRule: rule, clearRecurrence: rule === null })}
      />
      <ReminderPicker
        open={picker === 'reminder'}
        onOpenChange={(next) => setPicker(next ? 'reminder' : null)}
        value={reminderOffsets}
        hasDueDate={Boolean(dueDate)}
        onChange={(offsets) =>
          edit({
            reminders: offsets.map((offsetMinutes) => ({ offsetMinutes })),
            clearReminders: offsets.length === 0,
          })
        }
      />
      <PriorityPicker
        open={picker === 'priority'}
        onOpenChange={(next) => setPicker(next ? 'priority' : null)}
        value={priority}
        onChange={(next) => edit({ priority: next })}
      />
      <ListPicker
        open={picker === 'list'}
        onOpenChange={(next) => setPicker(next ? 'list' : null)}
        lists={lists}
        value={listId}
        onChange={(next) => edit({ listId: next })}
      />
      <TagPicker
        open={picker === 'tags'}
        onOpenChange={(next) => setPicker(next ? 'tags' : null)}
        tags={tags}
        value={tagIds}
        onChange={(next) => edit({ tagIds: next })}
        disabled={disabled}
        onCreate={actions.createTag}
      />

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Delete this task?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {`“${title}” will be removed from every list. This cannot be undone.`}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            disableElevation
            onClick={async () => {
              if (!task) return;
              const deleted = await actions.remove(task.id);
              if (!deleted) {
                setSaveError('Could not delete the task.');
                return;
              }
              setDraft({});
              onSaved?.();
              onOpenChange(false);
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={saveError !== null}
        autoHideDuration={4000}
        onClose={() => setSaveError(null)}
        message={saveError}
      />
    </LocalizationProvider>
  );
}
