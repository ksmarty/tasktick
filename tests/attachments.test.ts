/**
 * Attached files: the bytes, the row, and who may see them.
 *
 * Everything here runs against a real migrated SQLite file and a real temporary
 * attachments directory, because the interesting failures are not type errors:
 * a row that outlives its bytes, bytes that outlive their row, a file served to
 * the wrong account, or — the one that would be worst — a task's files being
 * dropped by the foreign key when that task is converted into an event.
 *
 * The route handlers themselves are thin enough that the service is where the
 * rules live; the routes are covered by the storage-mode assertions in
 * `tests/task-attachments-ui.test.ts` and by being impossible to reach without
 * an owner (see `resolveOwner` in `src/app/api/attachments/route.ts`).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCalendar, createEvent } from '@/server/repos/calendars';
import { createTask } from '@/server/repos/tasks';
import { MAX_ATTACHMENT_BYTES, formatFileSize, isPreviewableImage } from '@/lib/attachments';
import {
  AttachmentError,
  attachmentsDir,
  cleanFilename,
  contentDisposition,
  deleteOwnedAttachment,
  listOwnedAttachments,
  readAttachment,
  saveAttachment,
} from '@/server/services/attachments';
import { convertTaskToEvent } from '@/server/services/task-to-event';
import { disposeTempDatabase, seedAccount, useTempDatabase } from './sync-helpers';

const ZONE = 'UTC';

let databaseFile = '';
let storageDir = '';
let previousStorageDir: string | undefined;

beforeEach(async () => {
  /*
   * The directory has to be set before `useTempDatabase()` because that is what
   * resets the env cache — and because a default of `./data/attachments` would
   * write test files into the checkout.
   */
  previousStorageDir = process.env.ATTACHMENTS_DIR;
  storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasktick-files-'));
  process.env.ATTACHMENTS_DIR = storageDir;

  databaseFile = await useTempDatabase();
});

afterEach(async () => {
  await disposeTempDatabase(databaseFile);
  fs.rmSync(storageDir, { recursive: true, force: true });
  if (previousStorageDir === undefined) delete process.env.ATTACHMENTS_DIR;
  else process.env.ATTACHMENTS_DIR = previousStorageDir;
});

function textFile(name: string, body: string, mimeType = 'text/plain') {
  return { filename: name, mimeType, bytes: new TextEncoder().encode(body) };
}

/** Every file currently under the storage root, as relative paths. */
function storedFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(attachmentsDir(), full));
    }
  };
  if (fs.existsSync(attachmentsDir())) walk(attachmentsDir());
  return out.sort();
}

