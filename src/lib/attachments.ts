/**
 * The attachment rules both sides of the wire have to agree on.
 *
 * The size ceiling is here, not in `env.ts`, for one reason: the browser refuses
 * an oversized file before spending a minute uploading it, and the server refuses
 * it again because a browser is not an authority. Two numbers would drift and the
 * drift would show up as a file the UI accepted and the API rejected — so there is
 * one number, in a module with no imports, and both import it.
 *
 * Formatting lives here too. A file list is the one place a person reads "3.4 MB",
 * and the same file must say the same thing in the editor and in a test.
 */

/**
 * Largest file the app accepts.
 *
 * Not a technical limit — it is the point past which "attach a file to a task"
 * has stopped being what the feature is for. The bytes are written to disk with
 * no per-user quota, so the honest defence is a ceiling plus the fact that only
 * the signed-in owner can read or delete a file.
 */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** `25 MB` — derived, so the UI never states a limit the server does not enforce. */
export const MAX_ATTACHMENT_LABEL = `${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB`;

/**
 * A human size, with the unit that makes it readable.
 *
 * One decimal place up to a megabyte, none above, because "1.4 MB" and "12 MB"
 * are the two shapes a person actually reads — and bytes are the integer, never
 * a rounded zero.
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${short(kb)} KB`;
  return `${short(kb / 1024)} MB`;
}

/**
 * The number, with a decimal only where it says something.
 *
 * `2.0 KB` reads like a precision nobody asked for — the decimal is kept under
 * ten (where 1.5 KB and 2.4 MB are real distinctions) and dropped when it is a
 * trailing zero or the value is large enough that it is noise.
 */
function short(value: number): string {
  if (value >= 10) return String(Math.round(value));
  const oneDecimal = value.toFixed(1);
  return oneDecimal.endsWith('.0') ? oneDecimal.slice(0, -2) : oneDecimal;
}

/**
 * Whether the file is an image this app will draw inline.
 *
 * Deliberately narrow: only the four raster formats every browser renders. An
 * SVG is an image to a browser and a script host to everything else, so it is
 * shown as a file name like any other attachment rather than inlined.
 */
export function isPreviewableImage(mimeType: string): boolean {
  return /^image\/(png|jpeg|gif|webp)$/i.test(mimeType);
}
