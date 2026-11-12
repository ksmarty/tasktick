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
 * upload finishes. That is also why an upload is refused — not queued — while
 * offline: the offline queue holds JSON, and a file cannot be rebuilt from it
 * later.
 *
 * ## Why every file gets a row before it is stored
 *
 * Bytes take time, and a button that only says "Uploading…" says nothing about
 * whether the request is moving or has died at 3%, which is the difference
 * between waiting and reloading. So each file is listed the moment it is picked,
 * with its own percentage and, if it fails, its own sentence saying so. Failures
 * stay on screen until dismissed: an error that disappears on the next attempt of
 * another file is a report the user cannot read.
 *
 * ## One control, in the heading
 *
 * The list is the content; adding to it is a small verb, so it is a plus in the
 * heading rather than a full-width row under the files. A row that big competes
 * with the files themselves, and on a task with no files it is a slab of empty
 * space where the useful thing — the heading — should be.
 *
 * ## Removing is two steps, not a hold
 *
 * Deleting one file is small enough that a hold on every row would be noise in a
 * list you scroll, and permanent enough that a single mis-tap would lose the only
 * copy. The row asks once, in place (`Remove`/`Keep`), which is enough for a
 * decision this size and costs no dialog. The control is only in the editors: the
 * detail sheet is where files are read, and a destructive control beside a
 * download is one mis-tap from a gone file.
 */
import { useRef, useState } from 'react';
import { FileIcon } from '@svg-animated-icons/react/file';
import { DownloadIcon } from '@svg-animated-icons/react/download';
import { PlusIcon } from '@svg-animated-icons/react/plus';
import { Cross1Icon } from '@svg-animated-icons/react/cross-1';
import { TrashIcon } from '@svg-animated-icons/react/trash';
import { AttachmentPreview } from '@/components/attachments/AttachmentPreview';
import { useToast } from '@/components/app/Toast';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { api, errorMessage } from '@/lib/api-client';
import {
  attachmentPreviewKind,
  formatFileSize,
  isPreviewableImage,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_LABEL,
} from '@/lib/attachments';
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
  /** Shown instead of the add control while `owner` is null. */
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

/** One file the user picked, from the moment it is chosen until it is stored. */
interface PendingUpload {
  /** Stable per pick; a `File` has no id and two files can share a name. */
  key: number;
  file: File;
  /** 0…1 as the browser reports the request body leaving. */
  percent: number;
  /** A sentence for this file alone — refused locally or refused by the server. */
  error: string | null;
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
  const nextKey = useRef(0);
  const [queue, setQueue] = useState<PendingUpload[]>([]);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<Attachment | null>(null);

