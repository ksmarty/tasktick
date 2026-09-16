'use client';

import { useEffect, useId, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Portal, Z, useBodyScrollLock, useEscapeKey, useFocusTrap } from './internal';
import { Spinner } from './Spinner';

export interface ConfirmDialogProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Bold alert title. */
  title: ReactNode;
  /** Explanatory message under the title. */
  message?: ReactNode;
  /** Defaults to "OK". */
  confirmLabel?: string;
  /** Defaults to "Cancel". */
  cancelLabel?: string;
  /** Colours the confirm button red; use for destructive confirmation. */
  destructive?: boolean;
  /**
   * Called when Confirm is pressed. May return a promise — the dialog then
   * shows a spinner and stays open until it settles, closing on resolve and
   * staying open on reject.
   */
  onConfirm?: () => void | Promise<void>;
  /** Called when the dialog is dismissed without confirming. */
  onCancel?: () => void;
}

/**
 * The iOS alert: a centred, 270pt-wide rounded card over a dimmed backdrop,
 * with a hairline between the message and the buttons and another between the
 * two buttons. Escape, the backdrop and Cancel all dismiss it.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
  className,
  ...rest
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    if (!open) setPending(false);
  }, [open]);

  const cancel = () => {
    if (pending) return;
    onOpenChange(false);
    onCancel?.();
  };

  async function confirm() {
    if (!onConfirm) {
      onOpenChange(false);
      return;
    }
    const result = onConfirm();
    if (result instanceof Promise) {
      setPending(true);
      try {
        await result;
        onOpenChange(false);
      } catch {
        // Keep the dialog open so the user can retry or cancel.
      } finally {
        setPending(false);
      }
      return;
    }
    onOpenChange(false);
  }

  useBodyScrollLock(open);
  useEscapeKey(open, cancel);
  useFocusTrap(panelRef, open);

  if (!open) return null;

  return (
    <Portal>
      <div className="fixed inset-0 flex items-center justify-center p-8" style={{ zIndex: Z.dialog }}>
        <div aria-hidden onClick={cancel} className="absolute inset-0 bg-overlay animate-fade-in" />

        <div
          ref={panelRef}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={message ? messageId : undefined}
          tabIndex={-1}
          className={cn(
            'relative w-[270px] max-w-full overflow-hidden rounded-ios-xl bg-elevated shadow-ios-lg animate-ios-in',
            className,
          )}
          {...rest}
        >
          <div className="px-4 py-5 text-center">
            <h2 id={titleId} className="text-headline font-semibold text-label">
              {title}
            </h2>
            {message ? (
              <p id={messageId} className="mt-1.5 text-subhead text-secondary">
                {message}
              </p>
            ) : null}
          </div>

          <div className="hairline-t flex">
            <button
              type="button"
              onClick={cancel}
              disabled={pending}
              aria-disabled={pending || undefined}
              className="pressable-row flex min-h-11 flex-1 items-center justify-center border-r border-separator px-2 text-body text-tint disabled:opacity-40"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={pending}
              aria-disabled={pending || undefined}
              aria-busy={pending || undefined}
              className={cn(
                'pressable-row flex min-h-11 flex-1 items-center justify-center gap-2 px-2 text-body font-semibold disabled:opacity-40',
                destructive ? 'text-danger' : 'text-tint',
              )}
            >
              {pending ? <Spinner size={16} decorative /> : null}
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
