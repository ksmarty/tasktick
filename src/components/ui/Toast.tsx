'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentPropsWithoutRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { CircleAlert, CircleCheck, Info, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Portal, Z } from './internal';

/** Default auto-dismiss delay, long enough to read a short sentence. */
const DEFAULT_DURATION = 3200;
/** Horizontal swipe distance that throws a banner away. */
const SWIPE_DISMISS_PX = 72;

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastOptions {
  title: string;
  /** Optional second line with the detail. */
  description?: string;
  variant?: ToastVariant;
  /** Auto-dismiss delay in ms. `0` keeps the banner until it is dismissed. */
  duration?: number;
  /** Optional single action rendered at the trailing edge. */
  action?: { label: string; onClick: () => void };
  /** Overrides the variant glyph. */
  icon?: LucideIcon;
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

export interface ToastProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  variant?: ToastVariant;
  /** Overrides the variant glyph. */
  icon?: LucideIcon;
  action?: { label: string; onClick: () => void };
  /** Renders the close affordance when given. */
  onDismiss?: () => void;
  dismissLabel?: string;
}

const VARIANT_ICONS: Record<ToastVariant, LucideIcon> = {
  success: CircleCheck,
  error: CircleAlert,
  info: Info,
};

const VARIANT_TINT: Record<ToastVariant, string> = {
  success: 'text-success',
  error: 'text-danger',
  info: 'text-tint',
};

/**
 * One transient banner. Purely presentational: it renders the material card,
 * the variant glyph, the text and the dismiss affordance; the queue, the timers
 * and the swipe physics live in `ToastProvider` / `ToastItem`.
 */
