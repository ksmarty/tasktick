'use client';

/**
 * The account's contraception methods: what is used, when, and what it means.
 *
 * ## Why this is a settings card and not a screen
 *
 * A method is recorded once and then read by everything else: the prediction
 * decides whether a fertility estimate is even a statement about fertility by
 * looking at the methods active on the day, so this list is the input to that
 * decision. It is edited rarely and read rarely, which is settings.
 *
 * ## What each row says, and why all of it
 *
 * A method is not one fact but four, and dropping any of them makes the record
 * misreadable:
 *
 *  - the **name** (`METHOD_LABEL`, so a user never sees `hormonal_iud`), plus the
 *    user's own label when they gave one ("Nuvaring");
 *  - the **date range**, because a range with `endDate: null` means "still using"
 *    and that is the difference between history and something current;
 *  - the **rhythm** — `21 days on, 7 days off` — which is the only thing that
 *    makes the on/off product make sense. It is printed from the stored
 *    `schedule`; a method with no plan says so rather than showing nothing;
 *  - whether it is **hormonal**, in words. Not a colour, not an icon: this is the
 *    one property that changes what every other number on the Insights screen
 *    means, and it has to survive being read aloud.
 *
 * ## The hormonal statement is the point of the card
 *
 * A hormonal method suppresses ovulation, so a calendar estimate of a fertile
 * window is not a weaker statement about fertility — it is not a statement about
 * fertility at all while the method is in use. The card says exactly that, in the
 * active case, and it says it about the *method by name* so it cannot be read as
 * boilerplate. It never says "safe": the calendar estimate is also not a
 * contraceptive guarantee, which is what the group's footnote adds for the
 * non-hormonal case.
 *
 * ## Switching methods is an end date, not an edit
 *
 * `period-types.ts` is explicit that a change of method is two records, the
 * earlier one closed by setting `endDate` — the history is never rewritten. So
 * the form offers the end date (empty means still using) and, when the method
 * itself is changed on a record that is still open, says in words that a real
 * switch is "end this one, then add the next one". The list is then the visible
 * history the contract describes, and no write here ever invents a second one.
 *
 * ## Shape
 *
 * One `SettingsGroup` of rows (the settings area's own rhythm), one godui
 * `Drawer` holding the form, one shadcn `Dialog` for the delete confirmation —
 * the same three pieces `IcalSubscriptionCard` and `CalDavAccountSheet` use, in
 * the same arrangement. Every write goes through the hooks in `./data` (they
 * invalidate the period prefix) and every failure is surfaced with the toast.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ExclamationCircledIcon } from '@svg-animated-icons/react/exclamation-circled';
import { Pencil1Icon } from '@svg-animated-icons/react/pencil-1';
import { PlusIcon } from '@svg-animated-icons/react/plus';
import { TrashIcon } from '@svg-animated-icons/react/trash';
import { useToast } from '@/components/app/Toast';
import { Drawer } from '@/components/godui/drawer';
import { SettingsGroup, SettingsRow } from '@/components/settings/SettingsGroup';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { hasDayPlan, isDailyMethod, isHormonalMethod, scheduleCycleLength } from '@/lib/period-math';
import {
  CONTRACEPTION_METHODS,
  type ContraceptionMethod,
  type ContraceptionMethodInput,
  type ContraceptionMethodRecord,
  type ContraceptionSchedule,
} from '@/lib/period-types';
import { cn } from '@/lib/utils';
import { useContraceptionMethods, useCreateMethod, useDeleteMethod, useUpdateMethod } from './data';
import { METHOD_LABEL, longDate } from './labels';

/* -------------------------------------------------------------------------- */
/* wording                                                                    */
/* -------------------------------------------------------------------------- */

/** `The pill (Nuvaring)` — the method's name with the user's own label. */
function methodName(record: ContraceptionMethodRecord): string {
  const name = METHOD_LABEL[record.method];
  return record.label ? `${name} (${record.label})` : name;
}

