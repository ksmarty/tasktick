'use client';

/**
 * Transient banners — the app's toast surface, on GodUI's toast.
 *
 * `@/components/godui/toast` is the implementation: a module-level store, an
 * imperative `toast()` that works from anywhere, swipe-to-dismiss and a stacked,
 * hover-expanded pile. It is imported rather than re-implemented.
 *
 * ## Why this shim exists
 *
 * GodUI's public shape is not the app's. GodUI exposes `toast(options)` plus
 * `toast.success` / `toast.error` and a `ToastProvider` that renders *only* the
 * toaster — it does not render children — and whose variants are `default`,
 * `success` and `error`. The app has 19 call sites that do
 * `const { toast } = useToast()` and fire `toast({ title, description, variant })`
 * with variants `success`, `error` and `info`, and toasts are fired from failure
 * paths: a migration that quietly drops an error banner is worse than one that
 * leaves the markup alone. So this file is the seam:
 *
 *  • `ToastProvider` still wraps `children` (the GodUI toaster is rendered
 *    beside them, portalled) and still exposes the context that `useToast()`
 *    reads, so the "must be used inside `<ToastProvider>`" contract is intact.
 *  • `toast()` still takes `{ title, description, variant, duration, action }`
 *    or a bare string, and still returns `{ id, dismiss }`.
 *  • `variant: 'info'` maps to GodUI's `default` — the neutral surface. There is
 *    no third colour in Celestial Sapphire, and `info` was never anything but
 *    "no severity".
 *  • `duration: 0` meant "keep it until dismissed"; GodUI always sets a timer, so
 *    zero is translated to the longest delay a `setTimeout` can express rather
 *    than to a banner that vanishes on the next tick.
 *  • `icon` is accepted and ignored — GodUI's toast has no glyph slot, and no
 *    call site passes one.
 *
 * `ToastOptions`, `ToastVariant`, `ToastProviderProps`, `ToastHandle` and
 * `ToastContextValue` are still exported, so call sites and their types do not
 * move.
 */
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';

import {
  ToastProvider as GodUIToastProvider,
  toast as goduiToast,
} from '@/components/godui/toast';

export type ToastVariant = 'success' | 'error' | 'info';

/** Any icon component; the app no longer depends on a specific icon library. */
type IconComponent = ComponentType<{ fontSize?: 'small' | 'inherit' | 'medium' | 'large' }>;

export interface ToastOptions {
  title: string;
  /** Optional second line with the detail. */
  description?: string;
  variant?: ToastVariant;
  /** Auto-dismiss delay in ms. `0` keeps the banner until it is dismissed. */
  duration?: number;
  /** Optional single action rendered at the trailing edge. */
  action?: { label: string; onClick: () => void };
  /** Accepted for compatibility. GodUI's toast has no glyph slot, so it is ignored. */
  icon?: IconComponent;
}

export interface ToastHandle {
  id: string;
  /** Removes this banner immediately. */
  dismiss: () => void;
}

export interface ToastContextValue {
  /** Shows a banner (a bare string is treated as `{ title }`). */
  toast: (options: ToastOptions | string) => ToastHandle;
  /** Dismisses one banner by id. */
  dismiss: (id: string) => void;
}

export interface ToastProviderProps {
  children: ReactNode;
  /** Retained for call-site compatibility; GodUI's stack peeks three, expanded on hover. */
  max?: number;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** The app's original dwell time. GodUI's own default is 4s. */
const DEFAULT_DURATION = 3200;

/** `setTimeout`'s ceiling — ~24.8 days, which is "until dismissed" in practice. */
const PERSISTENT_DURATION = 2 ** 31 - 1;

function dismiss(id: string) {
  goduiToast.dismiss(Number(id));
}

/**
 * Translates one app-shaped banner into GodUI's store.
 *
 * Deliberately module-level and context-free: GodUI's store is itself
 * module-level, so a toast fired during a render or from an event outside React
 * (a service-worker message, say) still lands.
 */
function publish(options: ToastOptions | string): ToastHandle {
  const banner: ToastOptions = typeof options === 'string' ? { title: options } : options;
  const id = goduiToast({
    title: banner.title,
    description: banner.description,
    variant:
      banner.variant === 'success' || banner.variant === 'error' ? banner.variant : 'default',
    duration: banner.duration === 0 ? PERSISTENT_DURATION : banner.duration,
    action: banner.action,
  });
  return { id: String(id), dismiss: () => dismiss(String(id)) };
}

type ToastFn = ((options: ToastOptions | string) => ToastHandle) & {
  success: (options: ToastOptions) => ToastHandle;
  error: (options: ToastOptions) => ToastHandle;
  dismiss: (id: string) => void;
};

/** The app-shaped `toast`, for callers that do not need the hook. */
export const toast = Object.assign(publish, {
  success: (options: ToastOptions) => publish({ ...options, variant: 'success' }),
  error: (options: ToastOptions) => publish({ ...options, variant: 'error' }),
  dismiss,
}) as ToastFn;

export function ToastProvider({ children }: ToastProviderProps) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  const value = useMemo<ToastContextValue>(() => ({ toast: publish, dismiss }), []);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/*
       * GodUI's toaster renders through a portal, so it is anchored to the
       * viewport rather than to where it is mounted, and it ships with four
       * corner presets and no bottom-centre one. The app's banners have always
       * sat centred just above the bottom band — anchored any lower they cover
       * the tab bar and the action button, which are exactly the two things a
       * thumb reaches for after the action that raised the banner. Portalling
       * into this element makes the toaster a DOM child of it, and the `[&>ol]`
       * utilities re-anchor it from there. `contents` keeps the wrapper out of
       * layout — it is a portal target, not a box.
       */}
      <div
        ref={setContainer}
        className="contents [&>ol]:bottom-[calc(env(safe-area-inset-bottom)_+_5.5rem)] [&>ol]:left-0 [&>ol]:right-0 [&>ol]:mx-auto lg:[&>ol]:bottom-6"
      />
      <GodUIToastProvider
        container={container}
        position="bottom-right"
        duration={DEFAULT_DURATION}
      />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
