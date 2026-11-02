'use client';

/**
 * The two field shapes the signed-out screens use.
 *
 * Sign-in and registration are the same four inputs in different orders — a
 * labelled text field with a decorative glyph inside it, and a password field
 * that can be revealed — and they were copied, markup and all, into both forms.
 * The copy had already drifted once: the note explaining the glyph position had
 * to be duplicated in the second file, and the reveal button's classes were
 * maintained twice.
 *
 * So the markup lives here, the forms decide what to ask for. Nothing about
 * behaviour moved: the reveal state is still local to the field that owns it, a
 * field is still a `Label` plus an `Input`, and the glyph is still decorative
 * (`aria-hidden`) — the label is what names the input.
 *
 * The reveal button is a real `button type="button"`, not an icon with a click
 * handler: inside a form, the default type submits, so the one that reveals the
 * password would otherwise also try to sign the user in.
 */
import { useState, type ComponentProps, type ReactNode } from 'react';
import { EyeClosedIcon } from '@svg-animated-icons/react/eye-closed';
import { EyeOpenIcon } from '@svg-animated-icons/react/eye-open';
import { LockClosedIcon } from '@svg-animated-icons/react/lock-closed';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * Positions a decorative field glyph inside a `relative` input wrapper.
 *
 * A class string rather than a component: the glyph is a `span aria-hidden` (the
 * animated icons forward a `className` but no ARIA props), so wrapping it in
 * anything would be a wrapper for the sake of a wrapper.
 */
const GLYPH =
  'pointer-events-none absolute top-1/2 left-3 inline-flex -translate-y-1/2 text-base text-muted-foreground';

export interface AuthFieldProps extends Omit<ComponentProps<typeof Input>, 'className'> {
  label: string;
  /** The decorative glyph shown inside the input. */
  icon: ReactNode;
  /** Rendered under the input: a hint, or the validation message it explains. */
  note?: ReactNode;
  className?: string;
}

export function AuthField({ label, icon, note, className, id, ...input }: AuthFieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <span aria-hidden className={GLYPH}>
          {icon}
        </span>
        <Input id={id} className={cn('h-11 pl-9', className)} {...input} />
      </div>
      {note}
    </div>
  );
}

export interface AuthPasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** `current-password` when signing in, `new-password` when creating one. */
  autoComplete: 'current-password' | 'new-password';
  placeholder?: string;
  /** Rendered under the input: a hint, or the validation message it explains. */
  note?: ReactNode;
  /** Marks the input as failing validation, so assistive tech says so. */
  invalid?: boolean;
  /** The id of the note, so the input and the message are read together. */
  describedBy?: string;
}

export function AuthPasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
  note,
  invalid = false,
  describedBy,
}: AuthPasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <span aria-hidden className={GLYPH}>
          <LockClosedIcon />
        </span>
        <Input
          id={id}
          type={visible ? 'text' : 'password'}
          name={id}
          autoComplete={autoComplete}
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-invalid={invalid}
          aria-describedby={invalid ? describedBy : undefined}
          className="h-11 pr-10 pl-9"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          className="absolute top-1/2 right-2 inline-flex -translate-y-1/2 rounded-md p-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span aria-hidden className="inline-flex text-base">
            {visible ? <EyeClosedIcon /> : <EyeOpenIcon />}
          </span>
        </button>
      </div>
      {note}
    </div>
  );
}
