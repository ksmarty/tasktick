'use client';

/**
 * The file, opened where it already is.
 *
 * A tapped attachment used to be a download, which is the wrong verb for a photo
 * of a receipt or a paragraph of notes: the reason to tap it is to read it, and a
 * round trip through the Downloads folder is a detour that ends in a different
 * app. So a picture is drawn, a PDF is framed, and text is read into a `<pre>` —
 * all from the same authenticated URL, with `?inline=1` so the browser draws
 * instead of saving.
 *
 * Everything else keeps the download: a zip, a docx, an SVG. Saying "this one
 * cannot be shown here" and offering the file is honest; an empty frame is not.
 */
import { useEffect, useState } from 'react';
import { useToast } from '@/components/app/Toast';
import { DownloadIcon } from '@svg-animated-icons/react/download';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { errorMessage } from '@/lib/api-client';
import { attachmentPreviewKind, formatFileSize } from '@/lib/attachments';
import type { Attachment } from '@/lib/types';

/**
 * How much text is worth reading inside a sheet.
 *
 * A 4 MB log is a download, not a preview: past this point the browser spends
 * longer laying out the string than the user spends deciding to close it.
 */
const MAX_TEXT_PREVIEW_CHARS = 200_000;

export interface AttachmentPreviewProps {
  /** The file to show, or null while the sheet is closed. */
  attachment: Attachment | null;
  onOpenChange: (open: boolean) => void;
}

export function AttachmentPreview({ attachment, onOpenChange }: AttachmentPreviewProps) {
  const { toast } = useToast();
  const [text, setText] = useState<string | null>(null);
  const [textError, setTextError] = useState<string | null>(null);
  /*
   * An image or a PDF is fetched by the browser, not by this component, so a
   * slow one used to leave an empty grey card and no way to tell "still coming"
   * from "broken". The spinner rides on the element's own `load` event.
   */
  const [loading, setLoading] = useState(false);
  const kind = attachment ? attachmentPreviewKind(attachment.mimeType, attachment.filename) : null;
  const attachmentId = attachment?.id ?? null;

  useEffect(() => {
    setLoading(kind === 'image' || kind === 'pdf');
  }, [attachmentId, kind]);

  /*
   * Text is fetched rather than framed: an iframe of a `.txt` is a document with
   * its own scrollbar and its own font, and it cannot be styled to match. The
   * `inline` URL is still used so the bytes come back verbatim instead of as a
   * download prompt.
   */
  useEffect(() => {
    setText(null);
    setTextError(null);
    if (!attachment || kind !== 'text') return;

    let cancelled = false;
    void (async () => {
      try {
        // Raw bytes, so `fetch` directly — the JSON client would try to parse a
        // text file as an envelope and fail on the first line of it.
        const response = await fetch(`/api/attachments/${attachment.id}?inline=1`, {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(`Could not read that file (${response.status}).`);
        const body = await response.text();
        if (!cancelled) setText(body);
      } catch (failure) {
        if (!cancelled) setTextError(errorMessage(failure));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attachment, kind]);

  if (!attachment) return null;

  const inlineHref = `/api/attachments/${attachment.id}?inline=1`;
  const downloadHref = `/api/attachments/${attachment.id}`;

  async function download() {
    if (!attachment) return;
    try {
      // Same URL the anchor uses; here only so a failure can be reported rather
      // than silently opening a tab that 404s.
      const response = await fetch(downloadHref, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Download failed (${response.status}).`);
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = attachment.filename;
      anchor.click();
      URL.revokeObjectURL(href);
    } catch (failure) {
      toast({ title: 'Could not download that file', description: errorMessage(failure) });
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90dvh] w-[calc(100%-1rem)] max-w-[calc(100%-1rem)] flex-col gap-stack overflow-hidden p-card sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{attachment.filename}</DialogTitle>
          <DialogDescription>
            {formatFileSize(attachment.sizeBytes)}
            {attachment.mimeType ? ` · ${attachment.mimeType}` : null}
          </DialogDescription>
        </DialogHeader>

        {/* The box takes every pixel the header and footer leave, so the card
            is as tall as the rest of the app's sheets (`90dvh`). A fixed slice
            of `vh` was measured against the *large* viewport, and mobile browser
            chrome then pushed the footer off the bottom of the screen. */}
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
          {loading || (kind === 'text' && text === null && !textError) ? (
            <div
              role="status"
              aria-label={
                kind === 'pdf'
                  ? 'Loading the PDF'
                  : kind === 'text'
                    ? 'Reading the file'
                    : 'Loading the image'
              }
              className="absolute inset-0 z-10 flex items-center justify-center bg-muted"
            >
              <span
                aria-hidden
                className="size-6 animate-spin rounded-full border-2 border-current border-t-transparent text-muted-foreground"
              />
            </div>
          ) : null}
          {kind === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={inlineHref}
              alt={attachment.filename}
              onLoad={() => setLoading(false)}
              onError={() => setLoading(false)}
              className="max-h-full max-w-full object-contain"
            />
          ) : kind === 'pdf' ? (
            // `view=FitH` fits the page to the frame's width and `toolbar=1`
            // keeps the viewer's own controls, which were missing: without them
            // a page at 100% zoom had to be scrolled in both directions.
            <iframe
              src={`${inlineHref}#view=FitH&toolbar=1`}
              title={attachment.filename}
              onLoad={() => setLoading(false)}
              className="size-full bg-background"
            />
          ) : kind === 'text' ? (
            textError ? (
              <p role="alert" className="p-card text-sm text-destructive">
                {textError}
              </p>
            ) : text === null ? null : (
              <pre className="size-full overflow-auto p-card text-xs whitespace-pre-wrap break-words">
                {text.slice(0, MAX_TEXT_PREVIEW_CHARS)}
                {text.length > MAX_TEXT_PREVIEW_CHARS ? '\n…' : null}
              </pre>
            )
          ) : (
            <p className="p-card text-sm text-muted-foreground">
              This kind of file cannot be shown here. Download it to open it.
            </p>
          )}
        </div>

        <DialogFooter className="flex flex-row items-center justify-end">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button type="button" variant="outline" onClick={() => void download()}>
            <DownloadIcon className="size-4" />
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
