'use client';

/**
 * Create or edit a habit.
 *
 * One dialog for both, because the fields are identical and a separate "new
 * habit" screen would duplicate every control. Archive and Delete only appear
 * when editing — they are actions on a habit that exists.
 *
 * The overlay is the shadcn `Dialog`: full-screen below `sm` (the phone case,
 * where the sheet used to snap to 60%/95%) and a centred card above it, with the
 * single save action pinned in the footer. Radix owns the focus trap, the escape
 * key and the scroll lock, so the hand-rolled trap the Material version carried
 * is gone rather than layered underneath.
 *
 * The segmented choices (goal, frequency) are the GodUI `SegmentedControl`; the
 * icon, colour and weekday pickers are `role="group"` grids of `aria-pressed`
 * buttons, because they are multi-swatch pickers rather than a two-or-four way
 * segmented choice and the old `ToggleButtonGroup` semantics were a pressed
 * button, not a tab. There is no colour input in shadcn, so the twelve swatches
 * are buttons painted with the accent's hex (`@/lib/colors`), each with the
 * accent's own accessible label. The numeric steppers are two buttons around a
 * value, and the date field is the shadcn `Calendar` in a `Popover`.
 *
 * Two server contracts worth knowing:
 *   - `reminderAt` is a wall-clock `HH:mm`; the API anchors it itself, and it
 *     anchors in UTC, so the value is read back with the same zone to keep the
 *     round trip exact.
 *   - the update schema is `.strict()`, so the body is built field by field
 *     rather than spreading the form state.
 */
import { useEffect, useRef, useState } from 'react';
import { ArchiveIcon } from '@svg-animated-icons/react/archive';
import { CalendarIcon } from '@svg-animated-icons/react/calendar';
import { CheckIcon } from '@svg-animated-icons/react/check';
import { MinusIcon } from '@svg-animated-icons/react/minus';
import { PlusIcon } from '@svg-animated-icons/react/plus';
import { TrashIcon } from '@svg-animated-icons/react/trash';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { SegmentedControl } from '@/components/godui/segmented-control';
import { cn } from '@/lib/utils';
import { ACCENT_LABEL, accentHex } from '@/lib/colors';
import { api } from '@/lib/api-client';
import { useMutation } from '@/lib/store';
import { timeIn } from '@/lib/dates';
import { ACCENT_COLORS } from '@/lib/types';
import { longDateLabel } from './period';
import { DEFAULT_HABIT_ICON, HABIT_ICON_NAMES, asHabitIconName, habitIcon, habitIconLabel } from './icons';
import { useToast } from '@/components/app/Toast';
import type { AccentColor, DateOnly, Habit, HabitFrequency, HabitGoalType, TimeOnly } from '@/lib/types';

/** The API stores a habit reminder anchored in UTC; read it back the same way. */
const REMINDER_ZONE = 'utc';

const GOAL_OPTIONS: { value: HabitGoalType; label: string }[] = [
  { value: 'boolean', label: 'Done' },
  { value: 'count', label: 'Count' },
  { value: 'duration', label: 'Time' },
];

const FREQUENCY_OPTIONS: { value: HabitFrequency; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'custom', label: 'Custom' },
];

/** Sunday-first, matching `weekDays` in the domain model. */
const WEEKDAY_LABELS = [
  { day: 1, short: 'M', long: 'Monday' },
  { day: 2, short: 'T', long: 'Tuesday' },
  { day: 3, short: 'W', long: 'Wednesday' },
  { day: 4, short: 'T', long: 'Thursday' },
  { day: 5, short: 'F', long: 'Friday' },
  { day: 6, short: 'S', long: 'Saturday' },
  { day: 0, short: 'S', long: 'Sunday' },
];

/** A small section caption above a group of controls. */
function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-1 px-0.5 text-sm text-muted-foreground">{children}</p>;
}

/**
 * The shared shape of a picker swatch: a square button with the 44px touch
 * target the Material toggles had.
 */
