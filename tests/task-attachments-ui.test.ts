/**
 * Attachments, at the seams a unit test cannot reach.
 *
 * The service tests (`tests/attachments.test.ts`) cover the bytes, the row and the
 * two-user boundary. What they cannot cover is the wiring that makes the feature
 * exist at all: that both editors render the section, that the section posts
 * multipart instead of the JSON client, that the routes declare the Node runtime
 * (the SQLite driver and `fs` are not available on the edge), and that an upload
 * is never offered to the offline queue.
 *
 * These are source assertions on purpose — the same style as
 * `tests/task-editor-calendar-conversion.test.ts` — because the failure they
 * guard against is a line quietly disappearing, not a wrong return value.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { affectsFor, isQueueable } from '@/lib/offline-rules';

const source = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

const SECTION = 'src/components/attachments/AttachmentsSection.tsx';
const TASK_EDITOR = 'src/components/tasks/TaskEditorSheet.tsx';
const EVENT_EDITOR = 'src/components/calendar/EventEditorSheet.tsx';
const DETAIL_SHEET = 'src/components/tasks/ItemDetailSheet.tsx';
const LIST_ROUTE = 'src/app/api/attachments/route.ts';
const ITEM_ROUTE = 'src/app/api/attachments/[id]/route.ts';

describe('the section both editors share', () => {
  it('reads the owner from the record it was given, and only then', () => {
    const section = source(SECTION);
    expect(section).toContain("useResource<Attachment[]>(owner ? '/api/attachments' : null");
    expect(section).toContain("form.set(key, value)");
    expect(section).toContain("form.set('file', file, file.name)");
  });

  it('uploads multipart, never through the JSON client', () => {
    const section = source(SECTION);
    expect(section).toContain('api.upload<Attachment>');
    /* `api.post` would JSON-encode a FormData body into "{}". */
    expect(section).not.toMatch(/api\.post[^(]*\('\/api\/attachments'/);
  });

  it('invalidates through the offline rules rather than a hand-written list', () => {
    expect(source(SECTION)).toContain("affectsFor('POST', '/api/attachments')");
  });

  it('refuses oversized and empty files before the upload starts', () => {
    const section = source(SECTION);
    expect(section).toContain('file.size > MAX_ATTACHMENT_BYTES');
    expect(section).toContain('file.size === 0');
    expect(section).toContain('MAX_ATTACHMENT_LABEL');
  });

  it('fits the three places it is put in: sheet gutter, bordered card, detail fields', () => {
    const section = source(SECTION);
    expect(section).toContain('framed?: boolean;');
    expect(section).toContain('inline?: boolean;');
    expect(section).toContain('const edges = framed');
  });

  it('is wired into the task editor on the task it is editing', () => {
    const editor = source(TASK_EDITOR);
    expect(editor).toContain("import { AttachmentsSection } from '@/components/attachments/AttachmentsSection'");
    expect(editor).toContain('owner={task ? { taskId: task.id } : null}');
  });

  it('is wired into the event editor on the event, and honours a read-only calendar', () => {
    const editor = source(EVENT_EDITOR);
    expect(editor).toContain("import { AttachmentsSection } from '@/components/attachments/AttachmentsSection'");
    expect(editor).toContain('owner={event ? { eventId: event.id } : null}');
    expect(editor).toContain('readOnly={locked}');
  });

  it('has a surface for the read-only detail sheet, for tasks and events alike', () => {
    const sheet = source(DETAIL_SHEET);
    expect(sheet).toContain("import { AttachmentsSection } from '@/components/attachments/AttachmentsSection'");
    /* The detail sheet is what a list or calendar tap opens; a file you can only
     * reach by pressing Edit is a file most people never find. */
    expect(sheet).toContain('owner={task ? { taskId: item.id } : { eventId: item.id }}');
    expect(sheet).toContain('readOnly={isReadOnly}');
    /* `inline` drops the section's own horizontal padding so it lines up with
     * the sheet's Field rows instead of indenting away from them. */
    expect(sheet).toMatch(/<AttachmentsSection\s+inline\s+readOnly=\{isReadOnly\}/);
  });
});

describe('the routes', () => {
  it('run on the Node runtime', () => {
    for (const route of [LIST_ROUTE, ITEM_ROUTE]) {
      const text = source(route);
      expect(text).toContain("export const runtime = 'nodejs'");
      expect(text).toContain("export const dynamic = 'force-dynamic'");
    }
  });

  it('read the upload as multipart and check its size first', () => {
    const text = source(LIST_ROUTE);
    expect(text).toContain('multipart/form-data');
    expect(text).toContain('await req.formData()');
    expect(text).toContain('MAX_ATTACHMENT_BYTES');
    expect(text).toContain('413');
  });

  it('require an owner that resolves to this user’s own record', () => {
    const text = source(LIST_ROUTE);
    expect(text).toContain('resolveOwner');
    expect(text).toContain('getTask(');
    expect(text).toContain('getEvent(');
    /* "No owner" and "owner is gone" are different mistakes and get different
     * sentences, because only the second one means somebody else deleted it. */
    expect(text).toContain('Say which task or event the file belongs to.');
    expect(text).toContain('That task or event no longer exists.');
  });

  it('download with a filename and a no-sniff header', () => {
    const text = source(ITEM_ROUTE);
    expect(text).toContain('contentDisposition');
    expect(text).toContain("'Content-Disposition'");
    expect(text).toContain("'X-Content-Type-Options': 'nosniff'");
    /* Not a public file: only the owner's own browser cache may hold it. */
    expect(text).toContain("'Cache-Control': 'private, no-store'");
  });
});

describe('the offline rules', () => {
  it('invalidate only the attachments themselves', () => {
    expect(affectsFor('POST', '/api/attachments').sort()).toEqual(['/api/attachments']);
    expect(affectsFor('DELETE', '/api/attachments/abc').sort()).toEqual(['/api/attachments']);
  });

  it('never queue an upload', () => {
    /*
     * A queued write is JSON in IndexedDB. A file cannot survive that, and a
     * replayed upload without its bytes would create an empty attachment — so the
     * queue must decline the route entirely, not merely fail it later.
     */
    expect(isQueueable('POST', '/api/attachments')).toBe(false);
    expect(isQueueable('DELETE', '/api/attachments/abc')).toBe(false);
  });
});
