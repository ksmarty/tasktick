import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { clamp01, formatPercent, progressColor, type ProgressColor } from './progress-ring';

export interface ProgressBarProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
  /** Progress in `0..1`; values outside the range are clamped. */
  value: number;
  /** `tint` (default), `success` / `warning` / `danger`, or an accent name. */
  color?: ProgressColor;
  /** `sm` is the 4px hairline bar, `md` the 8px one. */
  size?: 'sm' | 'md';
  /** Accessible name. Defaults to the percentage. */
  label?: string;
  /** Renders a right-aligned percentage next to the bar. */
  showValue?: boolean;
  /** Content drawn above the bar (e.g. a caption). */
  children?: ReactNode;
}

/** The linear counterpart of `ProgressRing`, with the same ARIA contract. */
export function ProgressBar({
  value,
  color = 'tint',
  size = 'md',
  label,
  showValue = false,
  className,
  children,
  ...rest
}: ProgressBarProps) {
  const progress = clamp01(value);

  return (
    <div className={cn('w-full', className)} {...rest}>
      {children || showValue ? (
        <div className="mb-1 flex items-baseline justify-between gap-2">
          {children ? <span className="min-w-0 text-footnote text-secondary">{children}</span> : <span />}
          {showValue ? <span className="tnum text-footnote text-secondary">{formatPercent(progress)}</span> : null}
        </div>
      ) : null}

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        aria-label={label ?? formatPercent(progress)}
        className={cn('w-full overflow-hidden rounded-full bg-fill', size === 'md' ? 'h-2' : 'h-1')}
      >
        <div
          style={{ width: `${progress * 100}%`, backgroundColor: progressColor(color) }}
          className="h-full rounded-full transition-[width] duration-300 ease-ios-out"
        />
      </div>
    </div>
  );
}
