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
import { LiquidGlassCard } from '@/components/godui/liquid-glass-card';
import { Button } from '@/components/ui/button';
import { GLASS_TINT } from './surface';

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
    /* The empty state is a GodUI glass panel, the same surface the sections use,
       so “nothing here” reads as part of the screen rather than a bare page. */
    <div className="px-gutter py-3">
      <LiquidGlassCard
        radius={16}
        strength={0}
        sheen={0.3}
        tint={GLASS_TINT}
        className="border-border shadow-sm"
      >
        <div className="flex flex-col items-center gap-3 px-card py-8 text-center">
          <span
            aria-hidden
            className="grid size-14 place-items-center rounded-full border border-border bg-background/60 text-muted-foreground"
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
      </LiquidGlassCard>
    </div>
  );
}
