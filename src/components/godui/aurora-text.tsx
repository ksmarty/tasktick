'use client';

/**
 * GodUI — Aurora Text.
 *
 * Source as published by the `@godui/aurora-text` registry entry, with the local
 * changes noted below. Kept in `components/godui` rather than imported from a
 * package because that is how the registry ships: the source is copied into the
 * project so it can be edited, which is what makes the local changes possible.
 *
 * Local changes:
 *  1. `cn()` is imported from `@/lib/utils` instead of being inlined, so the
 *     caller's `className` merges correctly against the component's own classes.
 *  2. The drift is driven by `framer-motion` rather than the registry's
 *     `animate-aurora-text` utility. That utility ships as an `@theme` entry
 *     (`--animate-aurora-text`) plus a global `@keyframes aurora-text` block,
 *     i.e. a `globals.css` edit — and `globals.css` is shared and owned
 *     elsewhere. The published behaviour is reproduced exactly: a
 *     `10 / speed` second linear, infinite cycle (`0% 50%` → `100% 50%` →
 *     `0% 50%`) — and it now honours `prefers-reduced-motion` on its own
 *     instead of relying on the global reduce rule.
 *  3. The off-screen pause keeps the published IntersectionObserver and its
 *     `128px` rootMargin, but records visibility in state, because with a
 *     `framer-motion` animation there is no CSS `animation-play-state` to write.
 *  4. Quote style normalized to the repo's single quotes.
 *  5. Reduced motion is read from the app-level `@/lib/motion` hook rather than
 *     `framer-motion` directly, so the in-app preference is honoured too.
 *
 * The public API (`AuroraTextProps`, the forwarded ref, `data-slot`) is
 * unchanged.
 */
import { motion } from 'framer-motion';
import * as React from 'react';
import { useReducedMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

export type AuroraTextProps = React.HTMLAttributes<HTMLSpanElement> & {
  children: React.ReactNode;
  /** Gradient stops the aurora cycles through. Defaults to a rainbow spectrum. */
  colors?: string[];
  /** Speed multiplier — `1` ≈ 10s per cycle, higher is faster. */
  speed?: number;
};

// Full-spectrum rainbow, looped back to the first stop for a seamless cycle.
const RAINBOW_COLORS = [
  '#ff2d55',
  '#ff9500',
  '#ffd60a',
  '#34c759',
  '#00c7be',
  '#0a84ff',
  '#5e5ce6',
  '#bf5af2',
];

const AuroraText = React.forwardRef<HTMLSpanElement, AuroraTextProps>(
  (
    {
      children,
      className,
      colors = RAINBOW_COLORS,
      speed = 1,
      style,
      ...props
    },
    ref,
  ) => {
    const stops = [...colors, colors[0]].join(', ');
    const reduceMotion = useReducedMotion();

    // The gradient runs on an infinite background-position cycle (main-thread
    // paint). Pause it whenever the text is off screen so it costs nothing while
    // idle — resumes on scroll-in.
    const gradientRef = React.useRef<HTMLSpanElement>(null);
    const [inView, setInView] = React.useState(true);
    React.useEffect(() => {
      const el = gradientRef.current;
      if (!el || typeof IntersectionObserver === 'undefined') return;
      const io = new IntersectionObserver(
        ([entry]) => setInView(entry.isIntersecting),
        { rootMargin: '128px' },
      );
      io.observe(el);
      return () => io.disconnect();
    }, []);

    const drifting = inView && !reduceMotion;

    return (
      <span
        ref={ref}
        data-slot="aurora-text"
        className={cn('relative inline-block', className)}
        {...props}
      >
        <span className="sr-only">{children}</span>
        <motion.span
          ref={gradientRef}
          aria-hidden="true"
          className="bg-clip-text text-transparent"
          style={{
            backgroundImage: `linear-gradient(135deg, ${stops})`,
            backgroundSize: '200% auto',
            ...style,
          }}
          animate={
            drifting
              ? { backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] }
              : undefined
          }
          transition={
            drifting
              ? { duration: 10 / speed, ease: 'linear', repeat: Infinity }
              : undefined
          }
        >
          {children}
        </motion.span>
      </span>
    );
  },
);
AuroraText.displayName = 'AuroraText';

export { AuroraText };
