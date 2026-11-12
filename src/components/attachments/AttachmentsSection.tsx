'use client';

/**
 * Attached files, inside whichever editor is open.
 *
 * One component for tasks and for events, because the two differ in nothing the
 * user can see: a file has a name, a size and a download, and the record it hangs
 * off is an id either way. The editors pass that id and nothing else, so a change
 * to how attachments look lands in both at once instead of in whichever one was
 * remembered.
 *
 * ## Why the upload is not optimistic
 *
 * Every other write in the app shows its effect immediately and reconciles after.
 * An upload cannot: the id, the size and the download URL are the server's, and
 * until the bytes are stored there is no row to draw. So the row appears when the
 * upload finishes, and while it is running the button says so. That is also why
 * an upload is refused — not queued — while offline: the offline queue holds JSON,
 * and a file cannot be rebuilt from it later.
 *
 * ## Removing is two steps, not a hold
 *
 * Deleting one file is small enough that a hold on every row would be noise in a
 * list you scroll, and permanent enough that a single mis-tap would lose the only
 * copy. The row asks once, in place (`Remove`/`Keep`), which is enough for a
 * decision this size and costs no dialog.
 */
import { useRef, useState } from 'react';
import { useToast } from '@/components/app/Toast';
import { FileIcon } from '@svg-animated-icons/react/file';
import { DownloadIcon } from '@svg-animated-icons/react/download';
import { PlusIcon } from '@svg-animated-icons/react/plus';
import { TrashIcon } from '@svg-animated-icons/react/trash';
import { Button } from '@/components/ui/button';
import { api, errorMessage } from '@/lib/api-client';
import { formatFileSize, isPreviewableImage, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_LABEL } from '@/lib/attachments';
import { affectsFor } from '@/lib/offline-rules';
import { invalidate, useOnline, useResource } from '@/lib/store';
import type { Attachment } from '@/lib/types';
import { cn } from '@/lib/utils';

/** The record the files belong to. An attachment has exactly one owner. */
export type AttachmentOwnerRef = { taskId: string } | { eventId: string };

/*
 * Derived from the offline rules, not written here: `tests/invalidation-coverage`
 * fails a writer that hand-copies prefixes, and a second copy is exactly how the
 * attachments list would end up stale after a removal.
 */
const ATTACHMENT_WRITE_PREFIXES: string[] = affectsFor('POST', '/api/attachments');

export interface AttachmentsSectionProps {
  /** Null while a new record has no id yet — nothing can be attached to it. */
  owner: AttachmentOwnerRef | null;
  /** Shown instead of the add row while `owner` is null. */
  unsavedHint?: string;
  /** Offline: the list still renders from cache, but nothing can be uploaded. */
  disabled?: boolean;
  /** A read-only calendar's event: the files can be read, not changed. */
  readOnly?: boolean;
  /**
   * Draw as a bordered card rather than on the sheet's own gutter — the event
   * editor puts every section in one, so the files sit in one too.
   */
  framed?: boolean;
  /**
   * Sit inside a stack of detail fields rather than on the sheet's gutter: no
   * horizontal padding of its own and a muted label, which is how the task and
   * event detail sheet labels `Subtasks`, `Tags` and the rest. Its rows are read
   * beside those fields, so it has to line up with them, not with the editor's
   * padded rows.
   */
  inline?: boolean;
}

