'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, MinusIcon, PlusIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from 'cn';

/**
 * An embedded PDF reader.
 *
 * A PDF cannot simply be framed. Chrome on a desktop puts a viewer in the frame,
 * but every other browser is a gamble: iOS Safari and Android Chrome draw the
 * first page and no controls at all, and a browser without a plugin shows a
 * download prompt. So the pages are rendered here, on a canvas, and navigation
 * and zoom belong to the app.
 *
 * pdf.js is loaded lazily — 400 kB of it — so a sheet that shows a photo never
 * pays for it. It is loaded the way a browser loads a library rather than the
 * way a build imports one: both files sit in `public/` (see
 * `scripts/copy-pdf-worker.mjs`). The worker has to be a URL either way, and
 * letting the bundler take the library produced a module that threw
 * "Object.defineProperty called on non-object" in Next's dev server before a
 * single page was drawn.
 */

type PdfDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPage>;
  destroy: () => Promise<void>;
};

type PdfPage = {
  getViewport: (options: { scale: number }) => { width: number; height: number };
  render: (options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
    transform?: number[];
  }) => { promise: Promise<void> };
};

/** The parts of pdf.js this file uses. */
type PdfJsModule = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (options: { data: Uint8Array }) => { promise: Promise<PdfDocument> };
};

const LIBRARY_URL = '/pdf.min.mjs';
const WORKER_URL = '/pdf.worker.min.mjs';

let library: Promise<PdfJsModule> | null = null;

/** Load pdf.js once, as a static file, and point it at its worker. */
function loadPdfJs(): Promise<PdfJsModule> {
  if (!library) {
    /*
     * A runtime import: the specifier has to stay a value so neither webpack nor
     * turbopack rewrites it into its own module wrapper.
     */
    const load = new Function('url', 'return import(url)') as (url: string) => Promise<PdfJsModule>;
    library = load(LIBRARY_URL).then((module) => {
      module.GlobalWorkerOptions.workerSrc = WORKER_URL;
      return module;
    });
  }
  return library;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 6;
const ZOOM_STEP = 1.25;

export function PdfViewer({ bytes, title }: { bytes: Uint8Array; title: string }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const documentRef = useRef<PdfDocument | null>(null);
  const [pages, setPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [fitWidth, setFitWidth] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);

  // Open the file once per download. `getDocument` transfers the buffer, so the
  // view keeps its own copy and hands pdf.js a slice each time.
  useEffect(() => {
    let alive = true;
    let opened: PdfDocument | null = null;
    void (async () => {
      try {
        const pdfjs = await loadPdfJs();
        opened = (await pdfjs.getDocument({ data: bytes.slice() }).promise) as PdfDocument;
        if (!alive) {
          void opened.destroy();
          return;
        }
        documentRef.current = opened;
        setPages(opened.numPages);
        setPageNumber(1);
        setProblem(null);
      } catch (failure) {
        if (alive) setProblem(failure instanceof Error ? failure.message : 'That PDF could not be opened.');
      }
    })();
    return () => {
      alive = false;
      documentRef.current = null;
      void opened?.destroy();
    };
  }, [bytes]);

  // Fit the width of the reading pane until the reader zooms by hand.
  useEffect(() => {
    const pane = scrollRef.current;
    if (!pane || !documentRef.current) return;
    let alive = true;
    void (async () => {
      try {
        const page = await documentRef.current?.getPage(1);
        if (!page || !alive) return;
        const natural = page.getViewport({ scale: 1 }).width;
        const available = pane.clientWidth - 16;
        if (natural > 0 && available > 0) setFitWidth(available / natural);
      } catch {
        /* the render effect reports a real failure */
      }
    })();
    return () => {
      alive = false;
    };
  }, [pages]);

  const paint = useCallback(async () => {
    const page = await documentRef.current?.getPage(pageNumber);
    const canvas = canvasRef.current;
    if (!page || !canvas) return;
    const scale = (fitWidth || 1) * zoom;
    const viewport = page.getViewport({ scale });
    const context = canvas.getContext('2d');
    if (!context) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = `${Math.round(viewport.width)}px`;
    canvas.style.height = `${Math.round(viewport.height)}px`;
    await page.render({
      canvasContext: context,
      viewport,
      transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
    }).promise;
  }, [fitWidth, pageNumber, zoom]);

  useEffect(() => {
    void paint().catch((failure: unknown) => {
      setProblem(failure instanceof Error ? failure.message : 'That page could not be drawn.');
    });
  }, [paint]);

  const go = (delta: number) => {
    setPageNumber((current) => Math.min(pages || 1, Math.max(1, current + delta)));
    scrollRef.current?.scrollTo({ top: 0 });
  };
  const zoomBy = (factor: number) => {
    setZoom((current) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current * factor)));
  };

  if (problem) {
    return (
      <p className="p-card text-sm text-muted-foreground" role="alert">
        {problem}
      </p>
    );
  }

  return (
    <div className="flex size-full min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto bg-muted p-2">
        <canvas ref={canvasRef} aria-label={`Page ${pageNumber} of ${title}`} role="img" className="mx-auto block" />
      </div>
      <div className="flex shrink-0 items-center justify-between gap-stack border-t border-border px-row py-1">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Previous page"
            disabled={pageNumber <= 1}
            onClick={() => go(-1)}
          >
            <ChevronLeftIcon />
          </Button>
          <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
            {pageNumber} / {pages || 1}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Next page"
            disabled={pageNumber >= (pages || 1)}
            onClick={() => go(1)}
          >
            <ChevronRightIcon />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom out"
            disabled={zoom <= MIN_ZOOM}
            onClick={() => zoomBy(1 / ZOOM_STEP)}
          >
            <MinusIcon />
          </Button>
          <span className="text-xs tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom in"
            disabled={zoom >= MAX_ZOOM}
            onClick={() => zoomBy(ZOOM_STEP)}
          >
            <PlusIcon />
          </Button>
        </div>
      </div>
    </div>
  );
}
