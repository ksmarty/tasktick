'use client';

/**
 * The standing indicator while preview sign-in is responsible for the session.
 *
 * Same reasoning as `DemoModeBanner` next to it in the shell: a state that makes
 * the app behave differently from what a visitor would expect has to be visible
 * on every screen, not buried in a settings row. Here the surprise is subtler
 * and worse than demo mode's — the app is signed in as someone, and nothing was
 * typed to get there. Without a marker, a screenshot or a screen recording taken
 * in this mode reads as "this app has no authentication".
 *
 * The address is shown because it is the part that matters: whether this is an
 * account someone handed you or your own rows is exactly the question the banner
 * has to answer at a glance.
 */
export function PreviewAuthBanner({ email }: { email: string }) {
  return (
    <div
      role="status"
      className="flex shrink-0 items-center justify-center gap-2 border-b border-border bg-secondary px-gutter py-1 text-xs font-medium text-secondary-foreground"
    >
      <span aria-hidden className="size-1.5 rounded-full bg-primary" />
      <span className="truncate">
        Preview sign-in — signed in as {email} without a password
      </span>
    </div>
  );
}
