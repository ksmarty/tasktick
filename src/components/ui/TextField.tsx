'use client';

import {
  useId,
  useRef,
  type ComponentPropsWithRef,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';
import { composeRefs, useIsoLayoutEffect } from './internal';

/** `sm` is 36px, `md` 44px, `lg` 48px. */
export type FieldSize = 'sm' | 'md' | 'lg';

/**
 * Font sizes are deliberately >= 16px (`text-callout` is 16px, `text-body` 17px):
 * iOS Safari zooms the whole page when a focused field is smaller than that.
 * `globals.css` sets a 16px floor on touch devices, but a utility class would
 * win over it, so the kit simply never goes smaller here.
 */
const FIELD_SIZE: Record<FieldSize, string> = {
  sm: 'min-h-9 text-callout',
  md: 'min-h-11 text-body',
  lg: 'min-h-12 text-body',
};

export interface TextFieldProps extends Omit<ComponentPropsWithRef<'input'>, 'size'> {
  /** Caption above the field; a string also names the input. */
  label?: ReactNode;
  /** Icon or glyph inside the field, before the input. */
  leading?: ReactNode;
  /** Interactive node pinned inside the field after the input. */
  trailing?: ReactNode;
  /** Error message; also sets `aria-invalid` and the red ring. */
  error?: ReactNode;
  /** Quiet helper text shown when there is no error. */
  hint?: ReactNode;
  /** Vertical density. Never changes the font below 16px. */
  size?: FieldSize;
  /** Classes for the wrapper (layout/margins). */
  className?: string;
  /** Classes for the `<input>` itself. */
  inputClassName?: string;
  children?: never;
}

/**
 * The iOS grouped-list text field: a white inset row with an optional leading
 * glyph and trailing accessory, focus ring on the wrapper and error/hint text
 * underneath wired up through `aria-describedby`.
 *
 * `className` styles the wrapper (layout, margins); every other native prop —
 * `value`, `onChange`, `placeholder`, `autoComplete`, … — lands on the
 * `<input>` itself, so the control behaves like the plain element it wraps.
 */
export function TextField({
  label,
  leading,
  trailing,
  error,
  hint,
  size = 'md',
  className,
  inputClassName,
  id,
  ref,
  ...rest
}: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const describedBy = [error ? errorId : null, !error && hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('w-full', className)}>
      {label ? (
        <label htmlFor={inputId} className="mb-1.5 block px-1 text-footnote text-secondary">
          {label}
        </label>
      ) : null}

      <div
        className={cn(
          'flex items-center gap-2 rounded-ios-md bg-elevated px-3',
          'focus-within:ring-2 focus-within:ring-tint',
          error && 'ring-2 ring-danger',
        )}
      >
        {leading ? (
          <span className="flex shrink-0 items-center text-secondary" aria-hidden>
            {leading}
          </span>
        ) : null}

        <input
          id={inputId}
          ref={ref}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'w-full min-w-0 bg-transparent py-2 text-label outline-none placeholder:text-tertiary',
            'disabled:opacity-40',
            FIELD_SIZE[size],
            inputClassName,
          )}
          {...rest}
        />

        {trailing ? <span className="flex shrink-0 items-center gap-1 text-secondary">{trailing}</span> : null}
      </div>

      {error ? (
        <p id={errorId} className="mt-1.5 px-1 text-footnote text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1.5 px-1 text-footnote text-secondary">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface TextAreaProps extends Omit<ComponentPropsWithRef<'textarea'>, 'rows'> {
  /** Caption above the field; a string also names the textarea. */
  label?: ReactNode;
  /** Error message; also sets `aria-invalid` and the red ring. */
  error?: ReactNode;
  /** Quiet helper text shown when there is no error. */
  hint?: ReactNode;
  /** Minimum height in text rows (default 3). */
  rows?: number;
  /** Grow with the content instead of scrolling. Default true. */
  autoGrow?: boolean;
  /** Show the `used/limit` counter. Defaults to `true` whenever `maxLength` is set. */
  showCount?: boolean;
  /** Classes for the wrapper (layout/margins). */
  className?: string;
  /** Classes for the `<textarea>` itself. */
  inputClassName?: string;
  children?: never;
}

/**
 * Auto-growing multi-line field.
 *
 * The height is recalculated from `scrollHeight` on every value change, with
 * `rows` acting as the floor, so a long note never scrolls inside a 3-line box.
 * `className` styles the wrapper; the rest of the native props reach the
 * `<textarea>`.
 */
export function TextArea({
  label,
  error,
  hint,
  rows = 3,
  autoGrow = true,
  showCount,
  maxLength,
  className,
  inputClassName,
  id,
  ref,
  value,
  defaultValue,
  onChange,
  ...rest
}: TextAreaProps) {
  const generatedId = useId();
  const areaId = id ?? generatedId;
  const errorId = `${areaId}-error`;
  const hintId = `${areaId}-hint`;
  const counterId = `${areaId}-count`;
  const innerRef = useRef<HTMLTextAreaElement | null>(null);

  const text = String(value ?? defaultValue ?? '');
  const showCounter = showCount ?? Boolean(maxLength);
  const describedBy =
    [error ? errorId : null, !error && hint ? hintId : null, showCounter ? counterId : null].filter(Boolean).join(' ') ||
    undefined;

  useIsoLayoutEffect(() => {
    const node = innerRef.current;
    if (!node || !autoGrow) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  }, [autoGrow, text]);

  return (
    <div className={cn('w-full', className)}>
      {label ? (
        <label htmlFor={areaId} className="mb-1.5 block px-1 text-footnote text-secondary">
          {label}
        </label>
      ) : null}

      <div
        className={cn(
          'rounded-ios-md bg-elevated px-3 py-2',
          'focus-within:ring-2 focus-within:ring-tint',
          error && 'ring-2 ring-danger',
        )}
      >
        <textarea
          id={areaId}
          ref={composeRefs(innerRef, ref)}
          rows={rows}
          maxLength={maxLength}
          value={value}
          defaultValue={defaultValue}
          onChange={onChange}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'block w-full resize-none bg-transparent text-body text-label outline-none placeholder:text-tertiary',
            'disabled:opacity-40',
            inputClassName,
          )}
          {...rest}
        />
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {error ? (
            <p id={errorId} className="mt-1.5 px-1 text-footnote text-danger">
              {error}
            </p>
          ) : hint ? (
            <p id={hintId} className="mt-1.5 px-1 text-footnote text-secondary">
              {hint}
            </p>
          ) : null}
        </div>
        {showCounter ? (
          <p id={counterId} className="tnum mt-1.5 px-1 text-footnote text-tertiary">
            {text.length}
            {maxLength ? `/${maxLength}` : ''}
          </p>
        ) : null}
      </div>
    </div>
  );
}