  const attachments = resource.data ?? [];
  const locked = disabled || readOnly || !online;
  /* Uploading, as opposed to having finished or failed: only this blocks a pick. */
  const busy = queue.some((item) => item.error === null);
  /*
   * Files are removed in the editors only. In the detail sheet — where the row is
   * a download you tap — a trash icon next to it is one mis-tap from losing the
   * file, and the sheet's own Edit button is already the way to change things.
   */
  const removable = !readOnly && !inline;

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
        section: 'shrink-0 gap-2 rounded-xl border border-border p-card',
        header: 'flex min-h-8 items-center gap-2',
        label: 'flex-1 text-sm font-medium',
        row: 'pr-0 pl-0',
        error: null,
      }
    : inline
      ? {
          section: 'gap-2',
          header: 'flex min-h-8 items-center gap-2',
          label: 'flex-1 text-sm text-muted-foreground',
          row: null,
          error: null,
        }
      : {
          section: null,
          header: 'flex min-h-8 items-center gap-2 px-3',
          label: 'flex-1 text-sm font-medium',
          row: 'pr-1 pl-3',
          error: 'px-3',
        };

  function patch(key: number, change: Partial<PendingUpload>) {
    setQueue((current) => current.map((item) => (item.key === key ? { ...item, ...change } : item)));
  }

  /*
   * Sends one file and keeps it on screen either way: on success it leaves the
   * queue, on failure it stays with the server's own sentence beside it. The
   * percentage is the browser's, not an estimate of our own — anything else would
   * drift away from what the socket is actually doing.
   */
  async function send(item: PendingUpload): Promise<boolean> {
    if (!owner) return false;
    const form = new FormData();
    // The owner goes in the body, not in the URL: `fetch` cannot set a multipart
    // field from a query parameter, and the route reads both the same way.
    for (const [key, value] of Object.entries(owner)) form.set(key, value);
    form.set('file', item.file, item.file.name);

    patch(item.key, { percent: 0, error: null });
    try {
      await api.upload<Attachment>('/api/attachments', form, {
        onProgress: ({ fraction }) => patch(item.key, { percent: fraction }),
      });
      setQueue((current) => current.filter((entry) => entry.key !== item.key));
      return true;
    } catch (failure) {
      patch(item.key, { error: errorMessage(failure) });
      return false;
    }
  }

  /*
   * No success toast. The row appearing in the list *is* the confirmation, and a
   * banner for something that already happened is a thing to dismiss before
   * carrying on. Failures still speak, in the row, because those need reading.
   */
  async function accept(files: File[]) {
    if (!owner) return;
    setError(null);

    /*
     * Checked here as well as on the server, and the wording is the same, so a
     * 26 MB file fails in a millisecond instead of after a slow upload that the
     * server then throws away. A refused file still gets a row, because the user
     * picked it and silence reads as a bug.
     */
    const accepted: PendingUpload[] = [];
    const refused: PendingUpload[] = [];
    for (const file of files) {
      const key = (nextKey.current += 1);
      if (file.size > MAX_ATTACHMENT_BYTES) {
        refused.push({
          key,
          file,
          percent: 0,
          error: `“${file.name}” is ${formatFileSize(file.size)}. The limit is ${MAX_ATTACHMENT_LABEL} per file.`,
        });
      } else if (file.size === 0) {
        refused.push({ key, file, percent: 0, error: `“${file.name}” is empty.` });
      } else {
        accepted.push({ key, file, percent: 0, error: null });
      }
    }

    if (refused.length > 0) setQueue((current) => [...current, ...refused]);
    if (accepted.length === 0) return;
    setQueue((current) => [...current, ...accepted]);

    /* One at a time: a batch of five over one uplink has one honest percentage. */
    let stored = 0;
    for (const item of accepted) {
      if (await send(item)) stored += 1;
    }

    // Reflect what landed even when another file in the same pick failed.
    if (stored > 0) await invalidate(ATTACHMENT_WRITE_PREFIXES);
  }

  async function retry(item: PendingUpload) {
    if (await send(item)) await invalidate(ATTACHMENT_WRITE_PREFIXES);
  }

  function dismiss(key: number) {
    setQueue((current) => current.filter((item) => item.key !== key));
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
    <section aria-label="Attachments" className={cn('flex flex-col', edges.section)}>
      <div className={edges.header}>
        <h3 className={edges.label}>
          Attachments
          {attachments.length ? (
            <span className="ml-2 text-xs font-normal text-muted-foreground">{attachments.length}</span>
          ) : null}
        </h3>

        {readOnly ? null : (
          <>
            {/*
              One hidden input behind the plus, rather than a styled file field:
              the native control cannot be made to look like the heading, and
              `multiple` plus a `click()` is the only way to send several files
              without an upload widget of our own.
            */}
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              aria-hidden
              tabIndex={-1}
              onChange={(event) => {
                /*
                 * Copied out *before* the field is cleared. `input.files` is a
                 * live list: `value = ''` empties the very `FileList` a handler
                 * might still be holding, so the obvious `const files =
                 * target.files; target.value = ''` leaves an empty list behind
                 * and the upload is skipped without a word — which is exactly
                 * what shipped.
                 */
                const files = Array.from(event.currentTarget.files ?? []);
                // Reset after reading: picking the same file twice fires no
                // change event otherwise.
                event.currentTarget.value = '';
                if (files.length > 0) void accept(files);
              }}
            />

            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={locked || busy || !owner}
              onClick={() => inputRef.current?.click()}
              aria-label={busy ? 'Uploading' : 'Attach file'}
              title={
                owner
                  ? `Attach a file — up to ${MAX_ATTACHMENT_LABEL} each`
                  : unsavedHint
              }
            >
              {busy ? (
                <span
                  aria-hidden
                  className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                />
              ) : (
                <PlusIcon className="size-5" />
              )}
            </Button>
          </>
        )}
      </div>

      {attachments.length ? (
        <ul
          className={cn(
            'overflow-hidden rounded-xl bg-card text-card-foreground',
            framed || inline ? null : 'mt-2',
          )}
        >
          {attachments.map((attachment) => {
            const confirming = confirmId === attachment.id;
            const removing = removingId === attachment.id;
            const kind = attachmentPreviewKind(attachment.mimeType, attachment.filename);
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
                    {kind ? (
                      /* Tappable because there is something to read: the sheet
                       * opens the file rather than sending it to Downloads. */
                      <button
                        type="button"
                        onClick={() => setPreviewing(attachment)}
                        className="min-w-0 flex-1 py-2 text-left text-sm outline-none hover:underline"
                        title={`Open ${attachment.filename}`}
                      >
                        <span className="block truncate">{attachment.filename}</span>
                        <span className="block text-xs text-muted-foreground">
                          {formatFileSize(attachment.sizeBytes)}
                        </span>
                      </button>
                    ) : (
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
                    )}

                    <Button asChild variant="ghost" size="icon-sm" disabled={removing}>
                      <a
                        href={`/api/attachments/${attachment.id}`}
                        download={attachment.filename}
                        aria-label={`Download ${attachment.filename}`}
                      >
                        <DownloadIcon className="size-5" />
                      </a>
                    </Button>

                    {removable ? (
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
                    ) : null}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      {queue.length > 0 ? (
        <ul className="flex flex-col">
          {queue.map((item) => (
            <li
              key={item.key}
              className={cn('flex flex-col justify-center gap-1 border border-transparent py-2', edges.row)}
            >
              <div className="flex min-h-8 items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">{item.file.name}</span>
                {item.error ? (
                  <>
                    <Button type="button" variant="ghost" size="sm" onClick={() => void retry(item)}>
                      Retry
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Dismiss ${item.file.name}`}
                      onClick={() => dismiss(item.key)}
                    >
                      <Cross1Icon className="size-4" />
                    </Button>
                  </>
                ) : (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {Math.round(item.percent * 100)}%
                  </span>
                )}
              </div>
              {item.error ? (
                <p role="alert" className="text-xs text-destructive">
                  {item.error}
                </p>
              ) : (
                <Progress
                  value={Math.round(item.percent * 100)}
                  aria-label={`Uploading ${item.file.name}`}
                  className="h-1"
                />
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p role="alert" className={cn('mt-2 text-xs text-destructive', edges.error)}>
          {error}
        </p>
      ) : null}

      <AttachmentPreview
        attachment={previewing}
        onOpenChange={(open) => {
          if (!open) setPreviewing(null);
        }}
      />
    </section>
  );
}
