'use client';

/**
 * Tag picker with inline creation.
 *
 * Creating a tag here is the same `POST /api/tags` the settings screen uses, so a
 * tag invented mid-edit is immediately a real tag everywhere else.
 */
import { useState } from 'react';
import Add from '@mui/icons-material/Add';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Check from '@mui/icons-material/Check';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Label from '@mui/icons-material/Label';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { Tag } from '@/lib/types';

export interface TagPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tags: readonly Tag[];
  /** Selected tag ids. */
  value: readonly string[];
  onChange: (tagIds: string[]) => void;
  /** Creates a tag and resolves to it, so the new one can be selected at once. */
  onCreate?: (name: string) => Promise<Tag | undefined>;
  disabled?: boolean;
  /** Heading; the bulk bar labels it "Add tag to N tasks". */
  title?: string;
}

export function TagPicker({
  open,
  onOpenChange,
  tags,
  value,
  onChange,
  onCreate,
  disabled = false,
  title = 'Tags',
}: TagPickerProps) {
  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);

  function toggle(tagId: string) {
    const next = value.includes(tagId) ? value.filter((id) => id !== tagId) : [...value, tagId];
    onChange(next);
  }

  async function create() {
    const name = draft.trim();
    if (!name || !onCreate || creating) return;
    setCreating(true);
    try {
      const created = await onCreate(name);
      if (created) onChange([...new Set([...value, created.id])]);
      setDraft('');
    } finally {
      setCreating(false);
    }
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

        {tags.length ? (
          <List sx={{ py: 0, mb: 2 }}>
            {tags.map((tag) => {
              const selected = value.includes(tag.id);
              return (
                <ListItemButton
                  key={tag.id}
                  role="checkbox"
                  aria-checked={selected}
                  onClick={() => toggle(tag.id)}
                >
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    <Label sx={{ fontSize: 20, color: 'text.secondary' }} aria-hidden />
                  </ListItemIcon>
                  <ListItemText
                    primary={tag.name}
                    slotProps={{
                      primary: { noWrap: true, sx: { color: selected ? 'primary.main' : 'text.primary' } },
                    }}
                  />
                  {selected ? <Check sx={{ fontSize: 20, color: 'primary.main' }} aria-hidden /> : null}
                </ListItemButton>
              );
            })}
          </List>
        ) : (
          <Typography variant="caption" sx={{ display: 'block', px: 2, pb: 2, color: 'text.secondary' }}>
            No tags yet — create the first one below.
          </Typography>
        )}

        {onCreate ? (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-end', px: 2 }}>
            <TextField
              label="New tag"
              value={draft}
              placeholder="Name"
              disabled={disabled || creating}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void create();
                }
              }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <Label sx={{ fontSize: 20 }} aria-hidden />
                    </InputAdornment>
                  ),
                },
              }}
              sx={{ flex: 1 }}
            />
            <IconButton
              aria-label="Create tag"
              color="primary"
              loading={creating}
              disabled={disabled || creating || !draft.trim()}
              onClick={() => void create()}
            >
              <Add sx={{ fontSize: 20 }} />
            </IconButton>
          </Stack>
        ) : null}

        <Box sx={{ pt: 2, px: 2 }}>
          <Button variant="contained" fullWidth onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </Box>
      </Box>
    </Drawer>
  );
}
