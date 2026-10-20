'use client';

/**
 * Tags, in settings.
 *
 * The tag dialog already existed — it is `TagManagerDialog`, opened from the
 * task editor's "Manage tags" row — and on a phone that was the *only* way in:
 * you had to be editing a task to fix a tag, which is a strange place to keep
 * housekeeping. The user's report was exactly that ("i still dont have a way on
 * mobile to add/modify/delete tags"), so this section is the missing door.
 *
 * The row is not only a button. It counts what is there and lists the colours,
 * because "how many tags do I actually have" was unanswerable without opening the
 * dialog, and the dialog is a full-screen surface on a phone.
 *
 * Everything that writes lives in the dialog; nothing here calls the API. That
 * keeps one code path for create/rename/recolour/delete rather than a second,
 * settings-shaped copy that could drift from it.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { TagManagerDialog } from '@/components/tasks/TagManagerDialog';
import { accentHex } from '@/lib/colors';
import { useResource } from '@/lib/store';
import type { BootstrapPayload } from '@/lib/view-types';
import { SettingsGroup, SettingsRow } from './SettingsGroup';

export function TagsSettings() {
  const [open, setOpen] = useState(false);
  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');
  const tags = bootstrap.data?.tags ?? [];

  return (
    <>
      <SettingsGroup
        title="Tags"
        footer="Tags are shared across tasks: renaming one renames it everywhere, and deleting one takes it off every task without touching the tasks."
      >
        <SettingsRow>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {tags.length === 0
                ? 'No tags yet'
                : `${tags.length} ${tags.length === 1 ? 'tag' : 'tags'}`}
            </p>
            <p className="text-xs text-muted-foreground">Add, rename, recolour or delete tags.</p>
          </div>
          <Button type="button" variant="outline" onClick={() => setOpen(true)}>
            Manage
          </Button>
        </SettingsRow>

        {tags.length ? (
          <SettingsRow stacked>
            <ul className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <li
                  key={tag.id}
                  className="flex items-center gap-1.5 rounded-full border border-border py-0.5 pr-2 pl-1.5 text-xs"
                >
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: accentHex(tag.color) }}
                  />
                  <span className="min-w-0 truncate">{tag.name}</span>
                </li>
              ))}
            </ul>
          </SettingsRow>
        ) : null}
      </SettingsGroup>

      <TagManagerDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