/** `14 Oct 2025 – still using`, or the real end date. */
function rangeText(record: ContraceptionMethodRecord): string {
  return `${longDate(record.startDate)} – ${record.endDate === null ? 'still using' : longDate(record.endDate)}`;
}

function dayCount(count: number): string {
  return `${count} ${count === 1 ? 'day' : 'days'}`;
}

/**
 * The rhythm of a method in words.
 *
 * Three cases, and `hasDayPlan` is what says whether there is a fourth: a stored
 * `schedule` (a pack, a ring, a patch) prints its on/off rhythm, a daily product
 * with no break recorded (that is `isDailyMethod` — a pill) says so, and
 * everything else has no day-by-day plan to draw. The cycle length comes from
 * `scheduleCycleLength`, not from adding the two numbers here.
 */
function rhythmLabel(record: ContraceptionMethodRecord): string {
  if (record.schedule) {
    const { onDays, offDays } = record.schedule;
    if (offDays === 0) return `${dayCount(onDays)} on, no days off`;
    return `${dayCount(onDays)} on, ${dayCount(offDays)} off — a ${scheduleCycleLength(record.schedule)}-day cycle`;
  }
  if (hasDayPlan(record)) return 'Every day, with no break recorded';
  return 'No day-by-day plan';
}

/**
 * `The pill` / `The pill and Patch` — a list a sentence can be built on.
 *
 * The caller decides the verb, because "suppresses" and "suppress" are the two
 * forms this is used for and a helper that returned a whole sentence would have
 * to be called from the JSX it is meant to keep short.
 */
function nameList(records: ContraceptionMethodRecord[]): string {
  const names = records.map(methodName);
  const last = names[names.length - 1];
  if (names.length <= 1 || last === undefined) return last ?? '';
  return `${names.slice(0, -1).join(', ')} and ${last}`;
}

/**
 * Whether the on/off fields belong on the form.
 *
 * `hasDayPlan` answers a question about a *stored record* ("is there a plan to
 * draw"), which is `schedule !== null || isDailyMethod(method)`. A form with a
 * method picked but nothing saved yet has to ask the question one step earlier:
 * which methods *can* carry a plan. That is a daily pill (`isDailyMethod`) and
 * the two other cyclic products the schedule shape exists for, a ring and a
 * patch. A record that already carries a schedule keeps its fields whatever its
 * method, so an imported or older plan cannot be dropped by opening the form and
 * saving it again.
 */
function showsScheduleFields(method: ContraceptionMethod, record: ContraceptionMethodRecord | null): boolean {
  return isDailyMethod(method) || method === 'ring' || method === 'patch' || (record !== null && hasDayPlan(record));
}

/* -------------------------------------------------------------------------- */
/* form validation                                                            */
/* -------------------------------------------------------------------------- */

type ErrorKey = 'startDate' | 'endDate' | 'schedule';
type FormErrors = Partial<Record<ErrorKey, string>>;

const WHOLE_DAYS = /^\d+$/;

/**
 * The schedule the two number fields describe, or the reason they cannot.
 *
 * Blank in both is "no plan" rather than an error — a condom has no on/off
 * rhythm and the fields are optional for exactly that case. Blank in one is the
 * error, because a half-entered pack is a typo and silently dropping it would
 * throw away what the user meant to record.
 */
function readSchedule(onDays: string, offDays: string, shown: boolean): { schedule: ContraceptionSchedule | null; error: string | null } {
  if (!shown) return { schedule: null, error: null };
  const on = onDays.trim();
  const off = offDays.trim();
  if (!on && !off) return { schedule: null, error: null };
  if (!on || !off) return { schedule: null, error: 'Enter both numbers, or leave both blank.' };
  if (!WHOLE_DAYS.test(on) || !WHOLE_DAYS.test(off)) {
    return { schedule: null, error: 'Use whole numbers of days.' };
  }
  const parsedOn = Number(on);
  const parsedOff = Number(off);
  if (parsedOn < 1 || parsedOn > 365) return { schedule: null, error: 'On days must be between 1 and 365.' };
  if (parsedOff > 365) return { schedule: null, error: 'Off days must be between 0 and 365.' };
  return { schedule: { onDays: parsedOn, offDays: parsedOff }, error: null };
}

