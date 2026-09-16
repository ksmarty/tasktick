import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface SectionHeaderProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  /** Caption text, e.g. "Today" or "Lists". */
  title: ReactNode;
  /** Trailing action, e.g. a plain `Button` saying "Edit". */
  action?: ReactNode;
  /**
   * Uppercase caption styling for grouped lists. Defaults to false.
   *
   * Sentence case is the default because uppercase micro-caps read as a web
   * dashboard, not as iOS: Apple uses sentence-case captions in grouped lists,
   * and the wide letter-spacing that makes caps legible also makes a long label
   * like "URGENT AND IMPORTANT" shout. Opt in explicitly where a caps caption
   * genuinely helps.
   */
  caption?: boolean;
}

/**
 * The caption that introduces a section or a grouped list. Not interactive —
 * any action is passed in as a node, so this stays a server component.
 */
export function SectionHeader({ title, action, caption = false, className, children, ...rest }: SectionHeaderProps) {
  return (
    <div className={cn('flex items-end justify-between gap-2 px-4 pt-5 pb-1.5', className)} {...rest}>
      <h2
        className={cn(
          'min-w-0 truncate text-footnote font-semibold text-secondary',
          caption && 'uppercase tracking-wide',
        )}
      >
        {title}
      </h2>
      {action ? <div className="shrink-0">{action}</div> : null}
      {children}
    </div>
  );
}