const SWATCH_CLASS = 'flex aspect-square min-h-11 items-center justify-center rounded-md border';
const SWATCH_IDLE = 'border-border text-muted-foreground hover:bg-accent';
const SWATCH_ACTIVE = 'border-primary bg-secondary text-primary';
/** The weekday toggles are borderless: a filled circle when on, plain when off. */
const WEEKDAY_IDLE = 'text-muted-foreground hover:bg-accent';

/**
 * `− value +`, the numeric control the old `Stepper` was.
 *
 * The two buttons are separate real buttons with their own accessible names, and
 * each disables itself at its bound so the user can see which way is still
 * available.
 */
function NumberStepper({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  const current = clampNumber(value, min, max);
  const canDecrease = current > min;
  const canIncrease = current < max;

  return (
    <div role="group" aria-label={label} className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant="secondary"
        size="icon"
        aria-label={`Decrease ${label}`}
        disabled={!canDecrease}
        onClick={() => onChange(clampNumber(current - step, min, max))}
      >
        <MinusIcon />
      </Button>
      <span className="min-w-8 text-center font-semibold tabular-nums">{`${current}`}</span>
      <Button
        type="button"
        variant="secondary"
        size="icon"
        aria-label={`Increase ${label}`}
        disabled={!canIncrease}
        onClick={() => onChange(clampNumber(current + step, min, max))}
      >
        <PlusIcon />
      </Button>
    </div>
  );
}

export interface HabitEditorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The habit being edited, or `null` to create a new one. */
  habit?: Habit | null;
  today: DateOnly;
  /** Called after any successful write so the list can refetch. */
  onChanged?: () => void;
}

