'use client';

/**
 * A bar docked to the viewport rather than to the page.
 *
 * `position: fixed` is not enough on its own inside a view. The shell animates
 * the route wrapper's `transform`, and an element with a transform — even the
 * identity matrix an animation settles on once it has finished — becomes the
 * containing block for its `fixed` descendants. A bar rendered inside a view is
 * therefore pinned to the foot of the *content*: off screen until the list is
 * scrolled to its end, which is the opposite of what a docked bar is for.
 *
 * Portalling it to `document.body` puts it back in the viewport's coordinate
 * space, where `fixed` means what it says. The portal is client-only and appears
 * as soon as the view mounts, so nothing about it is server-rendered.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ViewportDockProps {
  /** Positioning classes — `fixed`, the insets and the z-index belong here. */
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

export function ViewportDock({ className, style, children }: ViewportDockProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return null;
  return createPortal(
    <div className={className} style={style}>
      {children}
    </div>,
    document.body,
  );
}
