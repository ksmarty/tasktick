'use client';

/**
 * Natural-language quick add.
 *
 * One presentation: a bottom sheet opened from the shell's action button, on
 * every screen alike. It parses on every keystroke (`parseQuickAdd`) and shows
 * exactly what was understood as tinted chips. The caret lands in the field the
 * moment the sheet opens, and a successful submit closes it — one task is one
 * gesture. A submit that *fails* leaves the sheet open with the sentence still
 * in the field, so nothing typed is lost to an error.
 *
 * It used to have a second presentation — a bar pinned above the floating bottom
 * band, on this screen and on Today — and that bar is gone. It competed with the
 * action button for the same gesture, it covered roughly 150px of a 390×844 list
 * to offer something the button already offered, and it needed a spacer, a
 * `ResizeObserver` and a viewport portal to stop covering the last row. The
 * sheet needs none of that.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { CornerDownLeft, Sparkles } from 'lucide-react';
import { Button, Chip, Sheet, TextField, useToast } from '@/components/ui';
import { parseQuickAdd, type QuickAddResult } from '@/lib/nlp';
import { useResource } from '@/lib/store';
import type { Task } from '@/lib/types';
import type { BootstrapPayload } from '@/lib/view-types';
import { dueLabel } from './TaskMeta';
import { planQuickAdd, quickAddChips, type QuickAddChip, type QuickAddContext } from './quick-add';
import { useTaskActions } from './useTaskActions';

export interface QuickAddBarProps {
  /** Whether the sheet is open. */
  open: boolean;
  /** Dismissal (backdrop tap, Escape, swipe down). */
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
   * The caret goes into the field when the sheet is deliberately opened — and at
   * no other time. `open` is the only trigger: `autoFocus` would also fire on
   * whatever render happens to remount the field, and focusing unconditionally
   * would grab the page's focus on load. The sheet renders its children only
   * while it is open, so mounting this field *is* an open, which is why the
   * effect also covers the first one (the sheet mounts its children a render
   * after `open` flips, when `panelRef` is still null for its own focus trap).
   */
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus({ preventScroll: true });
  }, [open]);

  /*
   * A created task closes the sheet: the row is in the list behind it and the
   * user asked for the popup to go away, so making them dismiss it too would be
   * a second gesture for one action. A failed submit keeps the sheet open and
   * puts the caret back where the typing was, so the sentence is not lost.
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
    <div>
      <TextField
        ref={inputRef}
        value={state.value}
        disabled={!state.online}
        placeholder="Add a task…"
        aria-label="Quick add a task"
        leading={<Sparkles className="size-4" />}
        trailing={
          <Button
            size="sm"
            variant="tinted"
            icon={CornerDownLeft}
            disabled={!state.online || !state.value.trim()}
            loading={state.busy}
            onClick={() => void submit()}
          >
            Add
          </Button>
        }
        onChange={(event) => state.setValue(event.target.value)}
        onKeyDown={onKeyDown}
      />

      {state.online ? (
        <div className="mt-2 flex min-h-7 flex-wrap items-center gap-1.5">
          {state.chips.length ? (
            state.chips.map((chip, index) => (
              <Chip
                key={`${chip.kind}-${index}`}
                size="sm"
                color={chip.kind === 'priority' ? 'orange' : undefined}
              >
                {chip.label}
              </Chip>
            ))
          ) : (
            <span className="text-footnote text-tertiary">
              Try “Pay rent tomorrow 5pm !high #home”, “@Work call Sam”, or “every monday gym”.
            </span>
          )}
        </div>
      ) : (
        <p className="mt-2 text-footnote text-secondary">{state.offlineNotice}</p>
      )}
    </div>
  );
}

/** The quick-add sheet: the one way to type a task in a sentence. */
export function QuickAddBar({ open, onOpenChange, listId = null, onCreated }: QuickAddBarProps) {
  const state = useQuickAdd(listId, onCreated);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="New task"
      description="Type it the way you would say it — the date, priority and tags are read out of the sentence."
    >
      <div className="pb-4">
        <QuickAddInput state={state} open={open} onClose={() => onOpenChange(false)} />
      </div>
    </Sheet>
  );
}
