'use client';

/**
 * Repeat picker, built from `REPEAT_PRESETS` so the rule this writes is the same
 * rule `@/lib/rrule` can describe back to the user.
 */
import Check from '@mui/icons-material/Check';
import Drawer from '@mui/material/Drawer';
import Repeat from '@mui/icons-material/Repeat';
import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import { REPEAT_PRESETS, buildRRule, describeRRule, matchPreset } from '@/lib/rrule';

export interface RepeatPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The task's current RRULE body, or `null` when it does not repeat. */
  value: string | null;
  /** Weekday (0 = Sunday) the weekly presets anchor on. */
  dueDay: number;
  /** `null` clears the repeat rule. */
  onChange: (rule: string | null) => void;
}

export function RepeatPicker({ open, onOpenChange, value, dueDay, onChange }: RepeatPickerProps) {
  const current = matchPreset(value, dueDay);
  const description = describeRRule(value);

  function choose(presetId: string) {
    const preset = REPEAT_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    const spec = preset.build({ dueDay, dueDate: null });
    onChange(spec ? buildRRule(spec) : null);
    onOpenChange(false);
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
          'aria-label': 'Repeat',
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
          Repeat
        </Typography>

        <List role="radiogroup" aria-label="Repeat" sx={{ py: 0 }}>
          {REPEAT_PRESETS.map((preset) => {
            const selected = preset.id === current;
            return (
              <ListItemButton
                key={preset.id}
                role="radio"
                aria-checked={selected}
                onClick={() => choose(preset.id)}
              >
                <ListItemIcon sx={{ minWidth: 32 }}>
                  <Repeat
                    sx={{ fontSize: 20, color: selected ? 'primary.main' : 'text.secondary' }}
                    aria-hidden
                  />
                </ListItemIcon>
                <ListItemText
                  primary={preset.label}
                  slotProps={{
                    primary: { noWrap: true, sx: { color: selected ? 'primary.main' : 'text.primary' } },
                  }}
                />
                {selected ? <Check sx={{ fontSize: 20, color: 'primary.main' }} aria-hidden /> : null}
              </ListItemButton>
            );
          })}
        </List>

        {description ? (
          <Typography variant="caption" sx={{ display: 'block', px: 2, pt: 1.5, color: 'text.secondary' }}>
            Currently: {description}.
          </Typography>
        ) : null}
      </Box>
    </Drawer>
  );
}
