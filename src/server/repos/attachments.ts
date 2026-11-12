/**
 * Attachment metadata repository.
 *
 * The bytes are somebody else's problem (`services/attachments.ts`); this module
 * only owns the row that says who a file belongs to, what it is called, and how
 * big it is. Two rules it is responsible for:
 *
 *  1. **One owner.** A file belongs to a task *or* to an event, never both and
 *     never neither. The schema leaves both columns nullable because the parents
 *     are different tables, so the pairing is enforced here — a row owned by
 *     nothing would be a file no API can list and no cascade can clean up.
 *
 *  2. **Never by id alone.** Every read and write takes the user id too, and the
 *     `where` clause carries both. A download route that resolved an id without
 *     it would hand one account's file to another.
 */
import { and, asc, eq } from 'drizzle-orm';
import { getDb, type Db } from '../db';
import { attachments } from '../db/schema';
import { newId } from '../crypto';
import type { Attachment } from '@/lib/types';

/** Which record the file hangs off. Exactly one key, by construction. */
export type AttachmentOwner = { taskId: string } | { eventId: string };

/**
 * What the service hands over to record a file.
 *
 * `taskId`/`eventId` are two optional columns rather than an `AttachmentOwner`
 * union because the row is written with both fields present and one of them null;
 * `createAttachment` is what refuses both and neither.
 */
export interface CreateAttachmentInput {
  /**
   * The row id. Supplied by the service so the storage key can be derived from it
   * before the row exists — otherwise the bytes and the row would be named by two
   * different ids and the link between them would be an accident of ordering.
   */
  id?: string;
  taskId?: string | null;
  eventId?: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Server-generated path under the attachments directory, e.g. `<userId>/<id>`. */
  storageKey: string;
}

/** The row plus where its bytes live. Server-side only — never serialised. */
export interface AttachmentWithStorage extends Attachment {
  storageKey: string;
}

function rowToAttachment(row: typeof attachments.$inferSelect): Attachment {
  return {
    id: row.id,
    userId: row.userId,
    taskId: row.taskId,
    eventId: row.eventId,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function ownerCondition(owner: AttachmentOwner) {
  return 'taskId' in owner ? eq(attachments.taskId, owner.taskId) : eq(attachments.eventId, owner.eventId);
}

/** Records one attachment. The bytes are written by the caller, before this. */
export async function createAttachment(
  userId: string,
  input: CreateAttachmentInput,
  executor: Db = getDb(),
): Promise<Attachment> {
  const taskId = input.taskId ?? null;
  const eventId = input.eventId ?? null;
  if (Boolean(taskId) === Boolean(eventId)) {
    throw new Error('An attachment belongs to exactly one task or event.');
  }

  const row: typeof attachments.$inferInsert = {
    id: input.id ?? newId(),
    userId,
    taskId,
    eventId,
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    storageKey: input.storageKey,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await executor.insert(attachments).values(row);
  return rowToAttachment(row as typeof attachments.$inferSelect);
}

/** A task's or an event's files, in the order they were added. */
export async function listAttachments(
  userId: string,
  owner: AttachmentOwner,
  executor: Db = getDb(),
): Promise<Attachment[]> {
  const rows = await executor
    .select()
    .from(attachments)
    .where(and(eq(attachments.userId, userId), ownerCondition(owner)))
    .orderBy(asc(attachments.createdAt));
  return rows.map(rowToAttachment);
}

/** One attachment, without its storage key — the shape the API returns. */
export async function getAttachment(
  userId: string,
  id: string,
  executor: Db = getDb(),
): Promise<Attachment | null> {
  const rows = await executor
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, id), eq(attachments.userId, userId)))
    .limit(1);
  return rows[0] ? rowToAttachment(rows[0]) : null;
}

/** One attachment with the key its bytes are at, for a download. */
export async function getAttachmentWithStorage(
  userId: string,
  id: string,
  executor: Db = getDb(),
): Promise<AttachmentWithStorage | null> {
  const rows = await executor
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, id), eq(attachments.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { ...rowToAttachment(row), storageKey: row.storageKey };
}

/**
 * Removes the row and reports what it was, so the caller can delete the bytes.
 *
 * Returns null when nothing matched — already gone, or not this user's — which
 * the API turns into a 404 rather than pretending the delete happened.
 */
export async function deleteAttachment(
  userId: string,
  id: string,
  executor: Db = getDb(),
): Promise<AttachmentWithStorage | null> {
  const rows = await executor
    .delete(attachments)
    .where(and(eq(attachments.id, id), eq(attachments.userId, userId)))
    .returning();
  const row = rows[0];
  if (!row) return null;
  return { ...rowToAttachment(row), storageKey: row.storageKey };
}

/**
 * Re-points files from one owner to another.
 *
 * Two callers, and they are the same operation in opposite directions: a
 * conversion moves a task's files onto the event that task became, and a
 * conversion that fails half way moves them back. One function, so the two
 * cannot disagree about what "moved" means.
 *
 * Why this exists at all: the foreign key cascades on delete, so converting a
 * task would take its attachments with it — silently, in the step where the user
 * was told their work carries over. Files are the one thing a conversion cannot
 * recreate, so they follow the record instead of being dropped by a cascade.
 * Returns how many moved, which is what a test can assert on.
 */
export async function moveAttachments(
  userId: string,
  from: AttachmentOwner,
  to: AttachmentOwner,
  executor: Db = getDb(),
): Promise<number> {
  const rows = await executor
    .update(attachments)
    .set({
      taskId: 'taskId' in to ? to.taskId : null,
      eventId: 'eventId' in to ? to.eventId : null,
      updatedAt: Date.now(),
    })
    .where(and(eq(attachments.userId, userId), ownerCondition(from)))
    .returning({ id: attachments.id });
  return rows.length;
}
