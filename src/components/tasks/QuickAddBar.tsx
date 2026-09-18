'use client';

/**
 * Natural-language quick add.
 *
 * One presentation: a MUI `Dialog` anchored to the bottom of the screen, opened
 * from the shell's action button, on every screen alike. It parses on every
 * keystroke (`parseQuickAdd`) and shows exactly what was understood as tinted
 * chips. The caret lands in the field the moment the dialog opens, and a
 * successful submit closes it — one task is one gesture. A submit that *fails*
 * leaves the dialog open with the sentence still in the field, so nothing typed
 * is lost to an error.
 *
 * ## Focus timing (do not "simplify" this)
 *
 * iOS raises the keyboard only when `focus()` runs in the task that handled the
 * tap. MUI's `Dialog` mounts through a `Portal` and, by default, animates in
 * with `Fade` — both of which can put the input a frame away from the tap. Two
 * things keep the old guarantee:
 *
 *   - `transitionDuration={0}` so the panel is not faded in over 225ms; and
 *   - the focus runs in a *layout* effect, not a passive one, so it belongs to
 *     the same commit that `open` arrived in. `TasksView.openQuickAdd` flushes
 *     that commit synchronously inside the tap (see `usePrimaryAction`).
 *
 * `autoFocus` is left on the field as a second, React-native path (ReactDOM
 * focuses an `autoFocus` node during the commit phase), so the caret is in the
 * field even if a future MUI change moves the portal a render later. There is a
 * probe for this: see the focus-timing report.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import InputAdornment from '@mui/material/InputAdornment';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import KeyboardReturnIcon from '@mui/icons-material/KeyboardReturn';
import { parseQuickAdd, type QuickAddResult } from '@/lib/nlp';
import { useResource } from '@/lib/store';
import type { Task } from '@/lib/types';
import type { BootstrapPayload } from '@/lib/view-types';
import { useToast } from '@/components/app/Toast';
import { dueLabel } from './TaskMeta';
import { planQuickAdd, quickAddChips, type QuickAddChip, type QuickAddContext } from './quick-add';
import { useTaskActions } from './useTaskActions';

export interface QuickAddBarProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Dismissal (backdrop tap, Escape). */
  onOpenChange: (open: boolean) => void;
  /** The list the task lands in — the list being viewed, or the list's own row. */
  listId?: string | null;
  onCreated?: (task: Task) => void;
}

interface QuickAddState {
  value: string;
  setValue: (value: string) => void;
  result: QuickAddResult;
  chips: QuickAddChip[];
  /** Resolves `true` once the task exists, `false` when the submit did not go through. */
  submit: () => Promise<boolean>;
  online: boolean;
  offlineNotice: string;
  busy: boolean;
}

function useQuickAdd(listId: string | null, onCreated?: (task: Task) => void): QuickAddState {
  const { data: bootstrap } = useResource<BootstrapPayload>('/api/bootstrap', undefined, { staleAfterMs: 60_000 });
  const zone = bootstrap?.settings.timezone ?? bootstrap?.user.timezone ?? 'utc';
  const weekStartsOn = bootstrap?.settings.weekStartsOn ?? 1;
  const timeFormat = bootstrap?.settings.timeFormat ?? '24h';

  const actions = useTaskActions(zone);
  const { toast } = useToast();
  const [value, setValue] = useState('');

  const result = useMemo(() => parseQuickAdd(value, { zone, weekStartsOn }), [value, zone, weekStartsOn]);

  const context = useMemo<QuickAddContext>(
    () => ({
      zone,
      timeFormat,
      lists: bootstrap?.lists ?? [],
      listId,
      inboxListId: bootstrap?.inboxListId ?? null,
      defaultListId: bootstrap?.settings.defaultListId ?? null,
      nowMs: Date.now(),
    }),
    [bootstrap, listId, timeFormat, zone],
  );

  const chips = useMemo(
    () => quickAddChips(result, context),
    // `result` changes on every keystroke, which is exactly when the chips must.
    [result, context],
  );

  const submit = useCallback(async () => {
    const raw = value.trim();
    if (!raw) return false;

    const plan = planQuickAdd(result, context);
    if (!plan) {
      toast({ title: 'Give the task a name', description: 'Type a title before adding it.', variant: 'error' });
      return false;
    }

    let payload = plan.payload;
    if (plan.createListName) {
      // The list does not exist yet; create it so `@Groceries` really files there.
      const created = await actions.createList(plan.createListName);
      if (!created) return false;
      payload = { ...payload, listId: created.id };
    }

    const task = await actions.create(payload);
    if (!task) return false;

    setValue('');
    toast({
      title: 'Task added',
      description: `${task.title} · ${dueLabel(task, zone, timeFormat)?.label ?? 'No date'}`,
      variant: 'success',
    });
    onCreated?.(task);
    return true;
  }, [actions, context, onCreated, result, timeFormat, toast, value, zone]);

  return {
    value,
    setValue,
    result,
    chips,
    submit,
    online: actions.online,
    offlineNotice: actions.offlineNotice,
    busy: actions.isSaving,
  };
}

