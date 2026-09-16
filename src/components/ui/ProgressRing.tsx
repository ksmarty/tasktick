import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { clamp01, formatPercent, progressColor, ringDashOffset, ringGeometry, type ProgressColor } from './progress-ring';

export interface ProgressRingProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
  /** Progress in `0..1`; values outside the range are clamped. */
  value: number;
  /** Side length of the square, in px. Default 44. */
  size?: number;
  /** Stroke width, in px. Default 4. */
  strokeWidth?: number;
  /** `tint` (default), `success` / `warning` / `danger`, or an accent name. */
  color?: ProgressColor;
  /** Accessible name. Defaults to the percentage. */
  label?: string;
  /** Centre content; replaces the percentage text. */
  children?: ReactNode;
  /** Show the percentage in the centre when no `children` are given. */
  showValue?: boolean;
}

/**
 * SVG progress ring. Exposes `role="progressbar"` with the full
 * `aria-valuemin`/`aria-valuemax`/`aria-valuenow` triple so assistive tech
 * announces the same number that is drawn.
 */
export function ProgressRing({
  value,
  size = 44,
  strokeWidth = 4,
  color = 'tint',
  label,
  children,
  showValue = false,
  className,
  ...rest
}: ProgressRingProps) {
  const progress = clamp01(value);
  const geometry = ringGeometry(size, strokeWidth);

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      aria-label={label ?? formatPercent(progress)}
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      {...rest}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="block">
        <circle
          cx={geometry.center}
          cy={geometry.center}
          r={geometry.radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={geometry.strokeWidth}
          className="text-fill"
        />
        <circle
          cx={geometry.center}
          cy={geometry.center}
          r={geometry.radius}
          fill="none"
          stroke={progressColor(color)}
          strokeWidth={geometry.strokeWidth}
          strokeLinecap="round"
          strokeDasharray={geometry.circumference}
          strokeDashoffset={ringDashOffset(progress, geometry.circumference)}
          transform={`rotate(-90 ${geometry.center} ${geometry.center})`}
          className="transition-[stroke-dashoffset] duration-300 ease-ios-out"
        />
      </svg>
      {children ?? (showValue ? (
        <span className="tnum absolute inset-0 flex items-center justify-center text-caption-1 font-semibold text-label">
          {formatPercent(progress)}
        </span>
      ) : null)}
    </div>
  );
}
