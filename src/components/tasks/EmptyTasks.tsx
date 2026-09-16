'use client';

/**
 * The "nothing to do" panel, shared by the Today screen and the task list so the
 * empty state always offers the one action that fills it.
 */
import { CircleCheckBig, Plus } from 'lucide-react';
import { Button, EmptyState } from '@/components/ui';

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
    <EmptyState
      icon={CircleCheckBig}
      title={title}
      description={description}
      action={
        <Button icon={Plus} onClick={onAdd}>
          Add a task
        </Button>
      }
    />
  );
}
