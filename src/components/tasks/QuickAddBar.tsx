'use client';

/**
 * Natural-language quick add.
 *
 * Two presentations of one behaviour: a bottom sheet opened from the navbar, and
 * a persistent "Add a task" row that lives under a list. Both parse on every
 * keystroke (`parseQuickAdd`), show exactly what was understood as tinted chips,
 * and stay open after a submit so several tasks can be typed in a row.
 */
import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { CornerDownLeft, Plus, Sparkles } from 'lucide-react';
import { Button, Chip, Sheet, TextField, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { parseQuickAdd, type QuickAddResult } from '@/lib/nlp';
import { useResource } from '@/lib/store';
import type { Task } from '@/lib/types';
import type { BootstrapPayload } from '@/lib/view-types';
import { dueLabel } from './TaskMeta';
import { planQuickAdd, quickAddChips, type QuickAddChip, type QuickAddContext } from './quick-add';
import { useTaskActions } from './useTaskActions';

export interface QuickAddBarProps {
  /** `sheet` is the navbar presentation; `inline` is the row under a list. */
  variant?: 'sheet' | 'inline';
  /** Sheet variant only: whether it is open. */
  open?: boolean;
  /** Sheet variant only: dismissal (backdrop tap, Escape, swipe down). */
  onOpenChange?: (open: boolean) => void;
  /** The list the task lands in — the list being viewed, or the list's own row. */
  listId?: string | null;
  onCreated?: (task: Task) => void;
  className?: string;
}

interface QuickAddState {
  value: string;
  setValue: (value: string) => void;
  result: QuickAddResult;
  chips: QuickAddChip[];
  submit: () => Promise<void>;
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
    if (!raw) return;

    const plan = planQuickAdd(result, context);
    if (!plan) {
      toast({ title: 'Give the task a name', description: 'Type a title before adding it.', variant: 'error' });
      return;
    }

    let payload = plan.payload;
    if (plan.createListName) {
      // The list does not exist yet; create it so `@Groceries` really files there.
      const created = await actions.createList(plan.createListName);
      if (!created) return;
      payload = { ...payload, listId: created.id };
    }

    const task = await actions.create(payload);
    if (!task) return;

    setValue('');
    toast({
      title: 'Task added',
      description: `${task.title} · ${dueLabel(task, zone, timeFormat)?.label ?? 'No date'}`,
      variant: 'success',
    });
    onCreated?.(task);
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

function QuickAddInput({ state, autoFocus = false }: { state: QuickAddState; autoFocus?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void state.submit().then(() => inputRef.current?.focus());
    }
  }

  return (
    <div>
      <TextField
        ref={inputRef}
        autoFocus={autoFocus}
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
            onClick={() => void state.submit().then(() => inputRef.current?.focus())}
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

export function QuickAddBar({
  variant = 'sheet',
  open = false,
  onOpenChange,
  listId = null,
  onCreated,
  className,
}: QuickAddBarProps) {
  const state = useQuickAdd(listId, onCreated);
  const [inlineOpen, setInlineOpen] = useState(false);

  if (variant === 'sheet') {
    return (
      <Sheet
        open={open}
        onOpenChange={onOpenChange ?? (() => undefined)}
        title="New task"
        description="Type it the way you would say it — the date, priority and tags are read out of the sentence."
      >
        <div className="pb-4">
          <QuickAddInput state={state} />
        </div>
      </Sheet>
    );
  }

  return (
    <div className={cn('mx-4 rounded-ios-md bg-elevated', className)}>
      {inlineOpen ? (
        <div className="px-3 py-2">
          <QuickAddInput state={state} autoFocus />
          <button
            type="button"
            onClick={() => {
              setInlineOpen(false);
              state.setValue('');
            }}
            className="mt-1 min-h-8 text-footnote text-tint pressable"
          >
            Close
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setInlineOpen(true)}
          className="flex min-h-11 w-full items-center gap-3 px-4 text-left text-body text-tertiary pressable-row"
        >
          <Plus className="size-5 shrink-0" aria-hidden />
          Add a task
        </button>
      )}
    </div>
  );
}
