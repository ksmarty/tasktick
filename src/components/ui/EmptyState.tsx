import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface EmptyStateProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  /** Decorative glyph shown in the tinted disc. */
  icon?: LucideIcon;
  /** Short, action-oriented heading. */
  title: ReactNode;
  /** One sentence explaining what would fill this space. */
  description?: ReactNode;
  /** Primary call to action, typically a `Button`. */
  action?: ReactNode;
}

/** The centred "nothing here yet" panel for an empty list. */
export function EmptyState({ icon: Icon, title, description, action, className, children, ...rest }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)} {...rest}>
      {Icon ? (
        <span className="mb-4 flex size-14 items-center justify-center rounded-full bg-fill-tertiary text-tertiary">
          <Icon className="size-7" aria-hidden />
        </span>
      ) : null}
      <h2 className="text-headline font-semibold text-label">{title}</h2>
      {description ? <p className="mt-1.5 max-w-72 text-subhead text-secondary">{description}</p> : null}
      {children}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