/* -------------------------------------------------------------------------- */
/* the form                                                                   */
/* -------------------------------------------------------------------------- */

interface MethodFormDrawerProps {
  open: boolean;
  /** The record being edited, or `null` to add one. */
  record: ContraceptionMethodRecord | null;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful write, so the card can refetch its list. */
  onSaved: () => void;
}

/** A labelled control with a hint, or the error that replaced it. */
function Field({
  id,
  label,
  hint,
  invalid = false,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  invalid?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className={cn('text-xs', invalid ? 'text-destructive' : 'text-muted-foreground')}>{hint}</p> : null}
    </div>
  );
}

function MethodFormDrawer({ open, record, onOpenChange, onSaved }: MethodFormDrawerProps) {
  const { toast } = useToast();
  const editing = record !== null;

  const [method, setMethod] = useState<ContraceptionMethod>('pill');
  const [label, setLabel] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [onDays, setOnDays] = useState('');
  const [offDays, setOffDays] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});

  /*
   * Hydrate once per opening, keyed by the record, rather than on every render:
   * `record` is a live server object, so an effect without this guard would
   * overwrite what the user is typing the moment the list refetches.
   */
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      hydratedFor.current = null;
      return;
    }
    const key = record?.id ?? 'new';
    if (hydratedFor.current === key) return;
    hydratedFor.current = key;

    setMethod(record?.method ?? 'pill');
    setLabel(record?.label ?? '');
    setStartDate(record?.startDate ?? '');
    setEndDate(record?.endDate ?? '');
    setOnDays(record?.schedule ? String(record.schedule.onDays) : '');
    setOffDays(record?.schedule ? String(record.schedule.offDays) : '');
    setErrors({});
  }, [open, record]);

  const create = useCreateMethod({
    onError: (message) => toast({ title: 'Could not add the method', description: message, variant: 'error' }),
    onSuccess: () => {
      toast({ title: 'Method added', variant: 'success' });
      onSaved();
      onOpenChange(false);
    },
  });

  const update = useUpdateMethod({
    onError: (message) => toast({ title: 'Could not save the method', description: message, variant: 'error' }),
    onSuccess: () => {
      toast({ title: 'Method updated', variant: 'success' });
      onSaved();
      onOpenChange(false);
    },
  });

  const pending = create.isPending || update.isPending;
  const scheduleShown = showsScheduleFields(method, record);
  // The record being switched away from, when the method itself was changed on
  // something still in use — the case the hint under the select is for.
  const switchingFrom =
    record !== null && record.endDate === null && method !== record.method ? record : null;

  function clearError(key: ErrorKey) {
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function submit() {
    const next: FormErrors = {};
    if (!startDate) next.startDate = 'Pick the day you started using it.';
    if (endDate && startDate && endDate < startDate) {
      next.endDate = 'The end date cannot be before the start date.';
    }
    const parsed = readSchedule(onDays, offDays, scheduleShown);
    if (parsed.error) next.schedule = parsed.error;
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    /*
     * `schedule: null` is sent, not omitted, and an empty end date is sent as
     * null: on a PATCH, leaving a key out means "keep what is there", and both
     * of these fields have a real empty state (no plan, still using) that the
     * user must be able to get back to. `notes` is not touched at all, so a note
     * written elsewhere survives an edit here.
     */
    const body: ContraceptionMethodInput = {
      method,
      label: label.trim() || null,
      startDate,
      endDate: endDate || null,
      schedule: parsed.schedule,
    };

    if (record) void update.run(record.id, body);
    else void create.run(body);
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      side="bottom"
      title={record ? `Edit ${METHOD_LABEL[record.method]}` : 'Add a method'}
      className="p-0 px-card"
    >
      <div className="flex flex-col gap-stack pb-[max(0.25rem,env(safe-area-inset-bottom,0px))]">
        <p className="text-sm text-muted-foreground">
          {editing
            ? 'Correct what was recorded. The history is never rewritten in place — a change of method is an end date here plus a new entry.'
            : 'Record the day you started using it. A cyclic method\u2019s on/off plan is counted from that day.'}
        </p>

        <Field
          id="contraception-method"
          label="Method"
          hint={
            switchingFrom ? (
              <>
                {`To show a switch to ${METHOD_LABEL[method]}, set the end date below to the last day you used `}
                {METHOD_LABEL[switchingFrom.method]}
                {' and save — then add the new method as its own entry, so the history shows both.'}
              </>
            ) : undefined
          }
        >
          <Select value={method} onValueChange={(value) => setMethod(value as ContraceptionMethod)}>
            <SelectTrigger id="contraception-method" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {CONTRACEPTION_METHODS.map((option) => (
                <SelectItem key={option} value={option}>
                  {METHOD_LABEL[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field id="contraception-label" label="Your own name for it" hint="Optional, e.g. “Nuvaring” or “the mini pill”.">
          <Input
            id="contraception-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Nuvaring"
            autoComplete="off"
            maxLength={120}
          />
        </Field>

        <Field
          id="contraception-start"
          label="Started"
          invalid={Boolean(errors.startDate)}
          hint={errors.startDate ?? 'The first day you used it.'}
        >
          <Input
            id="contraception-start"
            type="date"
            value={startDate}
            aria-invalid={errors.startDate ? true : undefined}
            onChange={(event) => {
              setStartDate(event.target.value);
              clearError('startDate');
            }}
          />
        </Field>

        <Field
          id="contraception-end"
          label="Ended"
          invalid={Boolean(errors.endDate)}
          hint={errors.endDate ?? 'Leave blank while you are still using it.'}
        >
          <Input
            id="contraception-end"
            type="date"
            value={endDate}
            aria-invalid={errors.endDate ? true : undefined}
            onChange={(event) => {
              setEndDate(event.target.value);
              clearError('endDate');
            }}
          />
        </Field>

        {scheduleShown ? (
          <div className="flex flex-col gap-2">
            <div className="flex gap-3">
              <Field className="flex-1" id="contraception-on-days" label="On days">
                <Input
                  id="contraception-on-days"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={365}
                  step={1}
                  value={onDays}
                  aria-invalid={errors.schedule ? true : undefined}
                  onChange={(event) => {
                    setOnDays(event.target.value);
                    clearError('schedule');
                  }}
                />
              </Field>
              <Field className="flex-1" id="contraception-off-days" label="Off days">
                <Input
                  id="contraception-off-days"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={365}
                  step={1}
                  value={offDays}
                  aria-invalid={errors.schedule ? true : undefined}
                  onChange={(event) => {
                    setOffDays(event.target.value);
                    clearError('schedule');
                  }}
                />
              </Field>
            </div>

            {errors.schedule ? (
              <p role="alert" className="text-xs text-destructive">
                {errors.schedule}
              </p>
            ) : null}

            <p className="text-xs text-muted-foreground">
              For a cyclic pack, ring or patch: the days of active product, then the days off (or placebo) before the
              next one starts. Leave both blank for anything without an on/off rhythm.
            </p>
          </div>
        ) : null}

        <div className="flex gap-2">
          <Button type="button" variant="ghost" className="flex-1" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" className="flex-1" aria-busy={pending || undefined} disabled={pending} onClick={submit}>
            {editing ? 'Save method' : 'Add method'}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}

/* -------------------------------------------------------------------------- */
/* the card                                                                   */
/* -------------------------------------------------------------------------- */

export function ContraceptionCard() {
  const { toast } = useToast();
  const methods = useContraceptionMethods();
  // The API may not be there yet, and an empty list is the honest answer either
  // way: no method recorded is not an error state.
  const list = methods.data ?? [];

  const [editing, setEditing] = useState<ContraceptionMethodRecord | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ContraceptionMethodRecord | null>(null);

  const remove = useDeleteMethod({
    onError: (message) => toast({ title: 'Could not delete the method', description: message, variant: 'error' }),
    onSuccess: () => {
      toast({ title: 'Method deleted', variant: 'success' });
      void methods.refresh();
    },
  });

  function openForm(record: ContraceptionMethodRecord | null) {
    setEditing(record);
    setFormOpen(true);
  }

  /*
   * "Active" is "has no end date", which is the contract's own definition of
   * still in use (`endDate: null`). There is deliberately no comparison against
   * today here: a floating date compared against a device clock in some other
   * zone is how "still using" turns into "ended yesterday".
   */
  const activeHormonal = list.filter((record) => record.endDate === null && isHormonalMethod(record.method));

  return (
    <>
      <SettingsGroup
        title="Contraception"
        action={
          <Button size="sm" variant="ghost" onClick={() => openForm(null)}>
            <PlusIcon />
            Add method
          </Button>
        }
        footer="Ending a method (by giving it an end date) and adding the next one is how a change of method is kept in the history. Hormonal methods suppress ovulation; non-hormonal ones leave the cycle alone, but a calendar estimate is still not a contraceptive guarantee on its own — the calendar method has a typical-use failure rate of about 24% per year."
      >
        {activeHormonal.length > 0 ? (
          <SettingsRow className="items-start">
            <ExclamationCircledIcon aria-hidden className="mt-0.5 shrink-0 text-muted-foreground" />
            <p className="min-w-0 flex-1 text-xs text-muted-foreground">
              {nameList(activeHormonal)} {activeHormonal.length === 1 ? 'suppresses' : 'suppress'} ovulation, so an
              ovulation or fertile-window estimate is not a statement about your fertility while{' '}
              {activeHormonal.length === 1 ? 'it is' : 'they are'} in use.
            </p>
          </SettingsRow>
        ) : null}

        {methods.isInitialLoading ? (
          <SettingsRow>
            <Skeleton className="h-10 w-full" />
          </SettingsRow>
        ) : list.length === 0 ? (
          <SettingsRow>
            <span className="min-w-0 flex-1">
              <span className="block text-sm">{methods.error ? 'Could not load your methods' : 'No methods recorded'}</span>
              <span className="block text-xs text-muted-foreground">
                {methods.error ?? 'Add one to record what you use and since when.'}
              </span>
            </span>
          </SettingsRow>
        ) : (
          list.map((record) => (
            <SettingsRow key={record.id} stacked>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{METHOD_LABEL[record.method]}</p>
                  {record.label ? <p className="truncate text-xs text-muted-foreground">{record.label}</p> : null}
                </div>
                <Button size="sm" variant="ghost" aria-label={`Edit ${methodName(record)}`} onClick={() => openForm(record)}>
                  <Pencil1Icon />
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  aria-label={`Delete ${methodName(record)}`}
                  onClick={() => setDeleteTarget(record)}
                >
                  <TrashIcon />
                  Delete
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">{rangeText(record)}</p>

              <p className="text-xs text-muted-foreground">
                {rhythmLabel(record)} · {isHormonalMethod(record.method) ? 'hormonal method' : 'non-hormonal method'}
              </p>
            </SettingsRow>
          ))
        )}
      </SettingsGroup>

      <MethodFormDrawer
        open={formOpen}
        record={editing}
        onOpenChange={setFormOpen}
        onSaved={() => void methods.refresh()}
      />

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this method?</DialogTitle>
            <DialogDescription>
              {deleteTarget ? `${methodName(deleteTarget)} — ${rangeText(deleteTarget)} — will be removed.` : ''} This
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (deleteTarget) void remove.run(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
