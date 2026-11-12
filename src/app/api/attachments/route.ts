/**
 * Attachments: list a record's files, and upload one to it.
 *
 * A file belongs to a task or to an event, so both verbs take exactly one owner.
 * The upload is `multipart/form-data`, which is the one place in this API that is
 * not JSON — a 20 MB file base64'd into JSON would be 27 MB of text and a `fetch`
 * that buffers it twice. `req.formData()` streams it instead.
 *
 * The size ceiling is checked from `Content-Length` *before* the body is parsed,
 * because the cheapest rejection is the one that never reads the upload, and again
 * against the actual bytes in `saveAttachment`, because a header is a claim.
 */
import { ApiError, badRequest, fail, notFound, ok, route } from '@/server/http';
import { MAX_ATTACHMENT_BYTES } from '@/lib/attachments';
import { getEvent } from '@/server/repos/calendars';
import { getTask } from '@/server/repos/tasks';
import type { AttachmentOwner } from '@/server/repos/attachments';
import {
  AttachmentError,
  listOwnedAttachments,
  saveAttachment,
} from '@/server/services/attachments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Slack on top of the file limit for the multipart envelope, field headers and
 * the owner id. Anything above `MAX_ATTACHMENT_BYTES + this` is certainly not one
 * file we would accept, so it is refused without being read.
 */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/**
 * Resolves the owner named in the request, checking it really is this user's.
 *
 * Without this the id would only have to exist: a caller could hand a task id
 * from another account to the insert and write a row that account's UI would
 * render. The repositories already scope by user, so this is one extra query for
 * a guarantee the rest of the app relies on everywhere.
 */
async function resolveOwner(
  userId: string,
  taskId: string | null,
  eventId: string | null,
): Promise<AttachmentOwner | null> {
  if (Boolean(taskId) === Boolean(eventId)) return null;
  if (taskId) {
    const task = await getTask(userId, taskId);
    return task ? { taskId } : null;
  }
  const event = await getEvent(userId, eventId as string);
  return event ? { eventId: eventId as string } : null;
}

export const GET = route(async ({ user, req }) => {
  const params = new URL(req.url).searchParams;
  const owner = await resolveOwner(user.id, params.get('taskId'), params.get('eventId'));
  if (!owner) throw badRequest('Ask for one task’s or one event’s attachments.');
  return ok(await listOwnedAttachments(user.id, owner));
});

export const POST = route(async ({ user, req }) => {
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('multipart/form-data')) {
    throw badRequest('Send the upload as multipart/form-data.');
  }

  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_ATTACHMENT_BYTES + MULTIPART_OVERHEAD_BYTES) {
    throw new ApiError(
      `That file is too large. The limit is ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB per file.`,
      413,
      'too_large',
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest('The upload could not be read. Try again.');
  }

  const file = form.get('file');
  if (!file || typeof file === 'string') throw badRequest('Attach the file in the “file” field.');

  const taskId = typeof form.get('taskId') === 'string' ? (form.get('taskId') as string) : null;
  const eventId = typeof form.get('eventId') === 'string' ? (form.get('eventId') as string) : null;
  /* A missing owner is the caller's mistake; an owner that does not resolve is a
   * race with a delete. Saying which one it is keeps the two sentences honest. */
  if (!taskId && !eventId) throw badRequest('Say which task or event the file belongs to.');
  const owner = await resolveOwner(user.id, taskId, eventId);
  if (!owner) throw notFound('That task or event no longer exists.');

  const bytes = new Uint8Array(await (file as File).arrayBuffer());
  try {
    const attachment = await saveAttachment(user.id, owner, {
      filename: (file as File).name || 'attachment',
      mimeType: (file as File).type || 'application/octet-stream',
      bytes,
    });
    return ok(attachment, 201);
  } catch (error) {
    if (error instanceof AttachmentError) return fail(error.message, error.status);
    throw error;
  }
});
