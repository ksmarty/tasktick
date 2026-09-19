'use client';

/**
 * GodUI — Confetti.
 *
 * Source as published by the `@godui/confetti` registry entry. Kept in
 * `components/godui` rather than imported from a package because that is how
 * the registry ships: the source is copied into the project so it can be
 * edited, which is what makes the local changes possible.
 *
 * Local changes:
 *  1. `canvas-confetti` — a **new npm dependency** — is replaced by the
 *     self-contained canvas burst at the bottom of this file. The project may
 *     not add a dependency for a decorative effect, so the published API is
 *     unchanged (`Confetti` + `fire()`, `ConfettiButton`, `confetti()`) and only
 *     the physics backend differs. The burst honours
 *     `prefers-reduced-motion` itself, which upstream delegated to
 *     canvas-confetti's `disableForReducedMotion`.
 *  2. The default palette is the app's accent palette (`@/lib/colors`) rather
 *     than canvas-confetti's built-in colours, so a burst stays inside the
 *     palette the rest of the app is drawn from.
 *  3. `cn()` is imported from `@/lib/utils` and used for the trigger's class
 *     list, so a caller's `className` merges with correct Tailwind conflict
 *     resolution rather than being concatenated.
 *  4. Quote style normalized to the repo's single quotes.
 *  5. The reduced-motion check goes through the app-level `@/lib/motion` helper,
 *     so the in-app preference is honoured as well as the OS query.
 *
 * The canvas carries `z-toast`: `--z-index-toast` is defined in `globals.css`,
 * so the burst lands above the drawer and the dialog (`--z-index-modal`) that a
 * celebration is often fired from behind. GodUI's published theme does not ship
 * that token.
 */
import * as React from 'react';
import { accentHex } from '@/lib/colors';
import { appReducedMotionNow } from '@/lib/motion';
import { cn } from '@/lib/utils';
import type { AccentColor } from '@/lib/types';

export type ConfettiOrigin = {
  /** Horizontal origin, `0` (left edge) to `1` (right edge). Defaults to centre. */
  x?: number;
  /** Vertical origin, `0` (top edge) to `1` (bottom edge). Defaults to `0.7`. */
  y?: number;
};

export type ConfettiOptions = {
  particleCount?: number;
  /** Cone width in degrees. */
  spread?: number;
  startVelocity?: number;
  origin?: ConfettiOrigin;
  /** Overrides the default accent palette for this burst. */
  colors?: string[];
  /** Particle size multiplier. */
  scalar?: number;
  /** How long the burst lives, in animation frames. */
  ticks?: number;
  /** Downward acceleration multiplier. */
  gravity?: number;
  /** Skip the burst entirely when the user asks for reduced motion. */
  disableForReducedMotion?: boolean;
};

export type ConfettiHandle = {
  /** Fire a burst. Options override the component defaults. */
  fire: (options?: ConfettiOptions) => void;
};

export type ConfettiButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Confetti options applied to the burst on click. */
  options?: ConfettiOptions;
};

/** The colours a burst is drawn from when the caller names none. */
const DEFAULT_COLORS: string[] = (
  ['blue', 'indigo', 'purple', 'pink', 'teal', 'green', 'yellow'] satisfies AccentColor[]
).map((color) => accentHex(color));

const DEFAULTS: Required<Omit<ConfettiOptions, 'colors' | 'origin'>> & {
  origin: Required<ConfettiOrigin>;
} = {
  particleCount: 120,
  spread: 70,
  startVelocity: 45,
  origin: { x: 0.5, y: 0.7 },
  scalar: 1,
  ticks: 180,
  gravity: 0.9,
  disableForReducedMotion: true,
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  angle: number;
  spin: number;
  color: string;
  life: number;
  maxLife: number;
  round: boolean;
};

type Surface = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  particles: Particle[];
  /** Downward acceleration in px/s², taken from the burst that last fired. */
  gravity: number;
  frame: number;
  last: number;
};

/** One canvas for the whole app, created on the first burst and reused. */
let surface: Surface | null = null;

function reducedMotion(): boolean {
  return appReducedMotionNow();
}

function ensureSurface(): Surface {
  if (surface) return surface;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  // Above the modal layer, and never in the way of a tap.
  canvas.className = 'pointer-events-none fixed inset-0 z-toast';
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Confetti needs a 2d canvas context');
  document.body.appendChild(canvas);
  surface = { canvas, ctx, particles: [], gravity: 1400 * DEFAULTS.gravity, frame: 0, last: 0 };
  return surface;
}

