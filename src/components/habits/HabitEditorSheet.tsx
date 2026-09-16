'use client';

/**
 * Create or edit a habit.
 *
 * One sheet for both, because the fields are identical and a separate "new
 * habit" screen would duplicate every control. Archive and Delete only appear
 * when editing — they are actions on a habit that exists.
 *
 * Two server contracts worth knowing:
 *   - `reminderAt` is a wall-clock `HH:mm`; the API anchors it itself, and it
 *     anchors in UTC, so the value is read back with the same zone to keep the
 *     round trip exact.
 *   - the update schema is `.strict()`, so the body is built field by field
 *     rather than spreading the form state.
 */
import { useEffect, useRef, useState } from 'react';
import { Archive, Trash2 } from 'lucide-react';
import {
  Button,
  ColorPicker,
  ConfirmDialog,
  DateField,
  SegmentedControl,
  Sheet,
  Stepper,
  Switch,
  TextArea,
  TextField,
  TimeField,
  useToast,
} from '@/components/ui';
import { api } from '@/lib/api-client';
import { useMutation } from '@/lib/store';
import { cn } from '@/lib/cn';
import { timeIn } from '@/lib/dates';
import { DEFAULT_HABIT_ICON, HABIT_ICON_NAMES, asHabitIconName, habitIcon, habitIconLabel } from './icons';
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

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        title={editing ? 'Edit habit' : 'New habit'}
        snapPoints={[0.6, 0.95]}
        footer={
          <Button fullWidth size="lg" loading={save.isPending} onClick={() => void save.run()}>
            {editing ? 'Save changes' : 'Create habit'}
          </Button>
        }
      >
        <div className="space-y-5 pb-4">
          {formError ? (
            <p role="alert" className="rounded-ios-md bg-tint-soft px-3 py-2.5 text-footnote text-danger">
              {formError}
            </p>
          ) : null}

          <section className="space-y-3">
            <TextField
              label="Name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (nameError) setNameError(null);
              }}
              placeholder="Drink water"
              error={nameError}
              maxLength={200}
              autoComplete="off"
            />
            <TextArea
              label="Description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Why this habit matters"
              rows={2}
              maxLength={2000}
            />
          </section>

          <section>
            <p className="mb-2 px-1 text-footnote text-secondary">Icon</p>
            <div role="radiogroup" aria-label="Habit icon" className="grid grid-cols-6 gap-2">
              {HABIT_ICON_NAMES.map((option) => {
                const Icon = habitIcon(option);
                const selected = option === icon;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={habitIconLabel(option)}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setIcon(option)}
                    className={cn(
                      'flex size-11 items-center justify-center rounded-ios-md',
                      'pressable',
                      selected ? 'bg-tint text-tint-contrast' : 'bg-fill-tertiary text-label',
                    )}
                  >
                    <Icon className="size-5" aria-hidden />
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <p className="mb-2 px-1 text-footnote text-secondary">Colour</p>
            <ColorPicker value={color} onChange={setColor} label="Habit colour" />
          </section>

          <section>
            <p className="mb-2 px-1 text-footnote text-secondary">Goal</p>
            <SegmentedControl options={GOAL_OPTIONS} value={goalType} onChange={setGoalType} label="Goal type" />
            {counted ? (
              <div className="mt-3 space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-ios-md bg-elevated px-3 py-2">
                  <span className="text-body text-label">{goalType === 'duration' ? 'Target minutes' : 'Target'}</span>
                  <Stepper
                    label="Goal target"
                    value={goalTarget}
                    min={1}
                    max={1440}
                    onChange={setGoalTarget}
                    formatValue={(value) => `${value}`}
                  />
                </div>
                <TextField
                  label="Unit"
                  value={unit}
                  onChange={(event) => setUnit(event.target.value)}
                  placeholder={goalType === 'duration' ? 'min' : 'glasses'}
                  hint={goalType === 'duration' ? 'Leave blank to count minutes.' : 'Shown next to the progress, e.g. “3/8 glasses”.'}
                  maxLength={24}
                  autoComplete="off"
                />
              </div>
            ) : null}
          </section>

          <section>
            <p className="mb-2 px-1 text-footnote text-secondary">Frequency</p>
            <SegmentedControl
              options={FREQUENCY_OPTIONS}
              value={frequency}
              onChange={setFrequency}
              label="Frequency"
              size="sm"
            />

            {frequency === 'custom' ? (
              <div role="group" aria-label="Days of the week" className="mt-3 flex justify-between gap-1">
                {WEEKDAY_LABELS.map((day) => {
                  const selected = weekDays.includes(day.day);
                  return (
                    <button
                      key={day.long}
                      type="button"
                      aria-pressed={selected}
                      aria-label={day.long}
                      onClick={() =>
                        setWeekDays((current) =>
                          current.includes(day.day) ? current.filter((d) => d !== day.day) : [...current, day.day],
                        )
                      }
                      className={cn(
                        'flex size-11 items-center justify-center rounded-full text-subhead font-medium pressable',
                        selected ? 'bg-tint text-tint-contrast' : 'bg-fill-tertiary text-secondary',
                      )}
                    >
                      {day.short}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {frequency === 'weekly' || frequency === 'monthly' ? (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-ios-md bg-elevated px-3 py-2">
                <span className="text-body text-label">
                  Times per {frequency === 'weekly' ? 'week' : 'month'}
                </span>
                <Stepper label="Times per period" value={timesPerPeriod} min={1} max={31} onChange={setTimesPerPeriod} />
              </div>
            ) : null}
          </section>

          <section className="space-y-3">
            <DateField label="Start date" value={startDate} onChange={setStartDate} />
            <TimeField
              label="Reminder"
              value={reminder}
              onChange={setReminder}
              clearable={Boolean(reminder)}
              onClear={() => setReminder(null)}
              placeholder="No reminder"
            />
          </section>

          {editing && habit ? (
            <section className="space-y-3 pt-2">
              <Switch
                label="Archived"
                checked={archived}
                disabled={busy}
                onCheckedChange={(next) => {
                  setArchived(next);
                  void patch.run({ archived: next });
                }}
              />
              <p className="px-1 text-footnote text-secondary">
                An archived habit keeps its history but is hidden from the list and from the daily check-ins.
              </p>

              <Button
                fullWidth
                variant="gray"
                icon={Archive}
                disabled={busy || archived}
                onClick={() => {
                  setArchived(true);
                  void patch.run({ archived: true }).then(() => onOpenChange(false));
                }}
              >
                Archive habit
              </Button>
              <Button
                fullWidth
                variant="destructive"
                icon={Trash2}
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                Delete habit
              </Button>
            </section>
          ) : null}
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this habit?"
        message={`“${habit?.name ?? 'This habit'}” and every check-in in its history will be removed. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => void remove.run()}
      />
    </>
  );
}

/** Sorts weekdays into Monday-first order and de-duplicates them. */
function sortWeekDays(days: number[]): number[] {
  const unique = [...new Set(days)];
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.filter((day) => unique.includes(day));
}

/** `HH:mm` of an instant, read in the same zone the API writes it in. */
function timeOnlyFrom(instantMs: number): TimeOnly | null {
  return timeIn(instantMs, REMINDER_ZONE);
}
