'use client';

/**
 * Natural-language quick add.
 *
 * Two presentations of one behaviour: a bottom sheet opened from the navbar, and
 * a bar pinned directly above the floating bottom band. Both parse on every
 * keystroke (`parseQuickAdd`), show exactly what was understood as tinted chips,
 * and stay open after a submit so several tasks can be typed in a row.
 *
 * The inline bar used to be the last row of the scrolling list, which meant
 * scrolling to the foot of a long list before a task could be added. It is chrome
 * now: always on screen, above the tab bar band, at the price of a spacer in the
 * list that hands its height back to the scroll content.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { CornerDownLeft, Sparkles } from 'lucide-react';
import { Button, Chip, Sheet, TextField, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { parseQuickAdd, type QuickAddResult } from '@/lib/nlp';
import { useResource } from '@/lib/store';
import type { Task } from '@/lib/types';
import type { BootstrapPayload } from '@/lib/view-types';
import { dueLabel } from './TaskMeta';
import { planQuickAdd, quickAddChips, type QuickAddChip, type QuickAddContext } from './quick-add';
import { useTaskActions } from './useTaskActions';
import { ViewportDock } from './ViewportDock';

/**
 * Height of the pinned bar with a single row of content — a 44px field with 8px
 * of padding above and below. Used until the bar has measured itself.
 */
const PINNED_BAR_ROW_HEIGHT = 60;

/** Breathing room between the pinned bar and the foot of the list. */
const PINNED_BAR_GAP = 16;

export interface QuickAddBarProps {
  /** `sheet` is the navbar presentation; `inline` is the pinned bar. */
  variant?: 'sheet' | 'inline';
  /** Sheet variant only: whether it is open. */
  open?: boolean;
  /** Sheet variant only: dismissal (backdrop tap, Escape, swipe down). */
  onOpenChange?: (open: boolean) => void;
  /**
   * Inline variant only: whether the bar is on screen. It is hidden while a
   * multi-select is running — the bulk-action bar occupies the same band and
   * wins it — while its clearance spacer stays behind, so the list does not jump
   * when selection starts or ends.
   */
  visible?: boolean;
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

function QuickAddInput({
  state,
  autoFocus = false,
  compact = false,
}: {
  state: QuickAddState;
  autoFocus?: boolean;
  /** One row tall until there is something to say — see `showMeta` below. */
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  /*
   * This is chrome that is always on screen now, so it stays one row tall until
   * it has something to say: the chips the parser understood, the offline
   * notice, or the examples once the field has focus. The sheet variant has the
   * room to show the examples all the time and passes `compact={false}`.
   */
  const showMeta = !compact || focused || !state.online || state.chips.length > 0;

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
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />

      {showMeta ? (
        state.online ? (
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
        )
      ) : null}
    </div>
  );
}

export function QuickAddBar({
  variant = 'sheet',
  open = false,
  onOpenChange,
  listId = null,
  onCreated,
  visible = true,
  className,
}: QuickAddBarProps) {
  const state = useQuickAdd(listId, onCreated);
  const [barHeight, setBarHeight] = useState(PINNED_BAR_ROW_HEIGHT);
  const barRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  // The pinned bar is portalled, so it can only exist once there is a document.
  useEffect(() => setMounted(true), []);

  /*
   * A fixed bar cannot reserve its own room in the scroll content the way an
   * in-flow row did, so it measures itself and the spacer below hands that height
   * back to the list. Measured rather than guessed: a row of chips or the offline
   * notice makes the bar taller, and a guess would either cut the last task off or
   * leave a permanent hole under it.
   */
  useEffect(() => {
    if (variant !== 'inline' || !visible || !mounted) return;
    const node = barRef.current;
    if (!node) return;

    const report = () => {
      const measured = Math.round(node.getBoundingClientRect().height);
      if (measured > 0) setBarHeight(measured);
    };
    report();

    const observer = new ResizeObserver(report);
    observer.observe(node);
    return () => observer.disconnect();
  }, [variant, visible, mounted]);

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
    <>
      {/*
       * The clearance, in the scroll content itself rather than on the view root:
       * at full scroll the content's foot lands exactly where the band's reserved
       * height begins, so a spacer the height of the bar lifts the last row clear
       * of it. Desktop has no band and no pinned bar, so it needs neither.
       */}
      <div aria-hidden className="lg:hidden" style={{ height: barHeight + PINNED_BAR_GAP }} />

      {mounted ? (
        <ViewportDock
          className={cn(
            /*
             * Pinned, full width, directly above the floating band: the band is
             * `--tab-h` tall on top of the `env(safe-area-inset-bottom)` offset,
             * so the bar's bottom edge sits exactly where that clearance ends.
             *
             * Dock, not `fixed` in place — see `ViewportDock`: inside the route
             * wrapper a `fixed` bar is pinned to the content, not the screen.
             */
            'glass-chrome fixed inset-x-0 z-30 lg:hidden',
            !visible && 'hidden',
            className,
          )}
          /*
           * Spaces around the `+` are REQUIRED by the CSS spec. Without them the
           * whole `calc()` is invalid, the declaration is dropped, and `bottom`
           * falls back to `auto` — which parks the bar at its static position,
           * i.e. below the fold, so it never appears at all. Tailwind normalises
           * the arbitrary values in className; a raw inline string does not get
           * that treatment.
           */
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 3.75rem)' }}
        >
          <div ref={barRef} className="px-4 py-2">
            <QuickAddInput state={state} compact />
          </div>
        </ViewportDock>
      ) : null}

      {/*
       * A desktop has no floating band — the shell hides it at `lg` — so there is
       * nothing left to pin above: the same bar (and the same field state) sits in
       * the flow at the foot of the list, where it has always been.
       */}
      <div
        className={cn(
          'glass-chrome hidden lg:mx-4 lg:mt-4 lg:mb-6 lg:block lg:rounded-ios-md',
          className,
        )}
      >
        <div className="px-4 py-2">
          <QuickAddInput state={state} compact />
        </div>
      </div>
    </>
  );
}
