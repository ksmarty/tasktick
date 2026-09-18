'use client';

/**
 * Reminder picker: the eight offsets everyone actually uses, multi-selectable.
 *
 * Offsets are stored the way the server expects them — minutes *added* to the
 * due instant — so "5 minutes before" is `-5`.
 */
import Box from '@mui/material/Box';
import Check from '@mui/icons-material/Check';
import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import NotificationsNone from '@mui/icons-material/NotificationsNone';
import Typography from '@mui/material/Typography';

export interface ReminderOffset {
  offsetMinutes: number;
  label: string;
}

export const REMINDER_OFFSETS: readonly ReminderOffset[] = [
  { offsetMinutes: 0, label: 'At time of due date' },
  { offsetMinutes: -5, label: '5 minutes before' },
  { offsetMinutes: -10, label: '10 minutes before' },
  { offsetMinutes: -15, label: '15 minutes before' },
  { offsetMinutes: -30, label: '30 minutes before' },
  { offsetMinutes: -60, label: '1 hour before' },
  { offsetMinutes: -120, label: '2 hours before' },
  { offsetMinutes: -1440, label: '1 day before' },
];

/** One-line summary of a task's reminders, for the row that opens this sheet. */
export function describeReminders(offsets: readonly number[]): string {
  if (offsets.length === 0) return 'None';
  return offsets
    .map((offset) => REMINDER_OFFSETS.find((item) => item.offsetMinutes === offset)?.label ?? `${offset} minutes before`)
    .join(', ');
}

export interface ReminderPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Currently selected offsets, in minutes relative to the due instant. */
  value: readonly number[];
  /** Relative reminders cannot fire without a due date, so they are refused. */
  hasDueDate: boolean;
  onChange: (offsets: number[]) => void;
}

export function ReminderPicker({ open, onOpenChange, value, hasDueDate, onChange }: ReminderPickerProps) {
  function toggle(offset: number) {
    if (!hasDueDate) return;
    const next = value.includes(offset) ? value.filter((item) => item !== offset) : [...value, offset].sort((a, b) => b - a);
    onChange(next);
  }

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={() => onOpenChange(false)}
      slotProps={{
        paper: {
          role: 'dialog',
          'aria-modal': true,
          'aria-label': 'Reminders',
          sx: { borderTopLeftRadius: 3, borderTopRightRadius: 3, maxHeight: '90dvh' },
        },
      }}
    >
      <Box
        sx={{
          borderTopLeftRadius: 3,
          borderTopRightRadius: 3,
          pb: 2,
          maxHeight: '90dvh',
          overflowY: 'auto',
        }}
      >
        <Typography variant="h6" sx={{ px: 2, pt: 2, pb: 1 }}>
          Reminders
        </Typography>

        <List sx={{ py: 0 }}>
          {REMINDER_OFFSETS.map((item) => {
            const selected = value.includes(item.offsetMinutes);
            return (
              <ListItemButton
                key={item.offsetMinutes}
                role="checkbox"
                aria-checked={selected}
                aria-disabled={!hasDueDate || undefined}
                onClick={() => toggle(item.offsetMinutes)}
                sx={{ opacity: hasDueDate ? 1 : 0.4 }}
              >
                <ListItemIcon sx={{ minWidth: 32 }}>
                  <NotificationsNone
                    sx={{ fontSize: 20, color: selected ? 'primary.main' : 'text.secondary' }}
                    aria-hidden
                  />
                </ListItemIcon>
                <ListItemText
                  primary={item.label}
                  slotProps={{ primary: { noWrap: true, sx: { color: 'text.primary' } } }}
                />
                {selected ? <Check sx={{ fontSize: 20, color: 'primary.main' }} aria-hidden /> : null}
              </ListItemButton>
            );
          })}
        </List>

        <Typography variant="caption" sx={{ display: 'block', px: 2, pt: 1.5, color: 'text.secondary' }}>
          {hasDueDate
            ? 'Each selected offset fires a notification before the task is due.'
            : 'Add a due date first — a reminder with nothing to count back from would never fire.'}
        </Typography>
      </Box>
    </Drawer>
  );
}
