'use client';

/**
 * The file, opened where it already is.
 *
 * A tapped attachment used to be a download, which is the wrong verb for a photo
 * of a receipt or a paragraph of notes: the reason to tap it is to read it, and a
 * round trip through the Downloads folder is a detour that ends in a different
 * app. So a picture is drawn, a PDF is rendered page by page by `PdfViewer`, and
 * text is read into a `<pre>` — all from the same authenticated URL, with
 * `?inline=1` so the browser draws instead of saving.
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { errorMessage } from '@/lib/api-client';
import { attachmentPreviewKind } from '@/lib/attachments';
import { PdfViewer } from '@/components/attachments/PdfViewer';
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
  /*
   * A PDF is read into bytes before anything draws it, and the reason is the
   * worker.
   *
   * The service worker answers an `/api/...` read from its own cache first, and
   * after 1.5 s of a slow network it hands back its machine-readable offline
   * answer — which, handed to a viewer, is a PDF that cannot be parsed instead of
   * a page. Reading the bytes here means a slow connection is a slow spinner, and
   * a failure is a sentence with a Retry button rather than somebody else's error
   * document.
   */
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  /** Bumped by Retry, so both fetches re-run without an attachment change. */
  const [attempt, setAttempt] = useState(0);
  const kind = attachment ? attachmentPreviewKind(attachment.mimeType, attachment.filename) : null;
  const attachmentId = attachment?.id ?? null;

  useEffect(() => {
    setLoading(kind === 'image' || kind === 'pdf');
    setImageFailed(false);
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

  /*
   * One fetch, then the bytes: the viewer draws what the reader already holds, so
   * a flaky connection cannot leave it half-rendered or showing the worker's own
   * answer.
   */
  useEffect(() => {
    setPdfBytes(null);
    setPdfError(null);
    if (!attachment || kind !== 'pdf') return;

    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/attachments/${attachment.id}?inline=1`, {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(
            response.status === 503
              ? 'The file did not arrive. Check your connection and try again.'
              : `Could not read that file (${response.status}).`,
          );
        }
        setPdfBytes(new Uint8Array(await response.arrayBuffer()));
      } catch (failure) {
        if (controller.signal.aborted) return;
        setPdfError(errorMessage(failure));
      }
    })();

    return () => {
      controller.abort();
    };
  }, [attachment, kind, attempt]);

  if (!attachment) return null;

  const inlineHref = `/api/attachments/${attachment.id}?inline=1`;
  const downloadHref = `/api/attachments/${attachment.id}`;

  /** Whether the media box is still waiting for something; drives the spinner. */
  const waiting =
    kind === 'image'
      ? loading && !imageFailed
      : kind === 'pdf'
        ? pdfBytes === null && pdfError === null
        : kind === 'text'
          ? text === null && textError === null
          : false;

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
      {/* No description under the title: the file's size and type are the
          kind of detail that belongs in a file listing, not above the file
          itself, and the reader is the thing being looked at. */}
      <DialogContent
        aria-describedby={undefined}
        className="flex h-[90dvh] w-[calc(100%-1rem)] max-w-[calc(100%-1rem)] flex-col gap-stack overflow-hidden p-card sm:max-w-3xl"
      >
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{attachment.filename}</DialogTitle>
        </DialogHeader>

        {/* The box takes every pixel the header and footer leave, so the card
            is as tall as the rest of the app's sheets (`90dvh`). A fixed slice
            of `vh` was measured against the *large* viewport, and mobile browser
            chrome then pushed the footer off the bottom of the screen. */}
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
          {waiting ? (
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
            imageFailed ? (
              <div className="flex flex-col items-center gap-2 p-card text-center">
                <p role="alert" className="text-sm text-destructive">
                  The image did not arrive.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setImageFailed(false);
                    setLoading(true);
                    setAttempt((value) => value + 1);
                  }}
                >
                  Try again
                </Button>
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={attempt}
                src={inlineHref}
                alt={attachment.filename}
                onLoad={() => setLoading(false)}
                onError={() => {
                  setLoading(false);
                  setImageFailed(true);
                }}
                className="max-h-full max-w-full object-contain"
              />
            )
          ) : kind === 'pdf' ? (
            pdfError ? (
              <div className="flex flex-col items-center gap-2 p-card text-center">
                <p role="alert" className="text-sm text-destructive">
                  {pdfError}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAttempt((value) => value + 1)}
                >
                  Try again
                </Button>
              </div>
            ) : pdfBytes ? (
              // The pages are drawn here, on a canvas, so every browser gets the
              // same reader: page navigation and zoom that belong to the app
              // instead of a plugin the platform may not have.
              <PdfViewer bytes={pdfBytes} title={attachment.filename} />
            ) : null
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
