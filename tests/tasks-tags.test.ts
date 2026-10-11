/**
 * Guards for tag management, the thicker task checkbox and the quick-add field's
 * punctuation.
 *
 * All three are client-side contracts that cannot be rendered here (node, no
 * DOM): a manager dialog that has to reach the right endpoints, a checkbox whose
 * outline is a Tailwind class, and an input attribute iOS reads to decide whether
 * a double space becomes a period. So this pins the source instead.
 *
 * The server half already existed — `PATCH /api/tags/[id]` and
 * `DELETE /api/tags/[id]` — and is not re-tested here beyond the paths the client
 * is asserted to call.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(relativeToSrc: string): string {
  return readFileSync(new URL(`../src/${relativeToSrc}`, import.meta.url), 'utf8');
}

function source(relative: string): string {
  return read(`components/tasks/${relative}`);
}

const ACTIONS = source('useTaskActions.ts');
const MANAGER = source('TagManagerDialog.tsx');
const PICKER = source('TagPicker.tsx');
const EDITOR = source('TaskEditorSheet.tsx');
const QUICK_ADD = source('QuickAddBar.tsx');
const ROW = source('TaskRow.tsx');
const SUBTASKS = source('SubTaskList.tsx');

describe('tag management', () => {
  it('writes through the endpoints the server already had', () => {
    expect(ACTIONS).toContain('await api.patch<Tag>(`/api/tags/${id}`, input)');
    expect(ACTIONS).toContain('await api.delete<{ deleted: boolean }>(`/api/tags/${id}`)');
    expect(ACTIONS).toContain("await api.post<Tag>('/api/tags', color ? { name, color } : { name })");
  });

  it('invalidates from the affects table rather than a hand-written list', () => {
    /*
     * The prefixes have to come from `affectsFor`, or a tag rename would leave
     * the task rows carrying the old name on screen. The tag row is also what
     * covers the `/api/tags/<id>` paths, which is why no new rule was needed.
     */
    expect(ACTIONS).toContain("const TAG_WRITE_PREFIXES: string[] = affectsFor('POST', '/api/tags');");
    expect(ACTIONS).toContain('invalidates: TAG_WRITE_PREFIXES');
    expect(ACTIONS.match(/invalidates: TAG_WRITE_PREFIXES/g)).toHaveLength(3);
  });

  it('refuses a tag write while offline, like every other write here', () => {
    expect(ACTIONS).toContain('const updateTag = useCallback(');
    expect(ACTIONS).toContain('const removeTag = useCallback(');
    expect(ACTIONS).toContain('return tagPatchMutation.run(id, input);');
    expect(ACTIONS).toContain('const result = await tagRemoveMutation.run(id);');
    expect(ACTIONS.match(/if \(refuseWhenOffline\(\)\) return (undefined|false);/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('says what deleting does to the tasks wearing the tag', () => {
    expect(ACTIONS).toContain("title: 'Tag deleted'");
    expect(ACTIONS).toContain("description: 'It was removed from every task that carried it.'");
    expect(MANAGER).toContain('The tasks themselves stay.');
  });

  it('offers the lifecycle in one dialog, with a confirmation before the delete', () => {
    expect(MANAGER).toContain('updateTag');
    expect(MANAGER).toContain('removeTag');
    expect(MANAGER).toContain('createTag');
    expect(MANAGER).toContain("'Edit tag'");
    expect(MANAGER).toContain('<AccentSwatches');
    expect(MANAGER).toContain('usageLabel(tag.taskCount)');
    expect(MANAGER).toContain('Delete tag');
    expect(MANAGER).toContain('const [confirmDelete, setConfirmDelete] = useState(false);');
  });

  it('is reachable from the picker, and hosted by the editor that owns it', () => {
    expect(PICKER).toContain('onManage?: () => void;');
    expect(PICKER).toContain('Manage tags');
    expect(EDITOR).toContain('onManage={() => setManageTags(true)}');
    expect(EDITOR).toContain('<TagManagerDialog open={manageTags} onOpenChange={setManageTags} />');
    // The manager must outlive the picker's drawer, so Escape cannot close the
    // editor out from under it either.
    expect(EDITOR).toContain('if (picker || confirmOpen || manageLists || manageTags) event.preventDefault();');
  });
});

describe('the task checkbox is thicker', () => {
  it('overrides the primitive’s hairline border on the row and on a subtask', () => {
    expect(ROW).toContain("'size-5 border-2'");
    expect(SUBTASKS).toContain('className="border-2"');
  });
});

describe('the quick-add field has no smart punctuation', () => {
  it('turns auto-correction off, which is what disables the double-space period', () => {
    /*
     * iOS's "double space inserts a period" belongs to auto-correction for the
     * field, not to `inputMode` or to `spellCheck` — so `autoCorrect="off"` is
     * the switch, and the underline is off for the same reason.
     */
    expect(QUICK_ADD).toContain('autoCorrect="off"');
    expect(QUICK_ADD).toContain('spellCheck={false}');
  });
});
