'use client';

/**
 * A header action drawn as a circular floating control.
 *
 * A thin shadcn `Button`, not a second button: the circle and the tinted surface
 * are classes, the behaviour (press feedback, disabled state, accessible name) is
 * still the Button's.
 *
 * The `::after` overlay takes the touch target back to the 44px the HIG asks
 * for — 4px of hit slop on every side — so the control is not smaller to a finger
 * than the 36px circle looks. Tailwind's `after:` variant supplies the empty
 * `content`, so the pseudo-element needs no content of its own.
 *
 * The icon is typed as a plain component taking `className`, not a MUI
 * `SvgIconComponent`: the app's icons come from two sets (`@svg-animated-icons`
 * and `lucide-react`) and both are sized through the font size.
 */
import type { ComponentType } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type HeaderActionButtonVariant = 'tinted' | 'filled';

export interface HeaderActionButtonProps {
  /** Accessible name. Required: this control is icon-only. */
  'aria-label': string;
  icon: ComponentType<{ className?: string }>;
  onClick?: () => void;
  disabled?: boolean;
  /** `tinted` is the quiet default; `filled` marks an engaged state. */
  variant?: HeaderActionButtonVariant;
  className?: string;
}

export function HeaderActionButton({
  icon: Icon,
  variant = 'tinted',
  className,
  ...rest
}: HeaderActionButtonProps) {
  return (
    <Button
      type="button"
      size="icon"
      variant={variant === 'filled' ? 'default' : 'secondary'}
      className={cn(
        'relative size-9 shrink-0 rounded-full after:absolute after:-inset-1',
        variant === 'tinted' && 'bg-muted text-foreground hover:bg-accent',
        className,
      )}
      {...rest}
    >
      <Icon className="text-lg" />
    </Button>
  );
}
