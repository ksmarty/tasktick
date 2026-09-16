/**
 * Class-name helper. `clsx` for conditional composition, `tailwind-merge` so a
 * caller-supplied override actually wins instead of fighting specificity with
 * the component's default classes.
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