export function Toast({
  title,
  description,
  variant = 'info',
  icon,
  action,
  onDismiss,
  dismissLabel = 'Dismiss',
  className,
  ...rest
}: ToastProps) {
  const Icon = icon ?? VARIANT_ICONS[variant];

  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      aria-live={variant === 'error' ? 'assertive' : 'polite'}
      className={cn(
        'material pointer-events-auto flex w-full items-start gap-2.5 rounded-ios-lg px-3 py-2.5 shadow-ios-lg',
        className,
      )}
      {...rest}
    >
      <Icon className={cn('mt-0.5 size-5 shrink-0', VARIANT_TINT[variant])} aria-hidden />

      <div className="min-w-0 flex-1">
        <p className="text-subhead font-semibold text-label">{title}</p>
        {description ? <p className="mt-0.5 text-footnote text-secondary">{description}</p> : null}
        {action ? (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-1.5 min-h-6 text-footnote font-semibold text-tint pressable"
          >
            {action.label}
          </button>
        ) : null}
      </div>

      {onDismiss ? (
        <button
          type="button"
          aria-label={dismissLabel}
          onClick={onDismiss}
          className="-mr-1 flex size-7 shrink-0 items-center justify-center rounded-full text-tertiary pressable"
        >
          <X className="size-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* queue                                                                      */
/* -------------------------------------------------------------------------- */

interface ToastRecord extends ToastOptions {
  id: string;
  variant: ToastVariant;
  duration: number;
}

interface ToastController {
  id: number;
  push: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
}

/**
 * Module-level registry of mounted providers.
 *
 * A `ToastProvider` is often mounted more than once (root layout plus a route
 * group), and two portals would stack two identical queues. So every provider
 * registers itself and *only the first one* renders the portal; the others
 * forward `toast()`/`dismiss()` calls to it, which keeps exactly one queue and
 * one portal no matter how many times the provider appears in the tree.
 */
const controllers: ToastController[] = [];
const registryListeners = new Set<() => void>();
let controllerSeq = 0;

function notifyRegistry(): void {
  for (const listener of registryListeners) listener();
}

function subscribeRegistry(listener: () => void): () => void {
  registryListeners.add(listener);
  return () => {
    registryListeners.delete(listener);
  };
}

function primaryControllerId(): number {
  return controllers[0]?.id ?? 0;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export interface ToastProviderProps {
  children?: ReactNode;
  /** Maximum number of banners on screen at once. Oldest is dropped first. */
  max?: number;
}

export function ToastProvider({ children, max = 3 }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((record) => record.id !== id));
  }, []);

  const push = useCallback(
    (options: ToastOptions) => {
      seq.current += 1;
      const id = `toast-${seq.current}`;
      const record: ToastRecord = { variant: 'info', duration: DEFAULT_DURATION, ...options, id };
      setToasts((current) => [...current, record].slice(-Math.max(1, max)));
      return id;
    },
    [max],
  );

  // `push`/`dismiss` are read through a ref so the stable controller always
  // calls the current implementations (e.g. after `max` changes).
  const latest = useRef({ push, dismiss });
  latest.current = { push, dismiss };

  const controllerRef = useRef<ToastController | null>(null);
  if (!controllerRef.current) {
    controllerSeq += 1;
    controllerRef.current = {
      id: controllerSeq,
      push: (options) => latest.current.push(options),
      dismiss: (id) => latest.current.dismiss(id),
    };
  }
  const controller = controllerRef.current;

  useEffect(() => {
    controllers.push(controller);
    notifyRegistry();
    return () => {
      const index = controllers.indexOf(controller);
      if (index >= 0) controllers.splice(index, 1);
      notifyRegistry();
    };
  }, [controller]);

  const primaryId = useSyncExternalStore(subscribeRegistry, primaryControllerId, () => 0);
  const isPrimary = primaryId === controller.id;

  const value = useMemo<ToastContextValue>(
    () => ({
      toast: (options) => {
        const primary = controllers[0];
        if (!primary) return { id: '', dismiss: () => {} };
        const id = primary.push(typeof options === 'string' ? { title: options } : options);
        return { id, dismiss: () => primary.dismiss(id) };
      },
      dismiss: (id) => {
        controllers[0]?.dismiss(id);
      },
    }),
    [],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {isPrimary ? (
        <Portal>
          {/* Top of the screen, clear of the Dynamic Island / notch. */}
          <div
            role="region"
            aria-label="Notifications"
            className="pointer-events-none fixed inset-x-0 top-0 px-3"
            style={{ zIndex: Z.toast, paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}
          >
            <ol className="mx-auto flex w-full max-w-md flex-col gap-2">
              {toasts.map((record) => (
                <li key={record.id}>
                  <ToastItem record={record} onDismiss={dismiss} />
                </li>
              ))}
            </ol>
          </div>
        </Portal>
      ) : null}
    </ToastContext.Provider>
  );
}

/** Queue entry: owns the auto-dismiss timer and the swipe gesture. */
function ToastItem({ record, onDismiss }: { record: ToastRecord; onDismiss: (id: string) => void }) {
  const [offsetX, setOffsetX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef({ startX: 0, active: false });

  const dismiss = useCallback(() => onDismiss(record.id), [onDismiss, record.id]);

  useEffect(() => {
    if (record.duration <= 0 || dragging) return;
    const timer = window.setTimeout(dismiss, record.duration);
    return () => window.clearTimeout(timer);
  }, [dismiss, record.duration, dragging]);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    gesture.current = { startX: event.clientX, active: true };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!gesture.current.active) return;
    setOffsetX(event.clientX - gesture.current.startX);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!gesture.current.active) return;
    gesture.current.active = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const travelled = event.clientX - gesture.current.startX;
    setDragging(false);
    setOffsetX(0);
    if (Math.abs(travelled) > SWIPE_DISMISS_PX) dismiss();
  }

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        transform: offsetX ? `translateX(${offsetX}px)` : undefined,
        opacity: offsetX ? Math.max(0.2, 1 - Math.abs(offsetX) / 240) : undefined,
        touchAction: 'pan-y',
        transition: dragging ? 'none' : 'transform 200ms var(--ease-ios), opacity 200ms var(--ease-ios)',
      }}
    >
      <Toast
        title={record.title}
        description={record.description}
        variant={record.variant}
        icon={record.icon}
        action={record.action}
        onDismiss={dismiss}
      />
    </div>
  );
}

/**
 * Access to the toast queue. Returns `{ toast, dismiss }`: `toast()` returns the
 * id plus a `dismiss()` for that specific banner. Throws when used outside a
 * `ToastProvider`, because a silently swallowed toast is worse than a crash.
 */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast() must be used inside a <ToastProvider>.');
  return context;
}
