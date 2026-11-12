/**
 * One attachment: download its bytes, or delete it.
 *
 * The download is the only endpoint in the app that answers with something other
 * than the `{ok,data}` envelope, and it has to be: the response *is* the file. It
 * is also the reason the id is resolved through the repository with the user id
 * attached — a URL that takes an id from the caller is exactly where a missing
 * ownership check turns into one account reading another's documents.
 */
import { NextResponse } from 'next/server';
import { notFound, ok, route } from '@/server/http';
import {
  contentDisposition,
  deleteOwnedAttachment,
  readAttachment,
} from '@/server/services/attachments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user, params }) => {
  const found = await readAttachment(user.id, params.id);
  if (!found) {
    // 404 for both "not yours" and "bytes missing": one answer, so the status
    // cannot be used to probe for ids that exist.
    return new NextResponse('Attachment not found.', { status: 404 });
  }

  const { attachment, bytes } = found;
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': attachment.mimeType || 'application/octet-stream',
      'Content-Length': String(bytes.byteLength),
      'Content-Disposition': contentDisposition(attachment.filename),
      // Files are user data behind a session, and a shared cache must not keep a
      // copy; `private` is what makes that explicit to a proxy.
      'Cache-Control': 'private, no-store',
      // The type is whatever the upload claimed, so the browser is told not to
      // second-guess it — a `.txt` that sniffs as HTML would otherwise run.
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

export const DELETE = route(async ({ user, params }) => {
  const removed = await deleteOwnedAttachment(user.id, params.id);
  if (!removed) throw notFound('That attachment no longer exists.');
  return ok({ id: params.id, deleted: true });
});
