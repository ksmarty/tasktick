import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface SectionHeaderProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  /** Caption text, e.g. "Today" or "Lists". */
  title: ReactNode;
  /** Trailing action, e.g. a plain `Button` saying "Edit". */
  action?: ReactNode;
  /** Uppercase caption styling for grouped lists. Default true. */
  caption?: boolean;
}

/**
 * The caption that introduces a section or a grouped list. Not interactive —
 * any action is passed in as a node, so this stays a server component.
 */
export function SectionHeader({ title, action, caption = true, className, children, ...rest }: SectionHeaderProps) {
  return (
    <div className={cn('flex items-end justify-between gap-2 px-4 pt-6 pb-2', className)} {...rest}>
      <h2
        className={cn(
          'min-w-0 truncate text-footnote text-secondary',
          caption && 'font-medium uppercase tracking-wide',
        )}
      >
        {title}
      </h2>
      {action ? <div className="shrink-0">{action}</div> : null}
      {children}
    </div>
  );
}
