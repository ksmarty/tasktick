'use client';

import {
  Children,
  createContext,
  useContext,
  type ComponentPropsWithoutRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Tells a `ListRow` whether it is the last row, so its hairline is dropped there. */
const LastRowContext = createContext(false);

export interface ListGroupProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  /** Small caption above the card, the grey `HEADER` of an iOS settings group. */
  header?: ReactNode;
  /** Footnote below the card — use it for the explanation of the group. */
  footer?: ReactNode;
  /**
   * Insets the card from the screen edge (16px, the iOS grouped-list margin).
   * Set `false` for edge-to-edge groups.
   */
  inset?: boolean;
  children?: ReactNode;
}

/**
 * The rounded grouped card: one white surface holding hairline-separated rows,
 * with optional caption above and footnote below.
 *
 * Rows are separated by a hairline inset to the text column, and the last row
 * has none — `ListRow` reads that from context, so there is never a trailing
 * separator under the card.
 */
export function ListGroup({ header, footer, inset = true, className, children, ...rest }: ListGroupProps) {
  const rows = Children.toArray(children);

  return (
    <div className={cn('w-full', className)} {...rest}>
      {header ? (
        <h3 className={cn('pb-2 text-footnote uppercase tracking-wide text-secondary', inset && 'px-4')}>{header}</h3>
      ) : null}
      <ul className={cn('grouped', inset && 'mx-4')}>
        {rows.map((row, index) => (
          <li key={index} className="contents">
            <LastRowContext.Provider value={index === rows.length - 1}>{row}</LastRowContext.Provider>
          </li>
        ))}
      </ul>
      {footer ? (
        <p className={cn('pt-2 text-footnote text-secondary', inset && 'px-4')}>{footer}</p>
      ) : null}
    </div>
  );
}

/**
 * Row props are typed against `HTMLElement`, not `HTMLDivElement`: one row can
 * become a `<div>`, a `<button>` or an `<a>`, and only the base element's
 * attribute set is valid in all three.
 */
export interface ListRowProps extends Omit<HTMLAttributes<HTMLElement>, 'onClick' | 'title' | 'children'> {
  /** Primary text. */
  title: ReactNode;
  /** Optional second line under the title. */
  subtitle?: ReactNode;
  /** Node before the text column: an icon, a checkbox, an avatar. */
  leading?: ReactNode;
  /** Node after the text column, before the chevron: a value, a switch, a date. */
  trailing?: ReactNode;
  /** Makes the row a real `<button>`. */
  onClick?: () => void;
  /** Makes the row a real `<a>` (routed through `next/link`). */
  href?: string;
  /** Shows the thin grey disclosure glyph. Defaults to `true` for `href` rows. */
  showChevron?: boolean;
  /** Renders the title in the danger colour. */
  destructive?: boolean;
  /** Non-interactive and dimmed, with `aria-disabled`. */
  disabled?: boolean;
  /** Count pill or short status text pinned to the trailing edge. */
  badge?: ReactNode;
  children?: ReactNode;
}

/**
 * One row of a grouped list — 44px tall so it is a legal touch target.
 *
 * A row becomes a `<button>` when `onClick` is given and an `<a>` when `href`
 * is; an informational row stays a plain `<div>` and is never announced as a
 * control. The separator is a pseudo-element inset to the text column so it
 * starts where the text does rather than at the card edge, and it is omitted on
 * the last row of its `ListGroup`.
 */
export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  onClick,
  href,
  showChevron,
  destructive = false,
  disabled = false,
  badge,
  className,
  children,
  ...rest
}: ListRowProps) {
  const isLast = useContext(LastRowContext);
  const chevron = showChevron ?? Boolean(href);
  const interactive = !disabled && (Boolean(href) || Boolean(onClick));

  const classes = cn(
    'relative flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left',
    // Hairline between rows, never after the last one.
    !isLast &&
      'after:pointer-events-none after:absolute after:bottom-0 after:right-0 after:h-px after:bg-separator',
    !isLast && (leading ? 'after:left-14' : 'after:left-4'),
    interactive && 'pressable-row',
    disabled && 'opacity-40',
    className,
  );

  const body = (
    <>
      {leading ? <span className="flex shrink-0 items-center text-tint">{leading}</span> : null}
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-body', destructive ? 'text-danger' : 'text-label')}>{title}</span>
        {subtitle ? <span className="mt-0.5 block truncate text-footnote text-secondary">{subtitle}</span> : null}
        {children}
      </span>
      {badge || trailing ? (
        <span className="flex shrink-0 items-center gap-2 text-secondary">
          {badge}
          {trailing}
        </span>
      ) : null}
      {chevron ? <ChevronRight className="size-4 shrink-0 text-tertiary" strokeWidth={2.5} aria-hidden /> : null}
    </>
  );

  if (href && !disabled) {
    return (
      <Link href={href} className={classes} {...rest}>
        {body}
      </Link>
    );
  }

  if (onClick && !disabled) {
    return (
      <button type="button" onClick={onClick} className={classes} {...rest}>
        {body}
      </button>
    );
  }

  return (
    <div aria-disabled={disabled || undefined} className={classes} {...rest}>
      {body}
    </div>
  );
}
