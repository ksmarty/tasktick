'use client';

/**
 * The "nothing to do" panel, shared by the Today screen and the task list so the
 * empty state always offers the one action that fills it.
 *
 * Three elements and a button. Material had no `EmptyState` primitive and neither
 * does shadcn, and a feature-local stack is clearer than a shared abstraction used
 * by exactly two screens.
 */
import { CheckCircledIcon } from '@svg-animated-icons/react/check-circled';
import { PlusIcon } from '@svg-animated-icons/react/plus';
import { Button } from '@/components/ui/button';

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
    <div className="flex flex-col items-center gap-3 px-gutter py-6 text-center">
      <span
        aria-hidden
        className="grid size-14 place-items-center rounded-full bg-muted text-muted-foreground"
      >
        <CheckCircledIcon className="text-2xl" />
      </span>
      <h2 className="text-base font-medium text-foreground">{title}</h2>
      <p className="max-w-72 text-sm text-muted-foreground">{description}</p>
      <Button type="button" className="mt-1" onClick={onAdd}>
        <PlusIcon className="text-base" aria-hidden />
        Add a task
      </Button>
    </div>
  );
}
