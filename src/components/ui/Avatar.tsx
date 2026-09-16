import type { ComponentPropsWithoutRef } from 'react';
import { accentVar, colorForName } from '@/lib/colors';
import { cn } from '@/lib/cn';
import { ACCENT_COLORS, type AccentColor } from '@/lib/types';

export interface AvatarProps extends ComponentPropsWithoutRef<'span'> {
  /** Full name; the initials and (unless `color` is given) the background derive from it. */
  name: string;
  /** Optional picture. Falls back to the initials when absent or empty. */
  src?: string | null;
  /** `sm` 24px, `md` 36px, `lg` 48px. */
  size?: 'sm' | 'md' | 'lg';
  /** Overrides the deterministic background colour. */
  color?: AccentColor;
}

const SIZE_CLASSES = {
  sm: 'size-6 text-caption-2',
  md: 'size-9 text-footnote',
  lg: 'size-12 text-headline',
} as const;

/**
 * Up to two initials: first letter of the first and last word, so "Ana María
 * Ruiz" gives "AR" rather than "AM".
 */
export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0][0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1][0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

/** Circular avatar with a deterministic accent colour, so people look stable. */
export function Avatar({ name, src, size = 'md', color, className, ...rest }: AvatarProps) {
  const background = color ?? colorForName(name || '?', ACCENT_COLORS);

  return (
    <span
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold',
        SIZE_CLASSES[size],
        !src && 'text-on-tint',
        className,
      )}
      style={src ? undefined : { backgroundColor: accentVar(background) }}
      {...rest}
    >
      {src ? (
        <img src={src} alt={name} className="size-full object-cover" />
      ) : (
        <span aria-hidden>{initialsFor(name)}</span>
      )}
    </span>
  );
}