function QuickAddInput({
  state,
  open,
  onClose,
}: {
  state: QuickAddState;
  open: boolean;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  /*
   * The caret goes into the field when the dialog is deliberately opened — and
   * at no other time. `open` is the only trigger: focusing unconditionally would
   * grab the page's focus on load.
   *
   * A *layout* effect, not a passive one, and that distinction is the whole
   * point: iOS raises the keyboard only when `focus()` runs in the task that
   * handled the tap, and a passive effect is flushed after the browser has had
   * its chance to paint — a frame later, in another task, where the gesture is
   * spent and the keyboard never appears. A layout effect runs in the same commit
   * that `open` arrived in, which the caller flushes synchronously with the tap
   * (see `TasksView.openQuickAdd`), so the focus still belongs to the gesture.
   */
  useLayoutEffect(() => {
    if (!open) return;
    inputRef.current?.focus({ preventScroll: true });
  }, [open]);

  /*
   * A created task closes the dialog: the row is in the list behind it and the
   * user asked for the popup to go away, so making them dismiss it too would be
   * a second gesture for one action. A failed submit keeps it open and puts the
   * caret back where the typing was, so the sentence is not lost.
   */
  async function submit() {
    const created = await state.submit();
    if (created) onClose();
    else inputRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <Stack spacing={1.5}>
      <TextField
        inputRef={inputRef}
        autoFocus
        value={state.value}
        disabled={!state.online}
        placeholder="Add a task…"
        onChange={(event) => state.setValue(event.target.value)}
        onKeyDown={onKeyDown}
        slotProps={{
          htmlInput: { 'aria-label': 'Quick add a task' },
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <AutoAwesomeIcon sx={{ fontSize: 16, color: 'text.secondary' }} aria-hidden />
              </InputAdornment>
            ),
            endAdornment: (
              <InputAdornment position="end">
                <Button
                  size="small"
                  variant="contained"
                  disableElevation
                  startIcon={
                    state.busy ? (
                      <CircularProgress size={14} color="inherit" aria-label="Saving" />
                    ) : (
                      <KeyboardReturnIcon sx={{ fontSize: 16 }} aria-hidden />
                    )
                  }
                  disabled={!state.online || !state.value.trim() || state.busy}
                  onClick={() => void submit()}
                >
                  Add
                </Button>
              </InputAdornment>
            ),
          },
        }}
      />

      {state.online ? (
        <Stack direction="row" spacing={0.75} sx={{ minHeight: 28, flexWrap: 'wrap', alignItems: 'center' }}>
          {state.chips.length ? (
            state.chips.map((chip, index) => (
              <Chip
                key={`${chip.kind}-${index}`}
                size="small"
                label={chip.label}
                color={chip.kind === 'priority' ? 'warning' : 'default'}
                variant={chip.kind === 'priority' ? 'filled' : 'outlined'}
              />
            ))
          ) : (
            <Typography variant="caption" color="text.disabled">
              Try “Pay rent tomorrow 5pm !high #home”, “@Work call Sam”, or “every monday gym”.
            </Typography>
          )}
        </Stack>
      ) : (
        <Typography variant="caption" color="text.secondary">
          {state.offlineNotice}
        </Typography>
      )}
    </Stack>
  );
}

/** The quick-add dialog: the one way to type a task in a sentence. */
export function QuickAddBar({ open, onOpenChange, listId = null, onCreated }: QuickAddBarProps) {
  const state = useQuickAdd(listId, onCreated);

  return (
    <Dialog
      open={open}
      onClose={() => onOpenChange(false)}
      maxWidth="sm"
      fullWidth
      /*
       * No fade. The panel must be in the DOM — and the input focusable — in the
       * commit that the tap produced, or iOS never raises the keyboard.
       */
      transitionDuration={0}
      aria-labelledby="quick-add-title"
      slotProps={{
        paper: {
          sx: {
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            top: 'auto',
            m: 0,
            width: '100%',
            maxWidth: '100%',
            borderRadius: '16px 16px 0 0',
            p: 2,
            pb: 'max(2rem, env(safe-area-inset-bottom, 0px))',
          },
        },
      }}
    >
      <Stack spacing={0.5} sx={{ mb: 1.5 }}>
        <Typography id="quick-add-title" variant="h6" component="h2">
          New task
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Type it the way you would say it — the date, priority and tags are read out of the sentence.
        </Typography>
      </Stack>
      <QuickAddInput state={state} open={open} onClose={() => onOpenChange(false)} />
    </Dialog>
  );
}
