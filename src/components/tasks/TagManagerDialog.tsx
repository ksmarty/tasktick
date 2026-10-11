'use client';

/**
 * Tag management: create, rename, recolour and delete.
 *
 * Tags had no surface of their own. The only way to make one was the tag
 * picker's inline field, and the only way to get rid of one was to stop using
 * it — so a typo, a rename or a duplicate was permanent. This dialog is the
 * missing surface: `TaskEditorSheet` opens it from the picker's "Manage tags"
 * row, the same way the list picker opens `ListManagerDialog`.
 *
 * ## What the API already supports
 *
 * The whole lifecycle has been on the server all along: `POST /api/tags`
 * (create), `PATCH /api/tags/[id]` (rename, recolour) and `DELETE /api/tags/[id]`
 * (delete — the server detaches the tag from every task that carried it and
 * leaves the tasks alone). `PUT /api/tags` merges a duplicate into another, and
 * is deliberately not offered here: it is a data-repair tool, not an everyday
 * edit, and a merge picker inside a drawer inside a dialog is a third layer for
 * something the delete path already covers. The client only lacked the calls and
 * the UI, so this adds `updateTag`/`removeTag` to `useTaskActions` and paints
 * them — no server or schema change.
 *
 * ## Shape
 *
 * Two views in one dialog rather than a manager plus a second dialog, exactly as
 * `ListManagerDialog` does it: the list of tags, and the create/edit form. The
 * delete confirmation is the one nested dialog, because deleting a tag is
 * destructive and the copy has to say what happens to the tasks wearing it.
 */
import { useEffect, useState } from 'react';
import { Pencil1Icon } from '@svg-animated-icons/react/pencil-1';
import { PlusIcon } from '@svg-animated-icons/react/plus';
import { TrashIcon } from '@svg-animated-icons/react/trash';
import { useToast } from '@/components/app/Toast';
import { AccentSwatches } from '@/components/settings/swatches';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { accentHex } from '@/lib/colors';
import { useResource } from '@/lib/store';
import type { AccentColor, Tag } from '@/lib/types';
import { cn } from '@/lib/utils';
import type { BootstrapPayload } from '@/lib/view-types';
import { useTaskActions } from './useTaskActions';

/** The colour the server gives a tag created without one. */
const DEFAULT_TAG_COLOR: AccentColor = 'gray';

/**
 * A settings-shaped sheet: full-screen on a phone, a centred card above it.
 * The same responsive utilities the settings dialogs use, stated locally so this
 * feature does not reach into that folder for one class string.
 */
const DIALOG_CLASS = cn(
  'flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0',
  'max-sm:inset-0 max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0',
  'sm:max-w-lg',
);

export interface TagManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** "Used by 3 tasks" / "Not on any task" — the count the delete copy needs. */
function usageLabel(count: number | undefined): string {
  const n = count ?? 0;
  if (n === 0) return 'Not on any task';
  return `Used by ${n} ${n === 1 ? 'task' : 'tasks'}`;
}

