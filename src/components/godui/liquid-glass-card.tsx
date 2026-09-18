'use client';

/**
 * GodUI — Liquid Glass Card.
 *
 * The glass panel the `@godui/liquid-glass-card` registry entry publishes: a
 * frosted surface that refracts what is behind it, with a specular highlight
 * that tracks the pointer. Copied in as source so it can be edited, per
 * `GODUI-CONVENTIONS.md`.
 *
 * Local changes:
 *  1. `cn()` is imported from `@/lib/utils` and used for the root class list, so
 *     a caller's `className` merges with correct Tailwind conflict resolution
 *     (this is what lets a caller replace the published `border-white/20` with
 *     the theme's own `border-border`).
 *  2. `z-raised` → `z-10` for the content layer. This project's `globals.css`
 *     defines `base | sticky | appbar | modal | toast`; upstream's `z-raised`
 *     would silently compile to nothing and the content would lose its stacking
 *     context. (`spotlight-card.tsx` carries the same correction.)
 *  3. Refraction is skipped when `strength <= 0`. On a flat page background the
 *     displacement has nothing to bend, so running the SVG filter would be pure
 *     GPU cost for no visible effect; a caller can now ask for the glass tint,
 *     frost and sheen alone.
 *  4. Quote style normalized to the repo's single quotes.
 *
 * `--lg-x` / `--lg-y` are written inline on purpose: a pointer-tracked position
 * is exactly the case the conventions allow inline `style` for, and they are not
 * spacing values.
 */
import * as React from 'react';
import { cn } from '@/lib/utils';
import {
  buildDisplacementMap,
  mergeRefs,
  RefractionFilter,
  useRefractionSupport,
} from './liquid-glass-utils';

export type LiquidGlassCardProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Corner radius in px. */
  radius?: number;
  /** Frost (backdrop blur) in px. */
  blur?: number;
  /** Refraction displacement scale in px — how hard the edges bend. */
  strength?: number;
  /** Chromatic aberration amount, `0`–`1`. Splits the R/G/B refraction. */
  dispersion?: number;
  /** Backdrop saturation multiplier. */
  saturation?: number;
  /** Glass tint color. Defaults to a subtle translucent white. */
  tint?: string;
  /** Specular highlight intensity, `0`–`1`. */
  sheen?: number;
};

const LiquidGlassCard = React.forwardRef<HTMLDivElement, LiquidGlassCardProps>(
  (
    {
      children,
      className,
      style,
      radius = 28,
      blur = 2,
      strength = 60,
      dispersion = 0.15,
      saturation = 1.6,
      tint,
      sheen = 0.5,
      onPointerMove,
      onPointerEnter,
      onPointerLeave,
      ...props
    },
    ref,
  ) => {
    const rootRef = React.useRef<HTMLDivElement>(null);
    const filterId = `lgc-${React.useId().replace(/:/g, '')}`;
    const [size, setSize] = React.useState({ width: 0, height: 0 });
    const [hovering, setHovering] = React.useState(false);
    const refract = useRefractionSupport();

    React.useEffect(() => {
      const node = rootRef.current;
      if (!node) return;
      const observer = new ResizeObserver(([entry]) => {
        const { width, height } = entry.contentRect;
        setSize({ width: Math.round(width), height: Math.round(height) });
      });
      observer.observe(node);
      return () => observer.disconnect();
    }, []);

    const map = React.useMemo(
      () =>
        strength > 0 && size.width > 0 && size.height > 0
          ? buildDisplacementMap(size.width, size.height, 0.3)
          : null,
      [strength, size.width, size.height],
    );

    const active = refract && map !== null;
    const backdrop = active
      ? `blur(${blur}px) saturate(${saturation}) url(#${filterId})`
      : `blur(${blur}px) saturate(${saturation})`;

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      const node = rootRef.current;
      if (node && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const rect = node.getBoundingClientRect();
        node.style.setProperty('--lg-x', `${((e.clientX - rect.left) / rect.width) * 100}%`);
        node.style.setProperty('--lg-y', `${((e.clientY - rect.top) / rect.height) * 100}%`);
      }
      onPointerMove?.(e);
    };
    const handlePointerEnter = (e: React.PointerEvent<HTMLDivElement>) => {
      setHovering(true);
      onPointerEnter?.(e);
    };
    const handlePointerLeave = (e: React.PointerEvent<HTMLDivElement>) => {
      setHovering(false);
      onPointerLeave?.(e);
    };

    return (
      <div
        ref={mergeRefs(rootRef, ref)}
        data-slot="liquid-glass-card"
        onPointerMove={handlePointerMove}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        className={cn(
          'group relative isolate overflow-hidden border border-white/20 shadow-lg',
          className,
        )}
        style={
          {
            borderRadius: `${radius}px`,
            backgroundColor: tint ?? 'rgba(255,255,255,0.08)',
            '--lg-x': '50%',
            '--lg-y': '50%',
            ...style,
          } as React.CSSProperties
        }
        {...props}
      >
        {/* Refraction / frost layer — samples the live DOM behind the card. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[inherit]"
          style={{
            backdropFilter: backdrop,
            WebkitBackdropFilter: `blur(${blur}px) saturate(${saturation})`,
          }}
        />

        {/* Specular highlight — radial glow that tracks the pointer and fades
            out on leave. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[inherit] mix-blend-screen transition-opacity duration-200 motion-reduce:hidden"
          style={{
            opacity: hovering ? 1 : 0,
            background: `radial-gradient(circle at var(--lg-x) var(--lg-y), rgba(255,255,255,${sheen}) 0%, rgba(255,255,255,0) 45%)`,
          }}
        />
        {/* Static edge sheen for the wet-glass rim. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[inherit]"
          style={{
            boxShadow: `inset 0 1px 0 0 rgba(255,255,255,${0.5 * sheen}), inset 0 -1px 1px 0 rgba(0,0,0,0.15)`,
          }}
        />

        {active && map && (
          <svg aria-hidden="true" className="absolute size-0">
            <RefractionFilter id={filterId} map={map} strength={strength} dispersion={dispersion} />
          </svg>
        )}

        <div className="relative z-10">{children}</div>
      </div>
    );
  },
);
LiquidGlassCard.displayName = 'LiquidGlassCard';

export { LiquidGlassCard };
