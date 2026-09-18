/**
 * GodUI — Decorative Background.
 *
 * Source as published by the `@godui/decorative-background` registry entry, with
 * one local change noted below. Kept in `components/godui` rather than imported
 * from a package because that is how the registry ships: the source is copied
 * into the project so it can be edited, which is what makes the local change
 * possible.
 *
 * Local changes:
 *  1. `cn()` is imported from `@/lib/utils` instead of being inlined, so the
 *     caller's `className` merges correctly against the component's own classes
 *     (Tailwind conflict resolution rather than string concatenation).
 *
 * The baked default gradient is left exactly as the registry publishes it. The
 * auth layout supplies its own through `style` — the component's documented
 * override path — so the app's colours live with the app, and this file stays
 * re-pullable.
 */
import * as React from 'react';
import { cn } from '@/lib/utils';

export type DecorativeBackgroundProps = React.HTMLAttributes<HTMLDivElement>;

// Background-defining keys. When the caller supplies any of these via `style`,
// they own the background and the baked default is dropped — merging a partial
// override with the default would mix CSS shorthand + longhand.
const BACKGROUND_KEYS = [
  'background',
  'backgroundColor',
  'backgroundImage',
  'backgroundSize',
  'backgroundPosition',
  'backgroundRepeat',
  'backgroundBlendMode',
] as const;

const baseStyle = {
  background: 'radial-gradient(125% 125% at 50% 10%, #fff 40%, #6366f1 100%)',
} as React.CSSProperties;

/**
 * Full-bleed background. Drop it as the first child of a `relative` container;
 * your content sits above it at `z-raised` or higher. Renders the baked pattern
 * by default; pass `style` to supply your own background.
 */
const DecorativeBackground = React.forwardRef<
  HTMLDivElement,
  DecorativeBackgroundProps
>(({ className, style, ...props }, ref) => {
  const ownsBackground =
    style != null && BACKGROUND_KEYS.some((key) => key in style);
  return (
    <div
      ref={ref}
      data-slot="decorative-background"
      aria-hidden="true"
      className={cn('absolute inset-0 z-base', className)}
      style={ownsBackground ? style : { ...baseStyle, ...style }}
      {...props}
    />
  );
});
DecorativeBackground.displayName = 'DecorativeBackground';

export { DecorativeBackground };
