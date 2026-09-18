'use client';

/**
 * One navigational settings row: an icon, two lines and a chevron.
 *
 * Used by the Tools group on the settings index and by the administrator link on
 * Advanced. It reuses `SETTINGS_ROW_CLASS` so a link lines up with every real row
 * in the area instead of growing its own gutter.
 */
import Link from 'next/link';
import { ChevronRightIcon } from '@svg-animated-icons/react/chevron-right';
import { cn } from '@/lib/utils';
import { SETTINGS_ROW_CLASS } from './SettingsGroup';
import type { ReactNode } from 'react';

export interface SectionLinkProps {
  href: string;
  icon: ReactNode;
  title: string;
  subtitle: string;
}

export function SectionLink({ href, icon, title, subtitle }: SectionLinkProps) {
  return (
    <Link
      href={href}
      className={cn(SETTINGS_ROW_CLASS, 'flex items-center gap-3 transition-colors hover:bg-accent/50')}
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
      </span>
      <ChevronRightIcon className="shrink-0 text-muted-foreground" />
    </Link>
  );
}
