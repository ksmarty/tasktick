#!/usr/bin/env node
/**
 * Fails if a component invents a spacing value.
 *
 * The previous UI drifted — one card padded 12px, the next 16px, a third 14px,
 * and the page gutter different on every screen. Each choice was defensible on
 * its own, which is exactly why nobody noticed the total. Eyeballing screenshots
 * does not catch a 2px difference, so this checks the source instead.
 *
 * Two things are rejected:
 *
 *   1. Arbitrary-value utilities — `p-[13px]`, `mt-[7px]`, `gap-[18px]`. If a
 *      size is not on the scale, either the scale is wrong or the size is.
 *   2. Raw margin/padding in an inline `style` object. A measured pixel value in
 *      `style` is sometimes legitimate (a drag offset, a computed height), but
 *      static spacing never is.
 *
 * Run with `--json` for machine-readable output.
 */
import { readFileSync, globSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');

/** Utilities whose arbitrary forms are always a spacing smell. */
const SPACING_PREFIXES = [
  'p',
  'px',
  'py',
  'pt',
  'pr',
  'pb',
  'pl',
  'm',
  'mx',
  'my',
  'mt',
  'mr',
  'mb',
  'ml',
  'gap',
  'gap-x',
  'gap-y',
  'space-x',
  'space-y',
  'inset',
  'top',
  'right',
  'bottom',
  'left',
  'size',
  'w',
  'h',
];

/**
 * `p-[13px]` etc. Deliberately does NOT flag:
 *  - fractions/percentages (`w-[100%]`, `w-1/2`) — layout, not spacing
 *  - `calc(...)`/`env(...)` — safe-area and dynamic values
 *  - `min-`/`max-` prefixed utilities — those are constraints
 *  - CSS-variable references (`w-[--x]`)
 */
const ARBITRARY = new RegExp(
  String.raw`(?:^|[\s"'\`])(?:${SPACING_PREFIXES.join('|')})-\[(?![^\]]*(?:%|calc\(|env\(|var\(|--|fr\b|vw|vh|ch\b|auto))[^\]]+\]`,
  'g',
);

/** Inline style keys that must never hold a static spacing value. */
const INLINE_SPACING = /(?:^|[{,\s])(margin|padding|gap|rowGap|columnGap)(?:Top|Right|Bottom|Left|Block|Inline)?\s*:/g;

/** Values that are allowed in an inline style because they are computed. */
const DYNAMIC_VALUE = /\$\{|calc\(|env\(|var\(|`|'\s*\+|\+\s*'/;

const files = globSync('**/*.{ts,tsx}', { cwd: SRC })
  .map((f) => path.join(SRC, f))
  /*
   * Vendored code is exempt. `components/ui` is shadcn and `components/godui` is
   * the GodUI registry: both are copied into the repo as source, but they are
   * upstream's files. Holding them to this project's spacing scale would mean
   * either editing them (and losing the ability to re-pull them) or carrying a
   * permanent list of exceptions. The rule is for the code written here.
   */
  .filter((f) => {
    const rel = path.relative(SRC, f);
    return !rel.startsWith(`components${path.sep}ui${path.sep}`) &&
      !rel.startsWith(`components${path.sep}godui${path.sep}`);
  });

const problems = [];
const perDir = new Map();

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  const dir = path.dirname(rel).replace(/^src\//, '');

  const lines = source.split('\n');

  /*
   * The inline-spacing rule only applies inside a JSX `style={{ … }}` object.
   * Matching a bare `gap:` anywhere would flag plain objects — a tailwind-merge
   * class-group config, a chart options bag — which have nothing to do with
   * layout. So track whether the current line is inside a style block.
   */
  let styleDepth = 0;

  lines.forEach((line, i) => {
    // Skip comments — this file and the conventions doc both quote bad examples.
    const trimmed = line.trim();
    const isComment =
      trimmed.startsWith('*') ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*');

    const opensStyle = /style=\{\{/.test(line);
    if (opensStyle) styleDepth += 1;
    const insideStyle = styleDepth > 0;

    if (!isComment) {
      for (const match of line.matchAll(ARBITRARY)) {
        const value = match[0].trim();
        // `w-[--x]` style CSS-variable references are fine.
        if (/\[--/.test(value)) continue;
        problems.push({ file: rel, line: i + 1, kind: 'arbitrary-spacing', value });
      }

      if (insideStyle && INLINE_SPACING.test(line) && !DYNAMIC_VALUE.test(line)) {
        const match = line.match(INLINE_SPACING);
        problems.push({
          file: rel,
          line: i + 1,
          kind: 'inline-spacing',
          value: match?.[0] ?? 'spacing',
        });
      }
    }

    // `}}` closes the style object. Count them so nested objects are handled.
    if (insideStyle) {
      const closes = (line.match(/\}\}/g) ?? []).length;
      if (closes > 0) styleDepth = Math.max(0, styleDepth - closes);
    }
  });

  perDir.set(dir, (perDir.get(dir) ?? 0) + problems.filter((p) => p.file === rel).length);
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ problems, perDir: Object.fromEntries(perDir) }, null, 2));
} else if (problems.length === 0) {
  console.log('spacing: clean — no arbitrary spacing values, no static inline spacing');
  console.log(`  checked ${files.length} files`);
  const dirs = [...perDir.entries()].filter(([, n]) => n > 0);
  if (dirs.length) console.log('  drift by directory:', dirs.map(([d, n]) => `${d}:${n}`).join(' '));
} else {
  console.error(`spacing: ${problems.length} problem(s)\n`);
  const byFile = new Map();
  for (const p of problems) {
    if (!byFile.has(p.file)) byFile.set(p.file, []);
    byFile.get(p.file).push(p);
  }
  for (const [file, list] of byFile) {
    console.error(`  ${file}`);
    for (const p of list) console.error(`    ${p.line}  ${p.kind}: ${p.value}`);
  }
  console.error(
    '\nUse the layout tokens (p-card, px-gutter, gap-stack, px-row) or Tailwind\'s scale.\n' +
      'See GODUI-CONVENTIONS.md.',
  );
  process.exit(1);
}
