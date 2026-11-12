'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MinusIcon, PlusIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * An embedded PDF reader.
 *
 * A PDF cannot simply be framed. Chrome on a desktop puts a viewer in the frame,
 * but every other browser is a gamble: iOS Safari and Android Chrome draw the
 * first page and no controls at all, and a browser without a plugin shows a
 * download prompt. So the pages are rendered here, on a canvas, and navigation
 * and zoom belong to the app.
 *
 * The pages are stacked and scrolled, not paged. Reading a document is a
 * continuous act — a page of notes runs onto the next one — and a pair of arrow
 * buttons turns that into a sequence of decisions. Each page is drawn as it
 * comes near the viewport, so opening a 200-page file costs the same as opening
 * a two-page one.
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

type PdfViewport = { width: number; height: number };

type PdfPage = {
  getViewport: (options: { scale: number }) => PdfViewport;
  render: (options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewport;
    transform?: number[];
  }) => { cancel: () => void; promise: Promise<void> };
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

/** Portrait A4, used to reserve space for a page before it has been drawn. */
const FALLBACK_ASPECT = 1.294;

const clamp = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

export function PdfViewer({ bytes, title }: { bytes: Uint8Array; title: string }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const documentRef = useRef<PdfDocument | null>(null);
  const pageElements = useRef(new Map<number, HTMLDivElement>());
  const zoomRef = useRef(1);
  const pinchRef = useRef(1);
  const frame = useRef(0);

  const [pages, setPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  /** The live scale under two fingers, before it is committed on release. */
  const [pinch, setPinch] = useState(1);
  const [paneWidth, setPaneWidth] = useState(0);
  const [visiblePage, setVisiblePage] = useState(1);
  const [problem, setProblem] = useState<string | null>(null);

  zoomRef.current = zoom;

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
        setVisiblePage(1);
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

  /*
   * The width every page is fitted to. Measured rather than assumed: the sheet
   * is a third of the screen on a desktop and all of it on a phone, and the
   * reader has to fit whichever one it is on.
   */
  useEffect(() => {
    const pane = scrollRef.current;
    if (!pane) return;
    const measure = () => setPaneWidth(Math.max(0, pane.clientWidth - 16));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);

  /*
   * Two fingers scale the stack while they are down — a transform, so the
   * canvases are not redrawn sixty times a second — and the scale is committed
   * when the last finger lifts. The pane's `touch-action` is `pan-y` so the
   * browser keeps single-finger scrolling and leaves the pinch to us.
   */
  useEffect(() => {
    const pane = scrollRef.current;
    if (!pane) return;
    let startDistance = 0;
    let startZoom = 1;
    let live = false;

    const spread = (touches: TouchList) =>
      Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY) || 1;

    const begin = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      startDistance = spread(event.touches);
      startZoom = zoomRef.current;
      live = true;
      pinchRef.current = 1;
      setPinch(1);
    };
    const move = (event: TouchEvent) => {
      if (!live || event.touches.length !== 2) return;
      // Ours, not the browser's: an unhandled pinch here zooms the whole app.
      event.preventDefault();
      const scale = Math.min(MAX_ZOOM / startZoom, Math.max(MIN_ZOOM / startZoom, spread(event.touches) / startDistance));
      pinchRef.current = scale;
      setPinch(scale);
    };
    const end = (event: TouchEvent) => {
      if (!live || event.touches.length >= 2) return;
      live = false;
      const committed = clamp(startZoom * pinchRef.current);
      pinchRef.current = 1;
      setPinch(1);
      setZoom(committed);
    };

    pane.addEventListener('touchstart', begin, { passive: true });
    pane.addEventListener('touchmove', move, { passive: false });
    pane.addEventListener('touchend', end);
    pane.addEventListener('touchcancel', end);
    return () => {
      pane.removeEventListener('touchstart', begin);
      pane.removeEventListener('touchmove', move);
      pane.removeEventListener('touchend', end);
      pane.removeEventListener('touchcancel', end);
    };
  }, []);

  // Which page the reader is looking at, for the readout in the footer.
  const onScroll = useCallback(() => {
    if (frame.current) return;
    frame.current = window.requestAnimationFrame(() => {
      frame.current = 0;
      const pane = scrollRef.current;
      if (!pane) return;
      // The page filling most of the pane, not the last one to cross its top:
      // a short document never scrolls its final page up there, and a readout
      // that says 1 / 2 at the end of a two-page file is simply wrong.
      const box = pane.getBoundingClientRect();
      let showing = 1;
      let most = -1;
      for (const [number, element] of pageElements.current) {
        const rect = element.getBoundingClientRect();
        const visible = Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top);
        if (visible > most) {
          most = visible;
          showing = number;
        }
      }
      setVisiblePage(showing);
    });
  }, []);

  useEffect(() => () => window.cancelAnimationFrame(frame.current), []);

  const register = useCallback((pageNumber: number, element: HTMLDivElement | null) => {
    if (element) pageElements.current.set(pageNumber, element);
    else pageElements.current.delete(pageNumber);
  }, []);

  const zoomBy = (factor: number) => setZoom((current) => clamp(current * factor));

  if (problem) {
    return (
      <p className="p-card text-sm text-muted-foreground" role="alert">
        {problem}
      </p>
    );
  }

  const pageWidth = Math.round(paneWidth * zoom);

  return (
    <div className="flex size-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{ touchAction: 'pan-y' }}
        className="min-h-0 flex-1 overflow-auto overscroll-contain bg-muted p-2"
      >
        <div
          className="flex flex-col items-center gap-2"
          style={pinch === 1 ? undefined : { transform: `scale(${pinch})`, transformOrigin: 'top center' }}
        >
          {Array.from({ length: pages }, (_, index) => (
            <PdfPageView
              key={index + 1}
              document={documentRef.current}
              pageNumber={index + 1}
              width={pageWidth}
              title={title}
              onProblem={setProblem}
              register={register}
            />
          ))}
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-stack border-t border-border px-row py-1">
        <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {visiblePage} / {pages || 1}
        </span>
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

/**
 * One page of the document, drawn when it is close enough to be read.
 *
 * The holder is always in the layout, at the page's own aspect ratio, so the
 * scrollbar is honest before a single page has been drawn and does not jump as
 * they arrive.
 */
function PdfPageView({
  document,
  pageNumber,
  width,
  title,
  onProblem,
  register,
}: {
  document: PdfDocument | null;
  pageNumber: number;
  width: number;
  title: string;
  onProblem: (message: string) => void;
  register: (pageNumber: number, element: HTMLDivElement | null) => void;
}) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [near, setNear] = useState(false);
  const [aspect, setAspect] = useState(0);

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setNear(true);
        observer.disconnect();
      },
      // A screen ahead, so the next page is already drawn when it arrives.
      { rootMargin: '150% 0px' },
    );
    observer.observe(holder);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!document || !near || width <= 0) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    void (async () => {
      try {
        const page = await document.getPage(pageNumber);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: width / base.width });
        const context = canvasRef.current?.getContext('2d');
        const canvas = canvasRef.current;
        if (!canvas || !context) return;
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${Math.round(viewport.width)}px`;
        canvas.style.height = `${Math.round(viewport.height)}px`;
        task = page.render({
          canvasContext: context,
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        });
        await task.promise;
        if (!cancelled) setAspect(base.height / base.width);
      } catch (failure) {
        if (!cancelled) onProblem(failure instanceof Error ? failure.message : 'That page could not be drawn.');
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [document, near, onProblem, pageNumber, width]);

  const height = Math.round(width * (aspect || FALLBACK_ASPECT));

  return (
    <div
      ref={(element) => {
        holderRef.current = element;
        register(pageNumber, element);
      }}
      className="shrink-0 bg-background shadow-sm"
      style={{ width: width || undefined, height: height || undefined }}
    >
      <canvas ref={canvasRef} role="img" aria-label={`Page ${pageNumber} of ${title}`} className="block" />
    </div>
  );
}
