import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * The embedded reader is the one place the app hands a file to a library instead
 * of to the browser, and both halves of that are easy to break silently:
 *
 *  - the worker is a static file under `public/`, so it can drift from the
 *    installed package (a version bump changes nothing at runtime, the viewer
 *    just falls back to the main thread and stutters);
 *  - the controls are the whole reason the viewer exists, because the platform
 *    ones are exactly what a phone does not provide.
 */

const ROOT = process.cwd();
const VIEWER = 'src/components/attachments/PdfViewer.tsx';
const WORKER = 'public/pdf.worker.min.mjs';
const LIBRARY = 'public/pdf.min.mjs';

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), 'utf8');
}

function digest(relative: string): string {
  return createHash('sha256').update(readFileSync(path.join(ROOT, relative))).digest('hex');
}

describe('a PDF is read inside the sheet', () => {
  const viewer = read(VIEWER);

  it('draws pages on a canvas, and loads the library lazily', () => {
    expect(viewer).toContain('<canvas');
    expect(viewer).toContain("const LIBRARY_URL = '/pdf.min.mjs'");
    // Eagerly importing 400 kB of pdf.js would put it in the bundle every sheet
    // pays for, including a photo's.
    expect(viewer).not.toMatch(/^import .* from 'pdfjs-dist'/m);
    // A runtime import, so the bundler cannot wrap it: pdf.js is served as a
    // plain static file and its own module format is the browser's.
    expect(viewer).toContain("new Function('url', 'return import(url)')");
  });

  it('fits every page to the pane before anyone zooms', () => {
    // A page drawn at 100% is wider than a phone, so it has to be dragged
    // sideways to read a line — the complaint that started this.
    expect(viewer).toContain('const pageWidth = Math.round(paneWidth * zoom)');
    expect(viewer).toContain('page.getViewport({ scale: width / base.width })');
  });

  it('stacks the pages and scrolls through them instead of paging', () => {
    // Reading is continuous: a page of notes runs onto the next one, and a pair
    // of arrow buttons turns that into a sequence of decisions.
    expect(viewer).toContain('Array.from({ length: pages }');
    expect(viewer).not.toContain('Previous page');
    expect(viewer).not.toContain('Next page');
    expect(viewer).toContain('{visiblePage} / {pages || 1}');
  });

  it('names the page being read, not the last one to cross the top', () => {
    // A two-page file never scrolls its second page to the top of the pane, so
    // "topmost" would leave the readout on 1 / 2 at the end of the document.
    expect(viewer).toContain('const visible = Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top);');
    expect(viewer).toContain('if (visible > most)');
  });

  it('holds the page still under the fingers while they pinch', () => {
    // Scaling the stack around its own centre drags the page out from under the
    // reader; the point between the fingers is the only fixed point that is
    // where the reader is looking.
    expect(viewer).toContain('const centre = middle(event.touches);');
    // The stack starts inside the pane's padding, and the scale is applied
    // around the stack's own corner: a formula that forgets `originX` drifts by
    // `padding * (scale - 1)` — 16 px on a two-finger zoom to 300%.
    expect(viewer).toContain('originX: stack?.offsetLeft ?? 0,');
    expect(viewer).toContain(
      'x: centre.x - (gesture.originX - gesture.left + (gesture.x - gesture.originX) * scale),',
    );
    // And the same point becomes the scroll position once the transform is gone.
    expect(viewer).toContain('x: gesture.originX + (gesture.x - gesture.originX) * moved.scale - centreAfter.x,');
    expect(viewer).toContain('y: gesture.originY + (gesture.y - gesture.originY) * moved.scale - centreAfter.y,');
  });

  it('lets a zoomed page be dragged in every direction', () => {
    // `items-center` on overflowing content hangs half the page off the left
    // edge where no scroll can reach it: the column is as wide as the page
    // instead, and the page centres itself.
    expect(viewer).toContain('flex w-max min-w-full flex-col gap-2');
    expect(viewer).toContain('mx-auto shrink-0');
    expect(viewer).not.toContain('flex flex-col items-center gap-2');
  });

  it('gives a phone the controls the platform does not', () => {
    for (const label of ['Zoom out', 'Zoom in']) {
      expect(viewer).toContain(`aria-label="${label}"`);
    }
    expect(viewer).toContain('Math.round(zoom * 100)');
    // Pinch, handled here rather than leaving it to the browser, which would
    // zoom the whole app around the sheet instead of the page inside it.
    expect(viewer).toContain("pane.addEventListener('touchmove', move, { passive: false })");
    expect(viewer).toContain('event.preventDefault()');
    expect(viewer).toContain('Math.hypot(');
    // Both axes, or the browser refuses to pan a zoomed page sideways.
    expect(viewer).toContain("style={{ touchAction: 'pan-x pan-y' }}");
  });

  it('draws a page when it comes near, scaled for the screen it is on', () => {
    // A 200-page file has to cost the same as a two-page one.
    expect(viewer).toContain("rootMargin: '150% 0px'");
    expect(viewer).toContain('getDocument({ data: bytes.slice() })');
    expect(viewer).toContain('const ratio = Math.min(2, window.devicePixelRatio || 1)');
    expect(viewer).toContain('transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0]');
  });

  it('says so when a file will not open, rather than showing a blank card', () => {
    expect(viewer).toContain('role="alert"');
    expect(viewer).toContain('That PDF could not be opened.');
  });
});

describe('pdf.js is a file the app actually serves', () => {
  it('points the library at a static worker, not at the bundler', () => {
    expect(read(VIEWER)).toContain("const WORKER_URL = '/pdf.worker.min.mjs'");
    expect(read(VIEWER)).toContain('module.GlobalWorkerOptions.workerSrc = WORKER_URL');
  });

  it('ships the library and its worker, both matching the installed package', () => {
    for (const [copy, original] of [
      [LIBRARY, 'node_modules/pdfjs-dist/build/pdf.min.mjs'],
      [WORKER, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'],
    ]) {
      expect(existsSync(path.join(ROOT, copy))).toBe(true);
      // `npm run pdf:worker` is what refreshes them; this is the check that the
      // refresh happened.
      expect(digest(copy)).toBe(digest(original));
    }
  });
});