export function HabitEditorSheet({ open, onOpenChange, habit = null, today, onChanged }: HabitEditorSheetProps) {
  const { toast } = useToast();
  const editing = Boolean(habit);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState<string>(DEFAULT_HABIT_ICON);
  const [color, setColor] = useState<AccentColor>('green');
  const [goalType, setGoalType] = useState<HabitGoalType>('boolean');
  const [goalTarget, setGoalTarget] = useState(1);
  const [unit, setUnit] = useState('');
  const [frequency, setFrequency] = useState<HabitFrequency>('daily');
  const [weekDays, setWeekDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [timesPerPeriod, setTimesPerPeriod] = useState(3);
  const [startDate, setStartDate] = useState<DateOnly>(today);
  const [reminder, setReminder] = useState<TimeOnly | null>(null);
  const [archived, setArchived] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  /** A problem with the form as a whole, shown above the fields. */
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);

  // Hydrate once per opening. Keyed on the habit id rather than the object, so a
  // background revalidation of the list cannot wipe what the user is typing.
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      hydratedFor.current = null;
      return;
    }
    const key = `${habit?.id ?? 'new'}:${today}`;
    if (hydratedFor.current === key) return;
    hydratedFor.current = key;

    setName(habit?.name ?? '');
    setDescription(habit?.description ?? '');
    setIcon(asHabitIconName(habit?.icon));
    setColor(habit?.color ?? 'green');
    setGoalType(habit?.goalType ?? 'boolean');
    setGoalTarget(habit?.goalTarget && habit.goalTarget > 0 ? habit.goalTarget : 1);
    setUnit(habit?.unit ?? '');
    setFrequency(habit?.frequency ?? 'daily');
    setWeekDays(habit?.weekDays?.length ? habit.weekDays : [1, 2, 3, 4, 5]);
    setTimesPerPeriod(habit?.timesPerPeriod && habit.timesPerPeriod > 1 ? habit.timesPerPeriod : 3);
    setStartDate(habit?.startDate ?? today);
    setReminder(habit?.reminderAtMs ? timeOnlyFrom(habit.reminderAtMs) : null);
    setArchived(Boolean(habit?.archived));
    setNameError(null);
    setFormError(null);
  }, [habit, open, today]);

  const save = useMutation(
    async () => {
      setFormError(null);
      const trimmed = name.trim();
      if (!trimmed) {
        setNameError('Give the habit a name.');
        throw new Error('Give the habit a name.');
      }
      // A custom schedule with no days would silently mean "every day" on the
      // server, which is not what the user chose.
      if (frequency === 'custom' && weekDays.length === 0) {
        throw new Error('Choose at least one day of the week, or switch to daily.');
      }
      const body = {
        name: trimmed,
        description: description.trim() ? description.trim() : null,
        icon,
        color,
        goalType,
        goalTarget: goalType === 'boolean' ? 1 : Math.max(1, goalTarget),
        unit: goalType === 'boolean' ? null : unit.trim() || null,
        frequency,
        weekDays: frequency === 'custom' ? sortWeekDays(weekDays) : null,
        timesPerPeriod: frequency === 'daily' || frequency === 'custom' ? 1 : Math.max(1, timesPerPeriod),
        startDate,
        reminderAt: reminder,
      };
      return habit
        ? await api.patch<Habit>(`/api/habits/${habit.id}`, body)
        : await api.post<Habit>('/api/habits', body);
    },
    {
      invalidates: ['/api/habits'],
      onSuccess: (saved) => {
        toast({ title: editing ? 'Habit updated' : 'Habit created', description: saved?.name });
        onChanged?.();
        onOpenChange(false);
      },
      onError: (message) => {
        setFormError(message);
        toast({ title: 'Could not save the habit', description: message, variant: 'error' });
      },
    },
  );

  const patch = useMutation(
    async (body: { archived?: boolean }) => api.patch<Habit>(`/api/habits/${habit?.id}`, body),
    {
      invalidates: ['/api/habits'],
      onSuccess: (_result, [body]) => {
        onChanged?.();
        if (body.archived !== undefined) {
          toast({
            title: body.archived ? 'Habit archived' : 'Habit restored',
            variant: 'success',
          });
        }
      },
      onError: (message) => toast({ title: 'Could not update the habit', description: message, variant: 'error' }),
    },
  );

  const remove = useMutation(async () => api.delete<{ deleted: boolean }>(`/api/habits/${habit?.id}`), {
    invalidates: ['/api/habits'],
    onSuccess: () => {
      toast({ title: 'Habit deleted', description: 'Its history has been removed.', variant: 'success' });
      onChanged?.();
      onOpenChange(false);
    },
    onError: (message) => toast({ title: 'Could not delete the habit', description: message, variant: 'error' }),
  });

  const busy = save.isPending || patch.isPending || remove.isPending;
  const counted = goalType !== 'boolean';

  /** Flips the switch locally and persists it, exactly as the Material switch did. */
  function setArchivedAndPersist(next: boolean) {
    setArchived(next);
    void patch.run({ archived: next });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          // Full-screen under `sm`, a centred card above it: the sizes the
          // Material dialog used, expressed as two sets of utilities.
          className="max-h-[90dvh] gap-0 overflow-hidden p-0 max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0 sm:max-w-lg"
        >
          <DialogHeader className="shrink-0 gap-0 border-b border-border px-card py-stack">
            <DialogTitle className="text-lg font-semibold">{editing ? 'Edit habit' : 'New habit'}</DialogTitle>
            <DialogDescription className="sr-only">
              Set the habit&rsquo;s name, icon, colour, goal, schedule, start date and reminder.
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-card py-card">
            {formError ? (
              <p role="alert" className="rounded-md bg-muted px-3 py-3 text-sm text-destructive">
                {formError}
              </p>
            ) : null}

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="habit-name">Name</Label>
                <Input
                  id="habit-name"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    if (nameError) setNameError(null);
                  }}
                  placeholder="Drink water"
                  aria-invalid={Boolean(nameError)}
                  autoComplete="off"
                  maxLength={200}
                />
                {nameError ? <p className="text-sm text-destructive">{nameError}</p> : null}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="habit-description">Description</Label>
                <Textarea
                  id="habit-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Why this habit matters"
                  rows={2}
                  maxLength={2000}
                />
              </div>
            </div>

            <div>
              <FieldLabel>Icon</FieldLabel>
              <div role="group" aria-label="Habit icon" className="grid grid-cols-6 gap-2">
                {HABIT_ICON_NAMES.map((option) => {
                  const Icon = habitIcon(option);
                  const active = option === icon;
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-label={habitIconLabel(option)}
                      aria-pressed={active}
                      onClick={() => setIcon(option)}
                      className={cn(SWATCH_CLASS, active ? SWATCH_ACTIVE : SWATCH_IDLE)}
                    >
                      {/* `size-5` plus `text-xl`: the animated glyphs draw at
                          `1em`, lucide's at the class size, so naming both keeps
                          the two sets the same 20px. */}
                      <Icon className="size-5 text-xl" />
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <FieldLabel>Colour</FieldLabel>
              <div role="group" aria-label="Habit colour" className="grid grid-cols-6 gap-2">
                {ACCENT_COLORS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-label={ACCENT_LABEL[option]}
                    aria-pressed={option === color}
                    onClick={() => setColor(option)}
                    // The one thing a class cannot carry: an accent is a stored
                    // name and its hex lives in JS (`@/lib/colors`).
                    style={{ backgroundColor: accentHex(option) }}
                    className="flex aspect-square min-h-11 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {option === color ? (
                      <CheckIcon aria-hidden className="size-4 text-white drop-shadow-sm" />
                    ) : null}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <FieldLabel>Goal</FieldLabel>
              <SegmentedControl
                aria-label="Goal type"
                className="flex w-full [&>button]:flex-1"
                value={goalType}
                onChange={(next) => setGoalType(next as HabitGoalType)}
                options={GOAL_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
              />
              {counted ? (
                <div className="mt-4 flex flex-col gap-4">
                  <div className="flex items-center justify-between gap-3 rounded-md bg-muted px-3 py-2">
                    <span className="text-base">{goalType === 'duration' ? 'Target minutes' : 'Target'}</span>
                    <NumberStepper label="Goal target" value={goalTarget} min={1} max={1440} onChange={setGoalTarget} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="habit-unit">Unit</Label>
                    <Input
                      id="habit-unit"
                      value={unit}
                      onChange={(event) => setUnit(event.target.value)}
                      placeholder={goalType === 'duration' ? 'min' : 'glasses'}
                      autoComplete="off"
                      maxLength={24}
                    />
                    <p className="text-sm text-muted-foreground">
                      {goalType === 'duration'
                        ? 'Leave blank to count minutes.'
                        : 'Shown next to the progress, e.g. “3/8 glasses”.'}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>

            <div>
              <FieldLabel>Frequency</FieldLabel>
              <SegmentedControl
                aria-label="Frequency"
                className="flex w-full [&>button]:flex-1"
                value={frequency}
                onChange={(next) => setFrequency(next as HabitFrequency)}
                options={FREQUENCY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
              />

              {frequency === 'custom' ? (
                <div role="group" aria-label="Days of the week" className="mt-4 grid grid-cols-7 gap-1">
                  {WEEKDAY_LABELS.map((day) => {
                    const active = weekDays.includes(day.day);
                    return (
                      <button
                        key={day.long}
                        type="button"
                        aria-label={day.long}
                        aria-pressed={active}
                        onClick={() =>
                          setWeekDays((current) =>
                            current.includes(day.day)
                              ? current.filter((value) => value !== day.day)
                              : [...current, day.day],
                          )
                        }
                        className={cn(
                          'flex aspect-square min-h-10 items-center justify-center rounded-full text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          active ? 'bg-primary text-primary-foreground' : WEEKDAY_IDLE,
                        )}
                      >
                        {day.short}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {frequency === 'weekly' || frequency === 'monthly' ? (
                <div className="mt-4 flex items-center justify-between gap-3 rounded-md bg-muted px-3 py-2">
                  <span className="text-base">{`Times per ${frequency === 'weekly' ? 'week' : 'month'}`}</span>
                  <NumberStepper
                    label="Times per period"
                    value={timesPerPeriod}
                    min={1}
                    max={31}
                    onChange={setTimesPerPeriod}
                  />
                </div>
              ) : null}
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="habit-start-date">Start date</Label>
                <Popover open={dateOpen} onOpenChange={setDateOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      id="habit-start-date"
                      type="button"
                      variant="outline"
                      aria-expanded={dateOpen}
                      className="w-full justify-start gap-2 font-normal"
                    >
                      <CalendarIcon />
                      {longDateLabel(startDate)}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={pickerDateOf(startDate)}
                      defaultMonth={pickerDateOf(startDate)}
                      onSelect={(value) => {
                        if (!value) return;
                        setStartDate(dateOnlyOf(value));
                        setDateOpen(false);
                      }}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="habit-reminder">Reminder</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="habit-reminder"
                    type="time"
                    value={reminder ?? ''}
                    onChange={(event) => setReminder(event.target.value ? (event.target.value as TimeOnly) : null)}
                    className="w-40"
                  />
                  {reminder ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setReminder(null)}>
                      Clear
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>

            {editing && habit ? (
              <div className="flex flex-col gap-4 pt-2">
                <div className="flex items-center justify-between gap-3 rounded-md bg-muted px-3 py-2">
                  <Label htmlFor="habit-archived">Archived</Label>
                  <Switch
                    id="habit-archived"
                    checked={archived}
                    disabled={busy}
                    onCheckedChange={(next) => setArchivedAndPersist(next)}
                  />
                </div>
                <p className="px-0.5 text-sm text-muted-foreground">
                  An archived habit keeps its history but is hidden from the list and from the daily check-ins.
                </p>

                <Button
                  type="button"
                  variant="secondary"
                  className="w-full gap-2"
                  disabled={busy || archived}
                  onClick={() => {
                    setArchived(true);
                    void patch.run({ archived: true }).then(() => onOpenChange(false));
                  }}
                >
                  <ArchiveIcon />
                  Archive habit
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="w-full gap-2"
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                >
                  <TrashIcon />
                  Delete habit
                </Button>
              </div>
            ) : null}
          </div>

          <DialogFooter className="shrink-0 border-t border-border px-card py-stack">
            <Button
              type="button"
              size="lg"
              className="w-full"
              disabled={save.isPending}
              aria-busy={save.isPending}
              onClick={() => void save.run()}
            >
              {editing ? 'Save changes' : 'Create habit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this habit?</DialogTitle>
            <DialogDescription>
              {`“${habit?.name ?? 'This habit'}” and every check-in in its history will be removed. This cannot be undone.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={remove.isPending} onClick={() => void remove.run()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Rounds away float drift, then clamps into `[min, max]`. */
function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value * 1e6) / 1e6));
}

/** Sorts weekdays into Monday-first order and de-duplicates them. */
function sortWeekDays(days: number[]): number[] {
  const unique = [...new Set(days)];
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.filter((day) => unique.includes(day));
}

/**
 * A floating day as a `Calendar` value.
 *
 * Built from local date parts rather than `new Date('yyyy-MM-dd')`: the picker
 * works in the browser's own zone, and a UTC-anchored `Date` would highlight the
 * previous day west of Greenwich.
 */
function pickerDateOf(date: DateOnly): Date {
  const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10));
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

/** A `Calendar` value back to a floating day, in the same local zone. */
function dateOnlyOf(value: Date): DateOnly {
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

/** `HH:mm` of an instant, read in the same zone the API writes it in. */
function timeOnlyFrom(instantMs: number): TimeOnly | null {
  return timeIn(instantMs, REMINDER_ZONE);
}
