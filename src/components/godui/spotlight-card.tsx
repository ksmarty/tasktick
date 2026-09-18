'use client';

/**
 * GodUI — Spotlight Card.
 *
 * Source as published by the `@godui/spotlight-card` registry entry. Kept in
 * `components/godui` rather than imported from a package because that is how the
 * registry ships: the source is copied into the project so it can be edited,
 * which is what makes the local changes possible.
 *
 * Local changes:
 *  1. `cn()` is imported from `@/lib/utils` and used for every class list instead
 *     of string concatenation, so a caller's `className` merges with correct
 *     Tailwind conflict resolution.
 *  2. `z-raised` → `z-10`. The registry's own theme defines a `z-raised` step;
 *     this project's `globals.css` defines `base | sticky | appbar | modal |
 *     toast` (and those are the only names GodUI's overlays need), so the
 *     upstream class would silently compile to nothing and the content layer
 *     would lose its stacking context.
 *  3. Quote style normalized to the repo's single quotes.
 *
 * `--x` / `--y` are written inline on purpose: a pointer-tracked position is
 * exactly the case the conventions allow inline `style` for. They are not
 * spacing values, so the spacing checker does not (and should not) flag them.
 *
 * Used for the matrix's four quadrant cards.
 */
import * as React from 'react';
import { cn } from '@/lib/utils';

export type SpotlightCardProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Color of the spotlight glow. Accepts any CSS color. */
  glowColor?: string;
  /** Radius of the spotlight in pixels. */
  radius?: number;
  /** Also light up the card border as the pointer moves. */
  border?: boolean;
};

const ROOT_BASE =
  'group relative overflow-hidden rounded-xl border border-border bg-card text-card-foreground';

// Radial glow that follows the pointer. `--x` / `--y` are written on pointer move;
// they default to the center so the very first paint isn't a hard corner flash.
const GLOW_BASE =
  'pointer-events-none absolute inset-0 opacity-0 [transition:opacity_400ms_ease] group-hover:opacity-100 motion-reduce:[transition:none] [background:radial-gradient(var(--spotlight-radius)_circle_at_var(--x,50%)_var(--y,50%),var(--spotlight-color),transparent_65%)]';

// Border highlight: the same gradient masked to the 1px ring only.
const BORDER_BASE =
  'pointer-events-none absolute inset-0 rounded-xl opacity-0 [transition:opacity_400ms_ease] group-hover:opacity-100 motion-reduce:[transition:none] [background:radial-gradient(var(--spotlight-radius)_circle_at_var(--x,50%)_var(--y,50%),var(--spotlight-color),transparent_65%)] [-webkit-mask:linear-gradient(#fff_0_0)_content-box,linear-gradient(#fff_0_0)] [-webkit-mask-composite:xor] [mask:linear-gradient(#fff_0_0)_content-box,linear-gradient(#fff_0_0)] [mask-composite:exclude] p-px';

const SpotlightCard = React.forwardRef<HTMLDivElement, SpotlightCardProps>(
  (
    {
      glowColor = 'color-mix(in oklch, var(--primary) 40%, transparent)',
      radius = 350,
      border = true,
      className,
      style,
      children,
      onPointerMove,
      ...props
    },
    forwardedRef,
  ) => {
    const ref = React.useRef<HTMLDivElement>(null);
    React.useImperativeHandle(
      forwardedRef,
      () => ref.current as HTMLDivElement,
    );

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      const el = ref.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        el.style.setProperty('--x', `${e.clientX - rect.left}px`);
        el.style.setProperty('--y', `${e.clientY - rect.top}px`);
      }
      onPointerMove?.(e);
    };

    return (
      <div
        ref={ref}
        data-slot="spotlight-card"
        onPointerMove={handlePointerMove}
        className={cn(ROOT_BASE, className)}
        style={{
          ['--spotlight-color' as string]: glowColor,
          ['--spotlight-radius' as string]: `${radius}px`,
          ...style,
        }}
        {...props}
      >
        <div aria-hidden className={GLOW_BASE} />
        {border ? <div aria-hidden className={BORDER_BASE} /> : null}
        <div className="relative z-10">{children}</div>
      </div>
    );
  },
);
SpotlightCard.displayName = 'SpotlightCard';

export { SpotlightCard };
