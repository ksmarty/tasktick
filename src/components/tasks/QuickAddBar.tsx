'use client';

/**
 * Natural-language quick add.
 *
 * One presentation: a bottom sheet opened from the shell's action button, on
 * every screen alike. It parses on every keystroke (`parseQuickAdd`) and shows
 * exactly what was understood as tinted chips. The caret lands in the field the
 * moment the dialog opens, and a successful submit closes it — one task is one
 * gesture. A submit that *fails* leaves the dialog open with the sentence still in
 * the field, so nothing typed is lost to an error.
 *
 * ## Focus timing (do not "simplify" this)
 *
 * iOS raises the keyboard only when `focus()` runs in the task that handled the
 * tap. Two things keep that guarantee now that the sheet is a shadcn `Dialog`
 * (Radix) rather than a MUI one:
 *
 *   - the panel does **not** animate (`duration-0`, and the `animate-in`/`animate-out`
 *     classes are switched off). Radix mounts the panel through a portal, so the
 *     panel's presence in the DOM is what has to be immediate, and a 200ms
 *     entrance animation is exactly the delay that was fixed; and
 *   - the focus runs in a *layout* effect, not a passive one, so it belongs to the
 *     same commit that `open` arrived in. `TasksView.openQuickAdd` flushes that
 *     commit synchronously inside the tap (see `usePrimaryAction`), and Radix's
 *     `Presence` renders its children in that same commit, so the input node
 *     exists by the time the layout effect runs.
 *
 * `autoFocus` is left on the field as a second, React-native path (ReactDOM
 * focuses an `autoFocus` node during the commit phase), and `onOpenAutoFocus`
 * cancels Radix's own deferred autofocus so nothing re-focuses a frame later. The
 * raw probe result for this is in the migration report.
 */
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { MagicWandIcon } from '@svg-animated-icons/react/magic-wand';
import { parseQuickAdd, type QuickAddResult } from '@/lib/nlp';
import { useResource } from '@/lib/store';
import type { Task } from '@/lib/types';
import type { BootstrapPayload } from '@/lib/view-types';
import { useToast } from '@/components/app/Toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
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
  inputRef,
}: {
  state: QuickAddState;
  open: boolean;
  onClose: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
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
    <div className="flex flex-col gap-stack">
      <div className="relative">
        <MagicWandIcon
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-base text-muted-foreground"
          aria-hidden
        />
        <Input
          ref={inputRef}
          autoFocus
          type="text"
          value={state.value}
          disabled={!state.online}
          placeholder="Add a task…"
          aria-label="Quick add a task"
          onChange={(event) => state.setValue(event.target.value)}
          onKeyDown={onKeyDown}
          className="pr-16 pl-9"
        />
        <Button
          type="button"
          size="sm"
          className="absolute top-1/2 right-1.5 h-6 -translate-y-1/2 px-2 text-xs"
          disabled={!state.online || !state.value.trim() || state.busy}
          aria-busy={state.busy || undefined}
          onClick={() => void submit()}
        >
          {state.busy ? (
            // `status` + a name, so the wait is announced rather than silent —
            // the same announcement MUI's spinner carried.
            <span
              role="status"
              aria-label="Saving"
              className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
            />
          ) : (
            'Add'
          )}
        </Button>
      </div>

      {state.online ? (
        <div className="flex min-h-7 flex-wrap items-center gap-1.5">
          {state.chips.length ? (
            state.chips.map((chip, index) => (
              <Badge
                key={`${chip.kind}-${index}`}
                variant={chip.kind === 'priority' ? 'default' : 'outline'}
                className={cn(
                  'h-7 px-2 text-xs',
                  chip.kind === 'priority' && 'bg-chart-4 text-white',
                )}
              >
                {chip.label}
              </Badge>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">
              Try “Pay rent tomorrow 5pm !high #home”, “@Work call Sam”, or “every monday gym”.
            </span>
          )}
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">{state.offlineNotice}</span>
      )}
    </div>
  );
}

/** The quick-add dialog: the one way to type a task in a sentence. */
export function QuickAddBar({ open, onOpenChange, listId = null, onCreated }: QuickAddBarProps) {
  const state = useQuickAdd(listId, onCreated);
  /*
   * One ref for the field, owned here rather than inside the panel, because two
   * mechanisms have to agree on it: the panel's layout effect (the same-task
   * focus) and Radix's cancelled autofocus below.
   */
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        /*
         * A bottom sheet, and nothing else. `p-0`/`gap-0` neutralise the
         * dialog's own `p-6`/`gap-4` (a token class cannot override them — see
         * the note on `tailwind-merge` in `TaskListSection`), and the padding
         * that remains is the sheet's own, on the wrapper below.
         */
        className={cn(
          'bottom-0 top-auto left-0 max-w-full translate-x-0 translate-y-0',
          'gap-0 rounded-t-2xl rounded-b-none border-x-0 border-b-0 p-0',
          // No entrance animation. The panel must be in the DOM — and the input
          // focusable — in the commit that the tap produced, or iOS never raises
          // the keyboard.
          'duration-0 data-[state=open]:animate-none data-[state=closed]:animate-none',
        )}
        showCloseButton={false}
        /*
         * Radix's own autofocus runs in a passive effect, a frame after the tap,
         * where the gesture is already spent. Cancel it and let the layout effect
         * above own the focus, in the tap's own task.
         */
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus({ preventScroll: true });
        }}
      >
        <div className="flex flex-col gap-stack px-card pt-card pb-[max(0.25rem,env(safe-area-inset-bottom,0px))]">
          <div className="flex flex-col gap-1">
            {/*
             * No explicit `id` on the title: Radix renders
             * `<h2 id={context.titleId} {...titleProps}>` — the caller's props
             * come last, so passing an `id` would override the generated one and
             * leave the content's `aria-labelledby` pointing at nothing. The
             * dialog is named from this text either way; the id is not a
             * contract.
             */}
            <DialogTitle className="text-base font-semibold">New task</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Type it the way you would say it — the date, priority and tags are read out of the sentence.
            </DialogDescription>
          </div>
          <QuickAddInput
            state={state}
            open={open}
            onClose={() => onOpenChange(false)}
            inputRef={inputRef}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
