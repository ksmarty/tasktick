'use client';

/**
 * A header action drawn as a circular floating control.
 *
 * The reference app's nav-bar controls are circles with a visible surface behind
 * the glyph; ours was a bare `✓✓` with nothing behind it, which is why it read
 * as a stray glyph rather than as a button. The reference outlines its circle, a
 * soft tinted one reads better on our light glass chrome.
 *
 * This is a thin wrapper around `IconButton`, not a second button: the shape is
 * a class, the behaviour (press feedback, disabled state, accessible name) is
 * still `IconButton`'s.
 *
 * `sm` is the 36px circle. The transparent ring the `after` pseudo-element
 * paints around it takes the touch target back to the 44px the HIG asks for, so
 * the control is not smaller to a finger than it looks.
 */
import { cn } from '@/lib/cn';
import { IconButton, type IconButtonProps } from '@/components/ui';

export type HeaderActionButtonProps = Omit<IconButtonProps, 'size'>;

export function HeaderActionButton({ className, iconClassName, ...rest }: HeaderActionButtonProps) {
  return (
    <IconButton
      size="sm"
      variant="tinted"
      iconClassName={cn('size-[18px]', iconClassName)}
      className={cn(
        'relative rounded-full',
        // 4px of hit slop on every side: 36px of circle, 44px of target.
        "after:absolute after:-inset-1 after:content-['']",
        className,
      )}
      {...rest}
    />
  );
}
