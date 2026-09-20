'use client';

/**
 * GodUI — Tab Bar.
 *
 * Source as published by the `@godui/tab-bar` registry entry (`godui_get_component`),
 * with a small, explicit list of local changes noted below. Kept in
 * `components/godui` rather than imported from a package because that is how the
 * registry ships: the source is copied into the project so it can be edited,
 * which is what makes the local changes possible.
 *
 * Local changes — keep this list complete, a future re-vendor reads it:
 *  1. `cn()` is imported from `@/lib/utils` instead of being inlined, so the
 *     caller's `className` merges correctly against the component's own classes
 *     (Tailwind conflict resolution rather than string concatenation).
 *  2. `icon` is typed `React.ReactNode` — the app's icons come from two sets.
 *  3. The icon-to-label gap is `gap-1.5` (6px) rather than `gap-2` (8px). The
 *     selected tab is the only one that shows a label, and the icon sits between
 *     that label and the pill's leading edge, so the gap reads as extra space to
 *     the left of the word. The pill's own padding is symmetric (`px-4` both
 *     sides) and was measured as such — this tightens the one thing that is
 *     actually to the left of the text.
 *  4. Reduced motion is read from the app-level `@/lib/motion` hook rather than
 *     `framer-motion` directly, so the in-app preference is honoured too.
 *  5. `backdrop-blur-md` rather than upstream's `backdrop-blur-xl`. The bar is
 *     fixed over content that re-renders and fades during a tab switch, so the
 *     backdrop filter re-samples a changing backdrop every frame; halving the
 *     blur radius is the cheapest change that costs nothing visually at 80%
 *     background opacity.
 *  6. `will-change-transform` on the sliding blob, which upstream leaves off.
 *     The blob is projected with a transform, so the hint keeps it on its own
 *     compositor layer for the duration of the slide.
 *
 * The label's `layout` prop is NOT a local change: upstream has it, and it is
 * what keeps the reveal off the layout path. A previous local edit removed it in
 * favour of tweening `width`, which animates a layout property on every frame
 * and drags the blob's projection along with it (the whole button resizes as the
 * label grows). It is back to upstream's shape deliberately — see the `motion.span`
 * below.
 */
import { motion } from 'framer-motion';
import * as React from 'react';
import { useReducedMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

export type TabBarTab = {
  value: string;
  label: string;
  icon: React.ReactNode;
  badge?: React.ReactNode;
};

export type TabBarProps = Omit<
  React.HTMLAttributes<HTMLElement>,
  'onChange' | 'defaultValue'
> & {
  tabs: TabBarTab[];
  value?: string;
  defaultValue?: string;
  /** Reveal the label only on the active tab. */
  labelsOnActiveOnly?: boolean;
  /** Add bottom safe-area padding (for mobile home indicators). */
  safeArea?: boolean;
  onChange?: (value: string) => void;
};

let tabBarSeed = 0;

const TabBar = React.forwardRef<HTMLElement, TabBarProps>(
  (
    {
      tabs,
      value: valueProp,
      defaultValue,
      labelsOnActiveOnly = true,
      safeArea = false,
      onChange,
      className,
      ...props
    },
    ref,
  ) => {
    const reduceMotion = useReducedMotion();
    const blobId = React.useMemo(() => `tab-bar-blob-${tabBarSeed++}`, []);
    const isControlled = valueProp !== undefined;
    const [internal, setInternal] = React.useState(
      () => defaultValue ?? tabs[0]?.value,
    );
    const value = isControlled ? valueProp : internal;

    const select = (next: string) => {
      if (!isControlled) setInternal(next);
      onChange?.(next);
    };

    const spring = reduceMotion
      ? { duration: 0 }
      : ({ type: 'spring', stiffness: 520, damping: 32 } as const);

    return (
      <nav
        ref={ref}
        aria-label="Bottom navigation"
        className={cn(
          /*
           * `backdrop-blur-md`, not `xl` — see local change 5.
           */
          'inline-flex items-center gap-1 rounded-full border border-border bg-background/80 p-1.5 shadow-lg backdrop-blur-md',
          safeArea && 'pb-[max(0.375rem,env(safe-area-inset-bottom))]',
          className,
        )}
        {...props}
      >
        {tabs.map((tab) => {
          const active = tab.value === value;
          return (
            <button
              key={tab.value}
              type="button"
              aria-label={tab.label}
              aria-current={active ? 'page' : undefined}
              onClick={() => select(tab.value)}
              className={cn(
                'relative inline-flex h-11 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {active && (
                <motion.span
                  layoutId={blobId}
                  transition={spring}
                  className="absolute inset-0 rounded-full bg-primary shadow-sm will-change-transform"
                />
              )}
              <motion.span
                className="relative flex h-5 w-5 items-center justify-center"
                animate={
                  reduceMotion || !active
                    ? { scale: 1 }
                    : { scale: [1, 1.18, 1] }
                }
                transition={{ duration: 0.3, ease: 'easeOut' }}
              >
                {tab.icon}
                {tab.badge !== undefined && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white ring-2 ring-background">
                    {tab.badge}
                  </span>
                )}
              </motion.span>
              {(!labelsOnActiveOnly || active) && (
                <motion.span
                  /*
                    * `layout`, as upstream ships it — restored deliberately.
                    *
                    * A previous local edit removed this and tweened `width`
                    * instead, on the theory that it was "the same result for
                    * less work". It is the opposite: `width` is a layout
                    * property, so the tween re-laid-out the label (and its
                    * button, and the blob sized `inset-0` inside it) on every
                    * frame of the spring. Framer's projection then re-measured a
                    * box that was moving every frame, and the tab switch spent its
                    * budget in layout instead of on the compositor. `layout` does
                    * one measurement and projects the change as a transform.
                    *
                    * The `width` target stays, because that is what tells framer
                    * the box the label should settle at.
                    */
                  layout
                  initial={
                    labelsOnActiveOnly && !reduceMotion
                      ? { opacity: 0, width: 0 }
                      : false
                  }
                  animate={{ opacity: 1, width: 'auto' }}
                  transition={spring}
                  className="relative overflow-hidden whitespace-nowrap"
                >
                  {tab.label}
                </motion.span>
              )}
            </button>
          );
        })}
      </nav>
    );
  },
);
TabBar.displayName = 'TabBar';

export { TabBar };
