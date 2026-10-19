/**
 * Where to send someone after they sign in.
 *
 * A reminder notification opens a deep link (`/tasks?task=t1`). When that link
 * lands in a browser that has no session — an installed PWA on iOS keeps its own
 * cookie store, so a tap that opens Safari is never signed in — the sign-in page
 * has to remember the destination, or finishing the sign-in drops the user on a
 * generic list and the reminder is lost.
 *
 * Only a same-origin *path* is accepted. An absolute URL, a protocol-relative
 * `//evil.example`, or anything with a scheme is discarded, because a `next`
 * parameter the browser will follow is the classic open-redirect hole.
 */
const FALLBACK = '/tasks';

export function safeNextPath(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return FALLBACK;
  // Must be a path, and must not be protocol-relative: `//host` is off-site even
  // though it starts with a slash.
  if (!raw.startsWith('/') || raw.startsWith('//')) return FALLBACK;
  // A backslash is normalised to a slash by some browsers, which turns
  // `/\evil.example` into an off-site navigation.
  if (raw.includes('\\')) return FALLBACK;
  // Control characters can hide the real target from a reader.
  if (/[\u0000-\u001f]/.test(raw)) return FALLBACK;
  return raw;
}
