'use client';

/**
 * Task-list management: create, rename, recolour and delete.
 *
 * The settings screen owns calendars but never owned lists, and the only list
 * affordance on the tasks screen was the picker inside the task editor. The
 * sidebar's "New list" button has always routed to `/tasks?new=list`, but nothing
 * handled the parameter — so the button looked live and did nothing. This dialog
 * is the missing target: `TasksView` opens it on `?new=list`, and the editor's
 * `ListPicker` opens it from its "Manage lists" row.
 *
 * ## What the API already supports
 *
 * The server has had the whole lifecycle all along: `POST /api/lists` (create),
 * `PATCH /api/lists/[id]` (rename, recolour, describe, archive) and
 * `DELETE /api/lists/[id]` (delete; the server moves its tasks to the Inbox and
 * refuses to delete the Inbox itself with a 409). The client only lacked the
 * calls and the UI, so this adds `updateList`/`removeList` to `useTaskActions`
 * and paints them — no server or schema change.
 *
 * ## Shape
 *
 * Two views in one dialog rather than a manager plus a second dialog: the list of
 * lists, and the create/edit form. A nested overlay inside the picker's own
 * drawer is already a stack, so keeping the form in the same surface avoids a
 * third layer. The delete confirmation is the one nested dialog, because deleting
 * a list is destructive and the copy has to say where its tasks go.
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
import type { AccentColor, List as TaskList } from '@/lib/types';
import { cn } from '@/lib/utils';
import type { BootstrapPayload } from '@/lib/view-types';
import { useTaskActions } from './useTaskActions';

/** The colour a new list starts on; the Inbox's own accent. */
const DEFAULT_LIST_COLOR: AccentColor = 'blue';

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

export interface ListManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens straight into the create form — the sidebar's `?new=list`. */
  startInForm?: boolean;
}

export function ListManagerDialog({ open, onOpenChange, startInForm = false }: ListManagerDialogProps) {
  const { toast } = useToast();
  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');
  const zone = bootstrap.data?.settings.timezone ?? bootstrap.data?.user.timezone ?? 'utc';
  const lists = bootstrap.data?.lists ?? [];
  const actions = useTaskActions(zone);

  /** Which view is showing, and which list the form is editing (`null` = new). */
  const [inForm, setInForm] = useState(false);
  const [formList, setFormList] = useState<TaskList | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [name, setName] = useState('');
  const [color, setColor] = useState<AccentColor>(DEFAULT_LIST_COLOR);

  // Re-seed whenever the dialog opens, so `startInForm` is honoured and a stale
  // draft from the last open never leaks into this one.
  useEffect(() => {
    if (!open) {
      setInForm(false);
      setFormList(null);
      setConfirmDelete(false);
      return;
    }
    setInForm(startInForm);
    setFormList(null);
    setConfirmDelete(false);
  }, [open, startInForm]);

  useEffect(() => {
    if (!inForm) return;
    setName(formList?.name ?? '');
    setColor(formList?.color ?? DEFAULT_LIST_COLOR);
  }, [inForm, formList]);

  function close() {
    onOpenChange(false);
  }

  function openForm(list: TaskList | null) {
    setFormList(list);
    setInForm(true);
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || actions.isSaving) return;
    const saved = formList
      ? await actions.updateList(formList.id, { name: trimmed, color })
      : await actions.createList(trimmed, color);
    if (!saved) return; // the action already raised the failure toast
    toast({ title: formList ? 'List updated' : 'List created', variant: 'success' });
    void bootstrap.refresh();
    setInForm(false);
    setFormList(null);
  }

  async function remove() {
    if (!formList) return;
    const removed = await actions.removeList(formList.id);
    if (!removed) return;
    void bootstrap.refresh();
    setConfirmDelete(false);
    setInForm(false);
    setFormList(null);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={DIALOG_CLASS}>
          <DialogHeader className="shrink-0 gap-0 border-b border-border px-gutter py-stack">
            <DialogTitle>{inForm ? (formList ? 'Edit list' : 'New list') : 'Task lists'}</DialogTitle>
            <DialogDescription>
              {inForm
                ? 'The name and colour are saved together.'
                : 'Rename, recolour or delete a list, or add a new one.'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-stack overflow-y-auto px-gutter py-card">
            {inForm ? (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="task-list-name">Name</Label>
                  <Input
                    id="task-list-name"
                    value={name}
                    maxLength={200}
                    autoComplete="off"
                    autoFocus={!formList}
                    onChange={(event) => setName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void save();
                    }}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <p id="task-list-colour-label" className="text-sm font-medium">
                    Colour
                  </p>
                  <AccentSwatches value={color} onChange={setColor} labelledBy="task-list-colour-label" />
                </div>

                {formList && !formList.isInbox ? (
                  <Button
                    type="button"
                    variant="destructive"
                    className="w-full"
                    disabled={actions.isSaving}
                    onClick={() => setConfirmDelete(true)}
                  >
                    <TrashIcon className="size-4 text-base" />
                    Delete list
                  </Button>
                ) : null}
              </>
            ) : (
              <div className="flex flex-col gap-1">
                {lists.length === 0 ? (
                  <p className="text-sm text-muted-foreground">You have no lists yet. Add one to get started.</p>
                ) : (
                  lists.map((list) => (
                    <div key={list.id} className="flex min-h-11 items-center gap-3 rounded-lg px-row py-2">
                      {list.emoji ? (
                        <span aria-hidden className="flex size-5 shrink-0 items-center justify-center text-base">
                          {list.emoji}
                        </span>
                      ) : (
                        <span
                          aria-hidden
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: accentHex(list.color) }}
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm">{list.name}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit ${list.name}`}
                        onClick={() => openForm(list)}
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
                    setFormList(null);
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
                  {formList ? 'Save list' : 'Create list'}
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" className="flex-1" onClick={close}>
                  Done
                </Button>
                <Button type="button" className="flex-1" onClick={() => openForm(null)}>
                  <PlusIcon className="size-4 text-base" />
                  New list
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent showCloseButton={false} className="gap-0 p-0">
          <div className="flex flex-col gap-stack p-card">
            <DialogTitle>{`Delete ${formList?.name ?? 'this list'}?`}</DialogTitle>
            <DialogDescription>
              Its tasks are moved to the Inbox rather than deleted. This cannot be undone.
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
