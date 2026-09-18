'use client';

/**
 * The "nothing to do" panel, shared by the Today screen and the task list so the
 * empty state always offers the one action that fills it.
 *
 * MUI `Stack` + `Typography` + `Button`; Material has no `EmptyState` primitive,
 * and a feature-local three-element stack is clearer than a shared abstraction
 * used by exactly two screens.
 */
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import TaskAltIcon from '@mui/icons-material/TaskAlt';

export interface EmptyTasksProps {
  onAdd: () => void;
  title?: string;
  description?: string;
}

export function EmptyTasks({
  onAdd,
  title = 'All clear',
  description = 'Nothing is due. Add a task now, or enjoy the quiet.',
}: EmptyTasksProps) {
  return (
    <Stack spacing={1.5} sx={{ alignItems: 'center', px: 4, py: 6, textAlign: 'center' }}>
      <Box sx={{ color: 'text.disabled', display: 'flex' }}>
        <TaskAltIcon sx={{ fontSize: 40 }} aria-hidden />
      </Box>
      <Typography variant="subtitle1" component="h2">
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {description}
      </Typography>
      <Button variant="contained" disableElevation startIcon={<AddIcon />} onClick={onAdd} sx={{ mt: 1 }}>
        Add a task
      </Button>
    </Stack>
  );
}
