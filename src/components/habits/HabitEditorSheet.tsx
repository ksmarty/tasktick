'use client';

/**
 * Create or edit a habit.
 *
 * One dialog for both, because the fields are identical and a separate "new
 * habit" screen would duplicate every control. Archive and Delete only appear
 * when editing — they are actions on a habit that exists.
 *
 * Material shapes the overlay: a `Dialog` that becomes `fullScreen` below the
 * `sm` breakpoint (the phone case, where the sheet used to snap to 60%/95%),
 * with the single save action pinned in `DialogActions`. The segmented choices
 * are `ToggleButtonGroup`s — Material has no colour picker, so the twelve
 * swatches are a `ToggleButtonGroup` of colour buttons, and the same control
 * carries the icon, goal, frequency and weekday choices. The numeric steppers
 * are two `IconButton`s around a value, and the date/time fields are the app's
 * `@mui/x-date-pickers` (Luxon adapter).
 *
 * Two server contracts worth knowing:
 *   - `reminderAt` is a wall-clock `HH:mm`; the API anchors it itself, and it
 *     anchors in UTC, so the value is read back with the same zone to keep the
 *     round trip exact.
 *   - the update schema is `.strict()`, so the body is built field by field
 *     rather than spreading the form state.
 */
import { useEffect, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import ArchiveIcon from '@mui/icons-material/Archive';
import CheckIcon from '@mui/icons-material/Check';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import { AdapterLuxon } from '@mui/x-date-pickers/AdapterLuxon';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { TimePicker } from '@mui/x-date-pickers/TimePicker';
import { ACCENT_LABEL, accentHex } from '@/lib/colors';
import { api } from '@/lib/api-client';
import { useMutation } from '@/lib/store';
import { timeIn } from '@/lib/dates';
import { ACCENT_COLORS } from '@/lib/types';
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
  return (
    <Typography variant="body2" color="text.secondary" sx={{ mb: 1, px: 0.5 }}>
      {children}
    </Typography>
  );
}