/** Sizes the backing store to the window, in device pixels. */
function resize(current: Surface): void {
  const ratio = window.devicePixelRatio || 1;
  current.canvas.width = Math.floor(window.innerWidth * ratio);
  current.canvas.height = Math.floor(window.innerHeight * ratio);
  current.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

/**
 * Advances every particle by `dt` seconds and paints the frame.
 *
 * Kept a plain function rather than a hook: there is one canvas for the whole
 * app, and the animation loop is its business, not a component's lifecycle.
 */
function step(current: Surface, dt: number): void {
  const { ctx } = current;
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  for (const particle of current.particles) {
    particle.vy += current.gravity * dt;
    // Air drag, per second rather than per frame so the motion is frame-rate
    // independent: a 120 Hz display must not settle twice as fast.
    const drag = Math.pow(0.86, dt * 60);
    particle.vx *= drag;
    particle.vy *= drag;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.angle += particle.spin * dt;
    particle.life += dt;

    const remaining = 1 - particle.life / particle.maxLife;
    ctx.globalAlpha = Math.max(0, Math.min(1, remaining * 1.8));
    ctx.fillStyle = particle.color;
    ctx.save();
    ctx.translate(particle.x, particle.y);
    ctx.rotate(particle.angle);
    if (particle.round) {
      ctx.beginPath();
      ctx.arc(0, 0, particle.width / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(-particle.width / 2, -particle.height / 2, particle.width, particle.height);
    }
    ctx.restore();
  }

  current.particles = current.particles.filter((particle) => particle.life < particle.maxLife);
  ctx.globalAlpha = 1;
}

function loop(now: number): void {
  const current = surface;
  if (!current) return;
  const dt = current.last === 0 ? 1 / 60 : Math.min(0.05, (now - current.last) / 1000);
  current.last = now;
  step(current, dt);

  if (current.particles.length === 0) {
    current.canvas.remove();
    surface = null;
    return;
  }
  current.frame = window.requestAnimationFrame(loop);
}

/** Fires one burst, starting the animation loop when it is not already up. */
export function fireConfetti(options?: ConfettiOptions): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const settings = {
    ...DEFAULTS,
    ...options,
    origin: { ...DEFAULTS.origin, ...options?.origin },
  };
  if (settings.disableForReducedMotion && reducedMotion()) return;

  const current = ensureSurface();
  resize(current);
  current.gravity = 1400 * settings.gravity;

  const originX = settings.origin.x * window.innerWidth;
  const originY = settings.origin.y * window.innerHeight;
  const cone = (settings.spread * Math.PI) / 180;
  // `startVelocity` is canvas-confetti's unit: roughly pixels per 1/60 s.
  const speed = settings.startVelocity * 60;
  const colors = options?.colors?.length ? options.colors : DEFAULT_COLORS;

  for (let index = 0; index < settings.particleCount; index += 1) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * cone;
    const velocity = speed * (0.55 + Math.random() * 0.7);
    const scale = settings.scalar * (0.7 + Math.random() * 0.6);
    const life = (settings.ticks / 60) * (0.6 + Math.random() * 0.5);
    current.particles.push({
      x: originX,
      y: originY,
      vx: Math.cos(angle) * velocity,
      vy: Math.sin(angle) * velocity,
      width: 9 * scale,
      height: 5 * scale,
      angle: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 18,
      color: colors[Math.floor(Math.random() * colors.length)] ?? accentHex('blue'),
      life: 0,
      maxLife: life,
      round: Math.random() < 0.25,
    });
  }

  current.last = 0;
  if (current.frame === 0) current.frame = window.requestAnimationFrame(loop);
}

/**
 * Imperative confetti. Hold a ref and call `ref.current.fire()` — mirrors the
 * `toast()` ergonomics already used across GodUI.
 */
const Confetti = React.forwardRef<ConfettiHandle, { options?: ConfettiOptions }>(({ options }, ref) => {
  React.useImperativeHandle(
    ref,
    () => ({
      fire: (override?: ConfettiOptions) =>
        fireConfetti({
          ...options,
          ...override,
          origin: { ...options?.origin, ...override?.origin },
        }),
    }),
    [options],
  );
  return null;
});
Confetti.displayName = 'Confetti';

/** Convenience trigger: bursts from the button's position on click. */
const ConfettiButton = React.forwardRef<HTMLButtonElement, ConfettiButtonProps>(
  ({ options, onClick, className, children, ...props }, ref) => {
    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      fireConfetti({
        ...options,
        origin: {
          x: (rect.left + rect.width / 2) / window.innerWidth,
          y: (rect.top + rect.height / 2) / window.innerHeight,
          ...options?.origin,
        },
      });
      onClick?.(event);
    };

    return (
      <button
        ref={ref}
        type="button"
        data-slot="confetti-button"
        onClick={handleClick}
        className={cn(className)}
        {...props}
      >
        {children}
      </button>
    );
  },
);
ConfettiButton.displayName = 'ConfettiButton';

/** Direct imperative API for non-React call sites. */
function confetti(options?: ConfettiOptions): void {
  fireConfetti(options);
}

export { Confetti, ConfettiButton, confetti };
