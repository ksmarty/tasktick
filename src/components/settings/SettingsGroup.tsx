/**
 * The grouped settings card.
 *
 * `ListGroup` is the primitive; this adds the caption above it and the footnote
 * below, which every settings screen needs and which is easy to get subtly wrong
 * (spacing, insets) when repeated by hand.
 */
import type { ReactNode } from 'react';
import { ListGroup, SectionHeader } from '@/components/ui';
import { cn } from '@/lib/cn';

export interface SettingsGroupProps {
  /** Caption above the card, e.g. `Calendars`. */
  title: ReactNode;
  /** Trailing control in the caption row, e.g. an “Add” button. */
  action?: ReactNode;
  /** Footnote below the card — the place for the explanation. */
  footer?: ReactNode;
  /** Removes the caption (for a card that speaks for itself). */
  hideTitle?: boolean;
  className?: string;
  children: ReactNode;
}

export function SettingsGroup({ title, action, footer, hideTitle = false, className, children }: SettingsGroupProps) {
  return (
    <section className={cn(className)}>
      {hideTitle ? null : <SectionHeader title={title} action={action} />}
      <ListGroup>{children}</ListGroup>
      {footer ? <p className="px-4 pt-2 text-footnote text-secondary">{footer}</p> : null}
    </section>
  );
}
