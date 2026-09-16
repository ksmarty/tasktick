import { cn } from '@/lib/cn';

/**
 * Full-height page frame that respects every safe-area inset.
 *
 * A single wrapper rather than repeating `pt-safe pb-safe px-safe min-h-dvh` in
 * every layout keeps the Dynamic Island handling consistent — the one place
 * where getting it wrong produces content stuck under the notch.
 */
export function SafeAreaFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('min-h-dvh px-safe', className)}>{children}</div>;
}
