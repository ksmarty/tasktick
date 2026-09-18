'use client';

/**
 * Priority picker: the four flags, in the colours the row and the bulk bar use.
 */
import Check from '@mui/icons-material/Check';
import Drawer from '@mui/material/Drawer';
import Flag from '@mui/icons-material/Flag';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { Priority } from '@/lib/types';
import { PRIORITY_ITEMS } from './priority';

export interface PriorityPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: Priority;
  onChange: (priority: Priority) => void;
  /** Heading; overridden by the bulk bar, which sets priority on many tasks. */
  title?: string;
}

export function PriorityPicker({ open, onOpenChange, value, onChange, title = 'Priority' }: PriorityPickerProps) {
  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={() => onOpenChange(false)}
      slotProps={{
        paper: {
          role: 'dialog',
          'aria-modal': true,
          'aria-label': title,
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
          {title}
        </Typography>

        <List role="radiogroup" aria-label="Priority" sx={{ py: 0 }}>
          {PRIORITY_ITEMS.map((item) => {
            const selected = item.value === value;
            return (
              <ListItemButton
                key={item.value}
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  onChange(item.value);
                  onOpenChange(false);
                }}
              >
                <ListItemIcon sx={{ minWidth: 32 }}>
                  <Flag sx={{ fontSize: 20, color: item.color }} aria-hidden />
                </ListItemIcon>
                <ListItemText
                  primary={item.label}
                  slotProps={{
                    primary: { noWrap: true, sx: { color: selected ? 'primary.main' : 'text.primary' } },
                  }}
                />
                {selected ? <Check sx={{ fontSize: 20, color: 'primary.main' }} aria-hidden /> : null}
              </ListItemButton>
            );
          })}
        </List>
      </Box>
    </Drawer>
  );
}