export function AttachmentsSection({
  owner,
  unsavedHint = 'Save first to attach files.',
  disabled = false,
  readOnly = false,
  framed = false,
  inline = false,
}: AttachmentsSectionProps) {
  const { toast } = useToast();
  /*
   * An upload needs the server: the id, the size and the URL are its answers, and
   * the offline queue cannot carry bytes. So the control is refused while the app
   * knows the network is down, rather than after a spinner that was never going
   * to finish.
   */
  const online = useOnline();
  const resource = useResource<Attachment[]>(owner ? '/api/attachments' : null, owner ?? undefined);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const attachments = resource.data ?? [];
  const locked = disabled || readOnly || !online;

  /*
   * Three surfaces, three sets of edges: the sheet's own gutter (the default), a
   * bordered card (`framed` — the event editor wraps every section in one), and a
   * stack of detail fields (`inline` — the detail sheet, whose labels sit flush
   * with the panel's padding). Stated once here rather than at each element,
   * because a padding that disagrees with the heading is exactly what makes a
   * section look dropped in rather than laid out.
   */
  const edges = framed
    ? {
        section: 'shrink-0 gap-stack rounded-xl border border-border p-card',
        heading: 'text-sm font-medium',
        row: 'pr-0 pl-0',
        error: null,
        add: 'px-0',
      }
    : inline
      ? { section: 'gap-2', heading: 'text-sm text-muted-foreground', row: null, error: null, add: 'px-0' }
      : {
          section: null,
          heading: 'px-3 text-sm font-medium border border-transparent',
          row: 'pr-1 pl-3',
          error: 'px-3',
          add: 'px-3',
        };

  async function upload(files: FileList) {
    if (!owner) return;
    setError(null);
    setUploading(true);

    const accepted: File[] = [];
    for (const file of Array.from(files)) {
      /*
       * Checked here as well as on the server, and the wording is the same, so a
       * 26 MB file fails in a millisecond instead of after a slow upload that
       * the server then throws away.
       */
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setError(`“${file.name}” is ${formatFileSize(file.size)}. The limit is ${MAX_ATTACHMENT_LABEL} per file.`);
        continue;
      }
      if (file.size === 0) {
        setError(`“${file.name}” is empty.`);
        continue;
      }
      accepted.push(file);
    }

    let stored = 0;
    try {
      for (const file of accepted) {
        const form = new FormData();
        // The owner goes in the body, not the URL: `fetch` cannot set a multipart
        // field from a query parameter, and the route reads both the same way.
        for (const [key, value] of Object.entries(owner)) form.set(key, value);
        form.set('file', file, file.name);
        await api.upload<Attachment>('/api/attachments', form);
        stored += 1;
      }
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setUploading(false);
      // Reflect what landed even when a later file in the same batch failed.
      if (stored > 0) {
        await invalidate(ATTACHMENT_WRITE_PREFIXES);
        toast({
          title: stored === 1 ? 'File attached' : `${stored} files attached`,
          variant: 'success',
        });
      }
    }
  }

  async function remove(attachment: Attachment) {
    setConfirmId(null);
    setRemovingId(attachment.id);
    setError(null);
    try {
      await api.delete(`/api/attachments/${attachment.id}`);
      await invalidate(ATTACHMENT_WRITE_PREFIXES);
      toast({ title: 'File removed', description: `“${attachment.filename}” is gone.` });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <section
      aria-label="Attachments"
      className={cn('flex flex-col', edges.section)}
    >
      <h3 className={edges.heading}>
        Attachments
        {attachments.length ? (
          <span className="ml-2 text-xs font-normal text-muted-foreground">{attachments.length}</span>
        ) : null}
      </h3>

      {attachments.length ? (
        <ul className={cn('overflow-hidden rounded-xl bg-card text-card-foreground', framed || inline ? null : 'mt-2')}>
          {attachments.map((attachment) => {
            const confirming = confirmId === attachment.id;
            const removing = removingId === attachment.id;
            return (
              <li
                key={attachment.id}
                className={cn('flex min-h-11 items-center gap-2 border border-transparent', edges.row)}
              >
                {isPreviewableImage(attachment.mimeType) ? (
                  /*
                   * A thumbnail, because "IMG_4821.jpg" says nothing about which
                   * photo it is. `loading="lazy"` keeps a task with ten images
                   * from fetching all of them when the sheet opens.
                   */
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/attachments/${attachment.id}`}
                    alt=""
                    loading="lazy"
                    className="size-6 shrink-0 rounded object-cover"
                  />
                ) : (
                  <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground" aria-hidden>
                    <FileIcon className="size-5" />
                  </span>
                )}

                {confirming ? (
                  <>
                    <span className="min-w-0 flex-1 truncate text-sm">Remove “{attachment.filename}”?</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={removing}
                      onClick={() => void remove(attachment)}
                      className="text-destructive"
                    >
                      Remove
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmId(null)}>
                      Keep
                    </Button>
                  </>
                ) : (
                  <>
                    <a
                      href={`/api/attachments/${attachment.id}`}
                      download={attachment.filename}
                      className="min-w-0 flex-1 py-2 text-sm hover:underline"
                      title={`Download ${attachment.filename}`}
                    >
                      <span className="block truncate">{attachment.filename}</span>
                      <span className="block text-xs text-muted-foreground">
                        {formatFileSize(attachment.sizeBytes)}
                      </span>
                    </a>

                    <Button asChild variant="ghost" size="icon-sm" disabled={removing}>
                      <a
                        href={`/api/attachments/${attachment.id}`}
                        download={attachment.filename}
                        aria-label={`Download ${attachment.filename}`}
                      >
                        <DownloadIcon className="size-5" />
                      </a>
                    </Button>

                    {readOnly ? null : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${attachment.filename}`}
                        disabled={locked || removing}
                        onClick={() => setConfirmId(attachment.id)}
                        className="text-destructive"
                      >
                        <TrashIcon className="size-5" />
                      </Button>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      {error ? (
        <p role="alert" className={cn('mt-2 text-xs text-destructive', edges.error)}>
          {error}
        </p>
      ) : null}

      {readOnly ? null : (
        <>
          {/*
            One hidden input behind a button, rather than a styled file field: the
            native control cannot be made to look like a row, and `multiple` plus a
            `click()` is the only way to send several files without an upload
            widget of our own.
          */}
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            aria-hidden
            tabIndex={-1}
            onChange={(event) => {
              const files = event.target.files;
              // Reset first: picking the same file twice fires no change otherwise.
              event.target.value = '';
              if (files && files.length > 0) void upload(files);
            }}
          />

          <Button
            type="button"
            variant="ghost"
            disabled={locked || uploading || !owner}
            onClick={() => inputRef.current?.click()}
            className={cn(
              'min-h-11 w-full justify-start gap-2 rounded-lg text-primary hover:text-primary border border-transparent',
              edges.add,
              attachments.length && !framed && !inline ? 'mt-2' : null,
            )}
          >
            <span aria-hidden>
              <PlusIcon className="size-5" />
            </span>
            {uploading ? 'Uploading…' : 'Attach file'}
            <span className="ml-auto text-xs text-muted-foreground">
              {owner ? `Up to ${MAX_ATTACHMENT_LABEL}` : unsavedHint}
            </span>
          </Button>
        </>
      )}
    </section>
  );
}
