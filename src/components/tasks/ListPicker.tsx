'use client';

/**
 * List picker: the user's projects, plus "No list" for tasks that belong only to
 * the inbox.
 */
import Box from '@mui/material/Box';
import Check from '@mui/icons-material/Check';
import Drawer from '@mui/material/Drawer';
import Inbox from '@mui/icons-material/Inbox';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import { accentHex } from '@/lib/colors';
import type { List as TaskList } from '@/lib/types';

export interface ListPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lists: readonly TaskList[];
  value: string | null;
  onChange: (listId: string | null) => void;
  /** Offers a "No list" row. Off for the bulk "Move to" action. */
  allowNone?: boolean;
  title?: string;
}

export function ListPicker({
  open,
  onOpenChange,
  lists,
  value,
  onChange,
  allowNone = true,
  title = 'List',
}: ListPickerProps) {
  function choose(listId: string | null) {
    onChange(listId);
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

        <List role="radiogroup" aria-label={title} sx={{ py: 0 }}>
          {allowNone ? (
            <ListItemButton role="radio" aria-checked={value === null} onClick={() => choose(null)}>
              <ListItemIcon sx={{ minWidth: 32 }}>
                <Inbox sx={{ fontSize: 20, color: 'text.secondary' }} aria-hidden />
              </ListItemIcon>
              <ListItemText
                primary="No list"
                slotProps={{
                  primary: {
                    noWrap: true,
                    sx: { color: value === null ? 'primary.main' : 'text.primary' },
                  },
                }}
              />
              {value === null ? <Check sx={{ fontSize: 20, color: 'primary.main' }} aria-hidden /> : null}
            </ListItemButton>
          ) : null}

          {lists.map((list) => {
            const selected = list.id === value;
            return (
              <ListItemButton
                key={list.id}
                role="radio"
                aria-checked={selected}
                onClick={() => choose(list.id)}
              >
                <ListItemIcon sx={{ minWidth: 32 }}>
                  {list.emoji ? (
                    <Box component="span" aria-hidden sx={{ display: 'flex', alignItems: 'center' }}>
                      {list.emoji}
                    </Box>
                  ) : (
                    <Box
                      aria-hidden
                      sx={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        flexShrink: 0,
                        bgcolor: accentHex(list.color),
                      }}
                    />
                  )}
                </ListItemIcon>
                <ListItemText
                  primary={list.name}
                  slotProps={{
                    primary: { noWrap: true, sx: { color: selected ? 'primary.main' : 'text.primary' } },
                  }}
                />
                {selected ? <Check sx={{ fontSize: 20, color: 'primary.main' }} aria-hidden /> : null}
              </ListItemButton>
            );
          })}
        </List>

        {lists.length === 0 ? (
          <Typography variant="caption" sx={{ display: 'block', px: 2, pt: 1.5, color: 'text.secondary' }}>
            You have no lists yet.
          </Typography>
        ) : null}
      </Box>
    </Drawer>
  );
}