export function TagManagerDialog({ open, onOpenChange }: TagManagerDialogProps) {
  const { toast } = useToast();
  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');
  const zone = bootstrap.data?.settings.timezone ?? bootstrap.data?.user.timezone ?? 'utc';
  const tags = bootstrap.data?.tags ?? [];
  const actions = useTaskActions(zone);

  /** Which view is showing, and which tag the form is editing (`null` = new). */
  const [inForm, setInForm] = useState(false);
  const [formTag, setFormTag] = useState<Tag | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [name, setName] = useState('');
  const [color, setColor] = useState<AccentColor>(DEFAULT_TAG_COLOR);

  // Re-seed whenever the dialog opens, so a stale draft from the last open never
  // leaks into this one.
  useEffect(() => {
    if (!open) {
      setInForm(false);
      setFormTag(null);
      setConfirmDelete(false);
    }
  }, [open]);

  useEffect(() => {
    if (!inForm) return;
    setName(formTag?.name ?? '');
    setColor(formTag?.color ?? DEFAULT_TAG_COLOR);
  }, [inForm, formTag]);

  function close() {
    onOpenChange(false);
  }

  function openForm(tag: Tag | null) {
    setFormTag(tag);
    setInForm(true);
  }

  async function save() {
    const trimmed = name.trim().replace(/^#/, '');
    if (!trimmed || actions.isSaving) return;
    const saved = formTag
      ? await actions.updateTag(formTag.id, { name: trimmed, color })
      : await actions.createTag(trimmed, color);
    if (!saved) return; // the action already raised the failure toast
    toast({ title: formTag ? 'Tag updated' : 'Tag created', variant: 'success' });
    void bootstrap.refresh();
    setInForm(false);
    setFormTag(null);
  }

  async function remove() {
    if (!formTag) return;
    const removed = await actions.removeTag(formTag.id);
    if (!removed) return;
    void bootstrap.refresh();
    setConfirmDelete(false);
    setInForm(false);
    setFormTag(null);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={DIALOG_CLASS}>
          <DialogHeader className="shrink-0 gap-0 border-b border-border px-gutter py-stack">
            <DialogTitle>{inForm ? (formTag ? 'Edit tag' : 'New tag') : 'Tags'}</DialogTitle>
            <DialogDescription>
              {inForm
                ? 'The name and colour are saved together.'
                : 'Rename, recolour or delete a tag, or add a new one.'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-stack overflow-y-auto px-gutter py-card">
            {inForm ? (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="task-tag-name">Name</Label>
                  <Input
                    id="task-tag-name"
                    value={name}
                    maxLength={60}
                    autoComplete="off"
                    autoFocus={!formTag}
                    onChange={(event) => setName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void save();
                    }}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <p id="task-tag-colour-label" className="text-sm font-medium">
                    Colour
                  </p>
                  {/* A tag has a colour, so there is no neutral swatch to ignore. */}
                  <AccentSwatches
                    value={color}
                    onChange={(next) => next && setColor(next)}
                    labelledBy="task-tag-colour-label"
                  />
                </div>

                {formTag ? (
                  <Button
                    type="button"
                    variant="destructive"
                    className="w-full"
                    disabled={actions.isSaving}
                    onClick={() => setConfirmDelete(true)}
                  >
                    <TrashIcon className="size-4 text-base" />
                    Delete tag
                  </Button>
                ) : null}
              </>
            ) : (
              <div className="flex flex-col gap-1">
                {tags.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    You have no tags yet. Add one to get started.
                  </p>
                ) : (
                  tags.map((tag) => (
                    <div key={tag.id} className="flex min-h-11 items-center gap-3 rounded-lg px-row py-2">
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: accentHex(tag.color) }}
                      />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm">{tag.name}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {usageLabel(tag.taskCount)}
                        </span>
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit ${tag.name}`}
                        onClick={() => openForm(tag)}
                      >
                        <Pencil1Icon className="size-4 text-base" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <DialogFooter className="shrink-0 border-t border-border px-gutter pt-stack pb-[max(0.25rem,env(safe-area-inset-bottom,0px))]">
            {inForm ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  className="flex-1"
                  onClick={() => {
                    setInForm(false);
                    setFormTag(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="flex-1"
                  aria-busy={actions.isSaving || undefined}
                  disabled={!name.trim() || actions.isSaving}
                  onClick={() => void save()}
                >
                  {formTag ? 'Save tag' : 'Create tag'}
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" className="flex-1" onClick={close}>
                  Done
                </Button>
                <Button type="button" className="flex-1" onClick={() => openForm(null)}>
                  <PlusIcon className="size-4 text-base" />
                  New tag
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent showCloseButton={false} className="gap-0 p-0">
          <div className="flex flex-col gap-stack p-card">
            <DialogTitle>{`Delete #${formTag?.name ?? 'this tag'}?`}</DialogTitle>
            <DialogDescription>
              {`It is removed from every task that carries it${
                formTag?.taskCount ? ` (${formTag.taskCount})` : ''
              }. The tasks themselves stay. This cannot be undone.`}
            </DialogDescription>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={actions.isSaving}
                onClick={() => void remove()}
              >
                Delete
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