describe('saving a file', () => {
  it('writes the bytes under the user, keeps the name, and lists it on its owner', async () => {
    const account = await seedAccount();
    const task = await createTask(account.userId, { title: 'Ship it' }, ZONE);

    const attachment = await saveAttachment(account.userId, { taskId: task.id }, textFile('proposal.txt', 'two pages'));

    expect(attachment.filename).toBe('proposal.txt');
    expect(attachment.mimeType).toBe('text/plain');
    expect(attachment.sizeBytes).toBe(9);
    expect(attachment.taskId).toBe(task.id);
    expect(attachment.eventId).toBeNull();
    /* The storage key is the server's business and is not part of the API shape. */
    expect(Object.keys(attachment)).not.toContain('storageKey');

    expect(storedFiles()).toEqual([path.join(account.userId, attachment.id).split(path.sep).join(path.sep)]);

    const listed = await listOwnedAttachments(account.userId, { taskId: task.id });
    expect(listed.map((row) => row.id)).toEqual([attachment.id]);

    const read = await readAttachment(account.userId, attachment.id);
    expect(new TextDecoder().decode(read?.bytes)).toBe('two pages');
  });

  it('attaches to an event too, through the same path', async () => {
    const account = await seedAccount();
    const calendar = await createCalendar(account.userId, { name: 'Personal' }, ZONE);
    const start = Date.parse('2024-03-05T10:00:00Z');
    const event = await createEvent(
      account.userId,
      { calendarId: calendar.id, summary: 'Kickoff', startMs: start, endMs: start + 3_600_000, timezone: ZONE },
      ZONE,
    );

    const attachment = await saveAttachment(
      account.userId,
      { eventId: event.id },
      { filename: 'agenda.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([1, 2, 3]) },
    );

    expect(attachment.eventId).toBe(event.id);
    expect(attachment.taskId).toBeNull();
    expect((await listOwnedAttachments(account.userId, { eventId: event.id })).map((row) => row.id)).toEqual([
      attachment.id,
    ]);
  });

  it('keeps two accounts apart, both in the list and on the download', async () => {
    const first = await seedAccount();
    const second = await seedAccount();
    const task = await createTask(first.userId, { title: 'Mine' }, ZONE);

    const mine = await saveAttachment(first.userId, { taskId: task.id }, textFile('private.txt', 'mine'));

    expect(await listOwnedAttachments(second.userId, { taskId: task.id })).toEqual([]);
    /* Not a 403: the row does not exist for this caller, so the answer is 404. */
    expect(await readAttachment(second.userId, mine.id)).toBeNull();
    expect(await deleteOwnedAttachment(second.userId, mine.id)).toBe(false);
    expect(storedFiles().length).toBe(1);
  });

  it('refuses an empty file and one over the limit', async () => {
    const account = await seedAccount();
    const task = await createTask(account.userId, { title: 'Sizes' }, ZONE);

    await expect(
      saveAttachment(account.userId, { taskId: task.id }, { filename: 'nothing.txt', mimeType: 'text/plain', bytes: new Uint8Array(0) }),
    ).rejects.toBeInstanceOf(AttachmentError);

    const oversized = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
    await expect(
      saveAttachment(account.userId, { taskId: task.id }, { filename: 'huge.bin', mimeType: 'application/octet-stream', bytes: oversized }),
    ).rejects.toMatchObject({ status: 413 });

    /* A refusal leaves nothing behind, on disk or in the table. */
    expect(storedFiles()).toEqual([]);
    expect(await listOwnedAttachments(account.userId, { taskId: task.id })).toEqual([]);
  });
});

describe('removing a file', () => {
  it('deletes the row and the bytes', async () => {
    const account = await seedAccount();
    const task = await createTask(account.userId, { title: 'Clean up' }, ZONE);
    const attachment = await saveAttachment(account.userId, { taskId: task.id }, textFile('note.txt', 'x'));

    expect(await deleteOwnedAttachment(account.userId, attachment.id)).toBe(true);
    expect(await listOwnedAttachments(account.userId, { taskId: task.id })).toEqual([]);
    expect(await readAttachment(account.userId, attachment.id)).toBeNull();
    expect(storedFiles()).toEqual([]);
  });

  it('answers a second delete with "no such file" rather than throwing', async () => {
    const account = await seedAccount();
    const task = await createTask(account.userId, { title: 'Twice' }, ZONE);
    const attachment = await saveAttachment(account.userId, { taskId: task.id }, textFile('note.txt', 'x'));

    expect(await deleteOwnedAttachment(account.userId, attachment.id)).toBe(true);
    expect(await deleteOwnedAttachment(account.userId, attachment.id)).toBe(false);
  });
});

describe('names and headers', () => {
  it('strips a path out of the name the browser sent', () => {
    expect(cleanFilename('../../etc/passwd')).toBe('passwd');
    expect(cleanFilename('C:\\Users\\me\\photo.png')).toBe('photo.png');
    /* Control characters would break a header and mean nothing in a name. */
    expect(cleanFilename('a\u0000b\u001fc.txt')).toBe('abc.txt');
    expect(cleanFilename('   ')).toBe('attachment');
    expect(cleanFilename('')).toBe('attachment');
    expect(cleanFilename(`${'n'.repeat(400)}.txt`).length).toBe(180);
  });

  it('keeps a UTF-8 name readable in the header', () => {
    const header = contentDisposition('Résumé — final.pdf');
    expect(header.startsWith('attachment; filename="')).toBe(true);
    expect(header).toContain(`filename*=UTF-8''${encodeURIComponent('Résumé — final.pdf')}`);
    /* The quoted fallback is ASCII-only, which is what an old client reads. */
    expect(header).toMatch(/filename="[\x20-\x7e]*"/);
  });
});

describe('converting a task keeps its files', () => {
  it('moves them onto the event instead of letting the cascade take them', async () => {
    const account = await seedAccount();
    const calendar = await createCalendar(account.userId, { name: 'Personal' }, ZONE);
    const task = await createTask(
      account.userId,
      { title: 'Has a file', dueDate: '2024-03-05', dueTime: '09:30', timezone: ZONE },
      ZONE,
    );
    const attachment = await saveAttachment(account.userId, { taskId: task.id }, textFile('brief.txt', 'read me'));

    const result = await convertTaskToEvent(account.userId, task.id, calendar.id, ZONE);

    expect(await listOwnedAttachments(account.userId, { taskId: task.id })).toEqual([]);
    const onEvent = await listOwnedAttachments(account.userId, { eventId: result.eventId });
    expect(onEvent.map((row) => row.id)).toEqual([attachment.id]);
    /* The file itself never moved, so its bytes are still readable by id. */
    expect(new TextDecoder().decode((await readAttachment(account.userId, attachment.id))?.bytes)).toBe('read me');
  });
});

describe('the client-side helpers', () => {
  it('says a size in the unit a person would use', () => {
    expect(formatFileSize(0)).toBe('0 KB');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2048)).toBe('2 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5 MB');
    expect(formatFileSize(9.4 * 1024 * 1024)).toBe('9.4 MB');
    /* Above ten the decimal is noise, so it is rounded away. */
    expect(formatFileSize(12.5 * 1024 * 1024)).toBe('13 MB');
  });

  it('previews the image types a browser renders, and not SVG', () => {
    expect(isPreviewableImage('image/png')).toBe(true);
    expect(isPreviewableImage('image/JPEG')).toBe(true);
    expect(isPreviewableImage('image/gif')).toBe(true);
    /* An SVG is a document that can carry script; it is a download, not a thumbnail. */
    expect(isPreviewableImage('image/svg+xml')).toBe(false);
    expect(isPreviewableImage('application/pdf')).toBe(false);
  });
});
