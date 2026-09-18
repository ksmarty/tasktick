/**
 * The grouped settings card.
 *
 * The backbone of the whole settings area. Every screen is a stack of these, so
 * the surface, the caption, the footnote and — most importantly — the row rhythm
 * are defined here once instead of being repeated by hand and drifting. The
 * previous MUI version had a `Paper` whose rows each carried their own `sx`
 * padding: the block rows asked for 16/12, the plain rows got MUI's 16/8, and a
 * third kind got whatever the screen author felt like. Nothing was wrong on its
 * own, which is exactly how drift accumulates.
 *
 * So the padding of a row is now a single exported constant, `SETTINGS_ROW_CLASS`,
 * and every row in the area is a `SettingsRow` (or an anchor that reuses the
 * constant, in the case of a row that is itself a link). Rows within one card are
 * separated by `divide-y`, which draws a hairline *between* children and never
 * after the last one, and — because it is a direct-child selector — never inside
 * a nested list that a row happens to contain.
 *
 * The card is a plain `div` rather than shadcn's `Card`: a settings card holds
 * rows, links, forms, tables and multi-line account blocks indiscriminately, and
 * the divider rhythm above is the whole reason this component exists, so it is
 * not a `Card` with extra props bolted on.
 */
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The padding every row in a settings card shares — stated once, here.
 *
 * `px-row` is the row's inner gutter (the four layout tokens are defined in
 * `globals.css`); `py-3` is Tailwind's own scale. A row that needs a different
 * vertical rhythm is a row whose content wants its own padding, and in that case
 * it should say so explicitly rather than fork this default.
 */
export const SETTINGS_ROW_CLASS = 'px-row py-3';

export interface SettingsGroupProps {
  /** Caption above the card, e.g. `Calendars`. */
  title: ReactNode;
  /** Trailing control in the caption row, e.g. an “Add” button. */
  action?: ReactNode;
  /** Footnote below the card — the place for the explanation. */
  footer?: ReactNode;
  /** Removes the caption (for a card that speaks for itself). */
  hideTitle?: boolean;
  children: ReactNode;
}

export function SettingsGroup({ title, action, footer, hideTitle = false, children }: SettingsGroupProps) {
  return (
    /*
     * A group is `title / card / footnote`, and the gap between those three is
     * the same `gap-stack` token the space *between* groups uses. That is the
     * whole point: a screen is one column of these, so the vertical rhythm is
     * stated in one place instead of by a different `mb-*` on every card. The
     * page (or tab panel) supplies `gap-stack` between siblings; this supplies
     * it within the group, so a group never touches its own footnote and the
     * card never depends on the caller remembering to add margin.
     */
    <section className="flex flex-col gap-stack">
      <div className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xs">
        {hideTitle ? null : (
          /*
           * The caption is its own band, closed by a hairline: it is what makes
           * two stacked cards read as two sections rather than one continuous
           * block, and it lines the caption up with the rows below it because
           * both use `px-row`. The `min-h-11` keeps the band a comfortable row
           * height whether or not there is an action button in it.
           */
          <div className="flex min-h-11 items-center gap-2 border-b border-border px-row py-2">
            <h2 className="min-w-0 flex-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              {title}
            </h2>
            {action}
          </div>
        )}

        {/* A hairline between this card's own rows, never after the last one, and
            never inside a nested list — the selector is direct-child only. */}
        <div className="divide-y divide-border">{children}</div>
      </div>

      {footer ? <p className="px-row text-xs leading-relaxed text-muted-foreground">{footer}</p> : null}
    </section>
  );
}

export interface SettingsRowProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Stacks the row's children vertically (a label above a full-width control)
   * instead of laying them out side by side.
   */
  stacked?: boolean;
}

/**
 * One row inside a {@link SettingsGroup}.
 *
 * A plain element, not a list item: the card is a `div`, so a `<ul>`/`<li>` pair
 * would be a lie — and the rows here are as often a link, a form or a table
 * container as they are a list entry.
 */
export function SettingsRow({ stacked = false, className, ...props }: SettingsRowProps) {
  return (
    <div
      className={cn(SETTINGS_ROW_CLASS, stacked ? 'flex flex-col gap-2' : 'flex items-center gap-3', className)}
      {...props}
    />
  );
}
