'use client';

/**
 * The subtask list inside the editor sheet.
 *
 * Renaming is a bare input committed on blur or Enter (so a half-typed name is
 * never sent), and adding is a row that becomes an input on tap — the same
 * gesture as the inline quick-add.
 */
import { useState } from 'react';
import Add from '@mui/icons-material/Add';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Delete from '@mui/icons-material/Delete';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SubTask } from '@/lib/types';

export interface SubTaskListProps {
  subtasks: readonly SubTask[];
  onToggle: (subtask: SubTask) => void;
  onRename: (subtask: SubTask, title: string) => void;
  onDelete: (subtask: SubTask) => void;
  onAdd: (title: string) => void | Promise<void>;
  disabled?: boolean;
}

export function SubTaskList({
  subtasks,
  onToggle,
  onRename,
  onDelete,
  onAdd,
  disabled = false,
}: SubTaskListProps) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const done = subtasks.filter((subtask) => subtask.status === 'completed').length;

  async function commitNew() {
    const title = draft.trim();
    if (!title) {
      setAdding(false);
      return;
    }
    setDraft('');
    await onAdd(title);
  }

  return (
    <Box>
      {subtasks.length ? (
        <List sx={{ py: 0, bgcolor: 'background.paper', borderRadius: 1.5 }}>
          {subtasks.map((subtask) => {
            const completed = subtask.status === 'completed';
            return (
              <ListItem key={subtask.id} sx={{ gap: 1, pr: 0.5, pl: 1 }}>
                <Checkbox
                  checked={completed}
                  disabled={disabled}
                  onChange={() => onToggle(subtask)}
                  slotProps={{
                    input: {
                      'aria-label': completed ? `Mark ${subtask.title} incomplete` : `Complete ${subtask.title}`,
                      'aria-checked': completed,
                    },
                  }}
                />

                <TextField
                  variant="standard"
                  defaultValue={subtask.title}
                  disabled={disabled}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }}
                  onBlur={(event) => {
                    const next = event.target.value.trim();
                    if (next && next !== subtask.title) onRename(subtask, next);
                    else event.target.value = subtask.title;
                  }}
                  slotProps={{
                    input: { disableUnderline: true },
                    htmlInput: { 'aria-label': `Rename ${subtask.title}` },
                  }}
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    '& input': {
                      color: completed ? 'text.secondary' : 'text.primary',
                      textDecoration: completed ? 'line-through' : 'none',
                    },
                  }}
                />

                <IconButton
                  aria-label={`Delete subtask ${subtask.title}`}
                  color="error"
                  size="small"
                  disabled={disabled}
                  onClick={() => onDelete(subtask)}
                >
                  <Delete sx={{ fontSize: 20 }} />
                </IconButton>
              </ListItem>
            );
          })}
        </List>
      ) : null}

      {adding ? (
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', mt: 1, px: 2, minHeight: 48 }}
        >
          <Add sx={{ fontSize: 20, color: 'text.secondary' }} aria-hidden />
          <TextField
            variant="standard"
            autoFocus
            value={draft}
            disabled={disabled}
            placeholder="Subtask"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void commitNew();
              }
              if (event.key === 'Escape') {
                setDraft('');
                setAdding(false);
              }
            }}
            onBlur={() => void commitNew()}
            slotProps={{
              input: { disableUnderline: true },
              htmlInput: { 'aria-label': 'New subtask' },
            }}
            sx={{ flex: 1, minWidth: 0 }}
          />
        </Stack>
      ) : (
        <Button
          fullWidth
          disabled={disabled}
          onClick={() => setAdding(true)}
          startIcon={<Add sx={{ fontSize: 20 }} />}
          sx={{
            justifyContent: 'flex-start',
            mt: subtasks.length ? 1 : 0,
            px: 2,
            minHeight: 48,
            color: 'primary.main',
          }}
        >
          Add subtask
          {subtasks.length ? (
            <Typography variant="caption" sx={{ ml: 'auto', color: 'text.secondary' }}>
              {done}/{subtasks.length} done
            </Typography>
          ) : null}
        </Button>
      )}
    </Box>
  );
}
