'use client';

import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Sheet } from './Sheet';

export interface ActionSheetAction {
  label: ReactNode;
  /** Renders in the danger colour — use for delete/discard, never for the safe choice. */
  destructive?: boolean;
  disabled?: boolean;
  icon?: LucideIcon;
  /** Called after the sheet closes. */
  onSelect?: () => void;
}

export interface ActionSheetProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Bold heading, e.g. the item the actions apply to. */
  title?: ReactNode;
  /** Explanatory line under the title. */
  message?: ReactNode;
  actions: readonly ActionSheetAction[];
  /** Label of the separate dismiss button. Defaults to "Cancel". */
  cancelLabel?: string;
}

/**
 * The iOS action sheet: the choices in one grouped card, and the Cancel button
 * as a separate card below it. Always dismissible — a sheet with no way out is
 * a trap on a phone.
 */
export function ActionSheet({
  open,
  onOpenChange,
  title,
  message,
  actions,
  cancelLabel = 'Cancel',
  className,
  ...rest
}: ActionSheetProps) {
  function select(action: ActionSheetAction) {
    if (action.disabled) return;
    onOpenChange(false);
    action.onSelect?.();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} description={message} dismissible className={className} {...rest}>
      <div className="pb-2">
        <div className="grouped">
          <ul className="divide-y divide-separator">
            {actions.map((action, index) => {
              const Icon = action.icon;
              return (
                <li key={index}>
                  <button
                    type="button"
                    disabled={action.disabled}
                    aria-disabled={action.disabled || undefined}
                    onClick={() => select(action)}
                    className={cn(
                      'flex min-h-12 w-full items-center justify-center gap-2 px-4 py-3 text-body',
                      action.destructive ? 'text-danger' : 'text-tint',
                      action.disabled ? 'opacity-40' : 'pressable-row',
                    )}
                  >
                    {Icon ? <Icon className="size-5 shrink-0" aria-hidden /> : null}
                    {action.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="mt-2 flex min-h-12 w-full items-center justify-center rounded-ios-lg bg-elevated px-4 py-3 text-body font-semibold text-tint pressable"
        >
          {cancelLabel}
        </button>
      </div>
    </Sheet>
  );
}
