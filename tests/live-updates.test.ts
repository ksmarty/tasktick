import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * These pin wiring, not behaviour: the poll, the token route and the one call that
 * turns a changed token into a refetch are three files that have to agree, and a
 * refactor can quietly unhook one of them. The behaviour itself is covered by
 * tests/change-token.test.ts (the token moves when a record does).
 */

const ROOT = process.cwd();

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), 'utf8');
}

const LIVE_SYNC = 'src/lib/live-sync.ts';
const TOKEN_ROUTE = 'src/app/api/sync/version/route.ts';
const CHANGE_REPO = 'src/server/repos/changes.ts';

describe('an open page notices a change it did not make', () => {
  it('polls a cheap server token instead of every read', () => {
    const source = read(LIVE_SYNC);
    expect(source).toContain('/api/sync/version');
    expect(source).toContain('POLL_INTERVAL_MS');
    /*
     * The fresh-read header is what keeps the service worker from answering the
     * poll out of its own cache — without it the token never moves and the page
     * never updates.
     */
    expect(source).toContain('FRESH_READ_HEADER');
  });

  it('compares the token and only then pays for a refetch', () => {
    const source = read(LIVE_SYNC);
    expect(source).toContain('if (token !== null && next !== token)');
    expect(source).toContain('await onChange()');
  });

  it('does not poll a page nobody is looking at, and catches up on return', () => {
    const source = read(LIVE_SYNC);
    expect(source).toContain("document.visibilityState === 'visible'");
    expect(source).toContain("'visibilitychange'");
    /*
     * setTimeout, not setInterval: a poll that outlives its own timeout would
     * stack up behind a slow server for as long as the tab stays open.
     */
    expect(source).toContain('setTimeout');
    expect(source).not.toMatch(/setInterval\(/);
  });

  it('is started by the one bridge that already runs in the browser', () => {
    const store = read('src/lib/store.ts');
    expect(store).toContain("import { startLiveSync } from './live-sync';");
    expect(store).toContain('startLiveSync({ onChange: () => invalidate(ALL_READ_PREFIXES) })');
    expect(store).toContain("const ALL_READ_PREFIXES = ['/api'];");
  });

  it('answers with a token that is never cached by a proxy or the browser', () => {
    const source = read(TOKEN_ROUTE);
    expect(source).toContain('changeToken(user.id)');
    expect(source).toContain("'Cache-Control', 'private, no-store'");
    expect(source).toContain("export const dynamic = 'force-dynamic'");
  });

  it('builds the token from counts and timestamps only, never from row bodies', () => {
    const source = read(CHANGE_REPO);
    for (const table of ['tasks', 'calendarEvents', 'habits', 'habitEntries', 'lists', 'tags']) {
      expect(source).toContain(`${table}.updatedAt`);
    }
    expect(source).toContain('cast(count(*) as text)');
    /*
     * Postgres hands `count(*)` back as a string and SQLite as a number. Casting
     * in SQL is what stops the same data producing two different tokens — which
     * would read as "everything changed" on every single poll.
     */
    expect(source).toContain('cast(');
  });
});

describe('a sheet that comes back from the background stays at the bottom', () => {
  const drawer = read('src/components/godui/drawer.tsx');

  it('only believes a keyboard inset while a text field has focus', () => {
    expect(drawer).toContain('const typing =');
    expect(drawer).toContain('/^(INPUT|TEXTAREA|SELECT)$/');
    expect(drawer).toContain('isContentEditable');
  });

  it('starts untrusted after a resume and waits for a real measurement', () => {
    expect(drawer).toContain('let trusted = true;');
    expect(drawer).toContain('const resumed = () => {');
    expect(drawer).toContain('trusted = false;');
    expect(drawer).toContain("visual.addEventListener('resize', measured)");
    for (const event of ['pageshow', 'orientationchange', 'visibilitychange']) {
      expect(drawer).toContain(`'${event}'`);
    }
  });
});

describe('opening a task or an event does not paint a ring', () => {
  const drawer = read('src/components/godui/drawer.tsx');

  it('gives the drawer a focus sink that does not outline itself', () => {
    expect(drawer).toContain('tabIndex={-1}');
    expect(drawer).toContain('outline-none');
  });

  it('leaves the editors focused on something inside the dialog', () => {
    expect(read('src/components/tasks/TaskEditorSheet.tsx')).toContain(
      '(event.target as HTMLElement).focus({ preventScroll: true })',
    );
    const eventEditor = read('src/components/calendar/EventEditorSheet.tsx');
    expect(eventEditor).toContain('(event.target as HTMLElement).focus({ preventScroll: true })');
    expect(eventEditor).toContain('titleRef.current?.focus({ preventScroll: true })');
  });
});

describe('attachments keep quiet and open in place', () => {
  const section = read('src/components/attachments/AttachmentsSection.tsx');

  it('does not announce an upload that already showed its own progress', () => {
    expect(section).not.toContain("'File attached'");
    expect(section).not.toMatch(/'[0-9] files added'/);
    // Removals are still worth a word: nothing else would confirm them.
    expect(section).toContain("'File removed'");
  });

  it('offers the delete only where the record is being edited', () => {
    expect(section).toContain('const removable = !readOnly && !inline;');
    expect(section).toContain('{removable ? (');
  });

  it('opens a preview instead of only downloading', () => {
    const preview = read('src/components/attachments/AttachmentPreview.tsx');
    expect(preview).toContain('attachmentPreviewKind');
    expect(preview).toContain('<iframe');
    expect(preview).toContain('<img');
    expect(section).toContain('setPreviewing(attachment)');
    expect(section).toContain('<AttachmentPreview');
  });

  it('serves the bytes inline so a preview does not land in the downloads folder', () => {
    const route = read('src/app/api/attachments/[id]/route.ts');
    expect(route).toContain("get('inline') === '1'");
    expect(route).toContain('inlineContentDisposition');
    expect(read('src/server/services/attachments.ts')).toContain(
      'export function inlineContentDisposition',
    );
  });
});

describe('a pasted maps link shows the place', () => {
  const links = read('src/lib/links.ts');
  const sheet = read('src/components/tasks/ItemDetailSheet.tsx');

  it('reads the pin out of the blob a share sheet emits', () => {
    expect(links).toContain('!3d');
    expect(links).toContain('!4d');
    expect(links).toContain('export function needsMapResolution');
    expect(links).toContain('export function mapsEmbedUrl');
  });

  it('renders the map inside the detail sheet, above the raw link', () => {
    expect(sheet).toContain('mapsEmbedUrl(');
    expect(sheet).toContain('needsMapResolution');
    expect(sheet).toContain('loading="lazy"');
    expect(sheet).toContain('/api/links/resolve');
  });

  it('resolves short links on the server, behind the same host guard as feeds', () => {
    const resolver = read('src/server/services/link-resolve.ts');
    expect(resolver).toContain("from './ical-fetch'");
    expect(resolver).toContain('assertPublicHost');
    expect(resolver).toContain('assertHost');
    expect(resolver).toContain('isGoogleMapsHost');
  });
});
