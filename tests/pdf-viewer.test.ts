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

  it('fits the page to the pane before anyone zooms', () => {
    // A page drawn at 100% is wider than a phone, so it has to be dragged
    // sideways to read a line — the complaint that started this.
    expect(viewer).toContain('const natural = page.getViewport({ scale: 1 }).width');
    expect(viewer).toContain('setFitWidth(available / natural)');
    expect(viewer).toContain('const scale = (fitWidth || 1) * zoom');
  });

  it('gives a phone the controls the platform does not', () => {
    for (const label of ['Previous page', 'Next page', 'Zoom out', 'Zoom in']) {
      expect(viewer).toContain(`aria-label="${label}"`);
    }
    expect(viewer).toContain('{pageNumber} / {pages || 1}');
    expect(viewer).toContain('Math.round(zoom * 100)');
  });

  it('renders one page at a time, scaled for the screen it is on', () => {
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