/**
 * `− value +`, the numeric control the old `Stepper` was.
 *
 * The two buttons are separate real MUI `IconButton`s with their own accessible
 * names, and each disables itself at its bound so the user can see which way is
 * still available.
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
    <Box role="group" aria-label={label} sx={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      <IconButton
        aria-label={`Decrease ${label}`}
        disabled={!canDecrease}
        onClick={() => onChange(clampNumber(current - step, min, max))}
        sx={{ bgcolor: 'action.hover', borderRadius: 1, '&:hover': { bgcolor: 'action.selected' } }}
      >
        <RemoveIcon sx={{ fontSize: 20 }} />
      </IconButton>
      <Typography
        sx={{ minWidth: 32, textAlign: 'center', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
      >
        {`${current}`}
      </Typography>
      <IconButton
        aria-label={`Increase ${label}`}
        disabled={!canIncrease}
        onClick={() => onChange(clampNumber(current + step, min, max))}
        sx={{ bgcolor: 'action.hover', borderRadius: 1, '&:hover': { bgcolor: 'action.selected' } }}
      >
        <AddIcon sx={{ fontSize: 20 }} />
      </IconButton>
    </Box>
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
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
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
      <LocalizationProvider dateAdapter={AdapterLuxon}>
        <Dialog
          open={open}
          onClose={() => onOpenChange(false)}
          fullScreen={fullScreen}
          fullWidth
          maxWidth="sm"
        >
          <DialogTitle>{editing ? 'Edit habit' : 'New habit'}</DialogTitle>

          <DialogContent dividers>
            <Stack spacing={2.5} sx={{ pb: 1 }}>
              {formError ? (
                <Box role="alert" sx={{ borderRadius: 1, bgcolor: 'action.hover', px: 1.5, py: 1.25 }}>
                  <Typography variant="body2" color="error">
                    {formError}
                  </Typography>
                </Box>
              ) : null}

              <Stack spacing={1.5}>
                <TextField
                  label="Name"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    if (nameError) setNameError(null);
                  }}
                  placeholder="Drink water"
                  error={Boolean(nameError)}
                  helperText={nameError ?? undefined}
                  autoComplete="off"
                  fullWidth
                  slotProps={{ htmlInput: { maxLength: 200 } }}
                />
                <TextField
                  label="Description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Why this habit matters"
                  multiline
                  rows={2}
                  fullWidth
                  slotProps={{ htmlInput: { maxLength: 2000 } }}
                />
              </Stack>

              <Box>
                <FieldLabel>Icon</FieldLabel>
                <ToggleButtonGroup
                  exclusive
                  aria-label="Habit icon"
                  value={icon}
                  onChange={(_event, next: string | null) => {
                    if (next) setIcon(next);
                  }}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
                    gap: 1,
                    border: 0,
                    '& .MuiToggleButtonGroup-grouped': { border: 0, m: 0, borderRadius: 1 },
                  }}
                >
                  {HABIT_ICON_NAMES.map((option) => {
                    const Icon = habitIcon(option);
                    return (
                      <ToggleButton
                        key={option}
                        value={option}
                        aria-label={habitIconLabel(option)}
                        sx={{ minWidth: 44, minHeight: 44, p: 0 }}
                      >
                        <Icon sx={{ fontSize: 20 }} aria-hidden />
                      </ToggleButton>
                    );
                  })}
                </ToggleButtonGroup>
              </Box>

              <Box>
                <FieldLabel>Colour</FieldLabel>
                <ToggleButtonGroup
                  exclusive
                  aria-label="Habit colour"
                  value={color}
                  onChange={(_event, next: AccentColor | null) => {
                    if (next) setColor(next);
                  }}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
                    gap: 1,
                    border: 0,
                    '& .MuiToggleButtonGroup-grouped': { border: 0, m: 0, borderRadius: '50%' },
                  }}
                >
                  {ACCENT_COLORS.map((option) => (
                    <ToggleButton
                      key={option}
                      value={option}
                      aria-label={ACCENT_LABEL[option]}
                      sx={{
                        width: '100%',
                        minWidth: 44,
                        aspectRatio: '1 / 1',
                        p: 0,
                        bgcolor: accentHex(option),
                        '&:hover': { bgcolor: accentHex(option), filter: 'brightness(0.92)' },
                        '&.Mui-selected': { bgcolor: accentHex(option) },
                        '&.Mui-selected:hover': { bgcolor: accentHex(option), filter: 'brightness(0.92)' },
                      }}
                    >
                      {option === color ? (
                        <CheckIcon
                          aria-hidden
                          sx={{ fontSize: 18, color: 'common.white', filter: 'drop-shadow(0 0 1px rgba(0,0,0,0.7))' }}
                        />
                      ) : null}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </Box>

              <Box>
                <FieldLabel>Goal</FieldLabel>
                <ToggleButtonGroup
                  exclusive
                  fullWidth
                  size="small"
                  aria-label="Goal type"
                  value={goalType}
                  onChange={(_event, next: HabitGoalType | null) => {
                    if (next) setGoalType(next);
                  }}
                >
                  {GOAL_OPTIONS.map((option) => (
                    <ToggleButton key={option.value} value={option.value} sx={{ flex: 1 }}>
                      {option.label}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
                {counted ? (
                  <Stack spacing={1.5} sx={{ mt: 1.5 }}>
                    <Stack
                      direction="row"
                      sx={{
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 1.5,
                        borderRadius: 1,
                        bgcolor: 'action.hover',
                        px: 1.5,
                        py: 1,
                      }}
                    >
                      <Typography variant="body1">
                        {goalType === 'duration' ? 'Target minutes' : 'Target'}
                      </Typography>
                      <NumberStepper
                        label="Goal target"
                        value={goalTarget}
                        min={1}
                        max={1440}
                        onChange={setGoalTarget}
                      />
                    </Stack>
                    <TextField
                      label="Unit"
                      value={unit}
                      onChange={(event) => setUnit(event.target.value)}
                      placeholder={goalType === 'duration' ? 'min' : 'glasses'}
                      helperText={
                        goalType === 'duration'
                          ? 'Leave blank to count minutes.'
                          : 'Shown next to the progress, e.g. “3/8 glasses”.'
                      }
                      autoComplete="off"
                      fullWidth
                      slotProps={{ htmlInput: { maxLength: 24 } }}
                    />
                  </Stack>
                ) : null}
              </Box>

              <Box>
                <FieldLabel>Frequency</FieldLabel>
                <ToggleButtonGroup
                  exclusive
                  fullWidth
                  size="small"
                  aria-label="Frequency"
                  value={frequency}
                  onChange={(_event, next: HabitFrequency | null) => {
                    if (next) setFrequency(next);
                  }}
                >
                  {FREQUENCY_OPTIONS.map((option) => (
                    <ToggleButton key={option.value} value={option.value} sx={{ flex: 1 }}>
                      {option.label}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>

                {frequency === 'custom' ? (
                  <ToggleButtonGroup
                    aria-label="Days of the week"
                    value={weekDays}
                    onChange={(_event, next: number[]) => setWeekDays(next)}
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                      gap: 0.5,
                      mt: 1.5,
                      border: 0,
                      '& .MuiToggleButtonGroup-grouped': { border: 0, m: 0, borderRadius: '50%' },
                    }}
                  >
                    {WEEKDAY_LABELS.map((day) => (
                      <ToggleButton
                        key={day.long}
                        value={day.day}
                        aria-label={day.long}
                        sx={{ minWidth: 40, minHeight: 40, p: 0, fontWeight: 500 }}
                      >
                        {day.short}
                      </ToggleButton>
                    ))}
                  </ToggleButtonGroup>
                ) : null}

                {frequency === 'weekly' || frequency === 'monthly' ? (
                  <Stack
                    direction="row"
                    sx={{
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 1.5,
                      borderRadius: 1,
                      bgcolor: 'action.hover',
                      px: 1.5,
                      py: 1,
                      mt: 1.5,
                    }}
                  >
                    <Typography variant="body1">
                      {`Times per ${frequency === 'weekly' ? 'week' : 'month'}`}
                    </Typography>
                    <NumberStepper
                      label="Times per period"
                      value={timesPerPeriod}
                      min={1}
                      max={31}
                      onChange={setTimesPerPeriod}
                    />
                  </Stack>
                ) : null}
              </Box>

              <Stack spacing={1.5}>
                <DatePicker
                  label="Start date"
                  value={dateToDateTime(startDate)}
                  onChange={(value) => {
                    if (value) setStartDate(value.toFormat('yyyy-MM-dd'));
                  }}
                  slotProps={{ textField: { fullWidth: true } }}
                />
                <TimePicker
                  label="Reminder"
                  ampm={false}
                  value={reminder ? timeToDateTime(reminder, today) : null}
                  onChange={(value) => setReminder(value ? value.toFormat('HH:mm') : null)}
                  slotProps={{
                    textField: { fullWidth: true },
                    field: { clearable: Boolean(reminder) },
                  }}
                />
              </Stack>

              {editing && habit ? (
                <Stack spacing={1.5} sx={{ pt: 1 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={archived}
                        disabled={busy}
                        onChange={(event) => {
                          const next = event.target.checked;
                          setArchived(next);
                          void patch.run({ archived: next });
                        }}
                      />
                    }
                    label="Archived"
                  />
                  <Typography variant="body2" color="text.secondary" sx={{ px: 0.5 }}>
                    An archived habit keeps its history but is hidden from the list and from the daily check-ins.
                  </Typography>

                  <Button
                    fullWidth
                    variant="contained"
                    color="inherit"
                    disableElevation
                    startIcon={<ArchiveIcon />}
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
                    color="error"
                    variant="contained"
                    disableElevation
                    startIcon={<DeleteIcon />}
                    disabled={busy}
                    onClick={() => setConfirmDelete(true)}
                  >
                    Delete habit
                  </Button>
                </Stack>
              ) : null}
            </Stack>
          </DialogContent>

          <DialogActions
            sx={{
              px: 2,
              pt: 1.5,
              pb: 'max(1rem, env(safe-area-inset-bottom, 0px))',
            }}
          >
            <Button
              variant="contained"
              fullWidth
              size="large"
              loading={save.isPending}
              onClick={() => void save.run()}
            >
              {editing ? 'Save changes' : 'Create habit'}
            </Button>
          </DialogActions>
        </Dialog>
      </LocalizationProvider>

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>Delete this habit?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {`“${habit?.name ?? 'This habit'}” and every check-in in its history will be removed. This cannot be undone.`}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            disableElevation
            onClick={() => void remove.run()}
          >
            Delete
          </Button>
        </DialogActions>
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

/** A floating day as a picker value, anchored in UTC so no zone can shift it. */
function dateToDateTime(date: DateOnly): DateTime {
  return DateTime.fromISO(date, { zone: REMINDER_ZONE });
}

/** A wall-clock `HH:mm` as a picker value on `anchor`, anchored in UTC. */
function timeToDateTime(time: TimeOnly, anchor: DateOnly): DateTime {
  return DateTime.fromISO(`${anchor}T${time}`, { zone: REMINDER_ZONE });
}

/** `HH:mm` of an instant, read in the same zone the API writes it in. */
function timeOnlyFrom(instantMs: number): TimeOnly | null {
  return timeIn(instantMs, REMINDER_ZONE);
}
