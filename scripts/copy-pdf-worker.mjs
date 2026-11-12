/**
 * Copies pdf.js into `public/`.
 *
 * The viewer loads both halves of pdf.js by URL rather than importing the
 * package: the worker has to be a real file anyway (`GlobalWorkerOptions.workerSrc`
 * is a URL), and loading the library the same way keeps it out of the bundler —
 * where a CommonJS/ESM interop quirk in Next's dev server made it throw
 * "Object.defineProperty called on non-object" before a single page was drawn.
 *
 * The copies have to be kept in step with the installed package, so this script
 * owns them and the test suite compares the files (tests/pdf-viewer.test.ts).
 *
 *   npm run pdf:worker
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const build = join(dirname(require.resolve('pdfjs-dist/package.json')), 'build');
const target = join(process.cwd(), 'public');

const FILES = [
  ['pdf.min.mjs', 'pdf.min.mjs'],
  ['pdf.worker.min.mjs', 'pdf.worker.min.mjs'],
];

mkdirSync(target, { recursive: true });
for (const [from, to] of FILES) {
  const source = join(build, from);
  if (!existsSync(source)) {
    console.error(`[pdf-worker] no ${source} — is pdfjs-dist installed?`);
    process.exit(1);
  }
  copyFileSync(source, join(target, to));
  console.log(`[pdf-worker] ${from} -> public/${to}`);
}
