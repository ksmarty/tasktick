import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cn, FONT_SIZE_TOKENS, RADIUS_TOKENS, SHADOW_TOKENS, TEXT_COLOR_TOKENS } from '@/lib/cn';

/**
 * Regression guard for a silent, app-wide bug: tailwind-merge does not know this
 * project's custom tokens, so it classified `text-footnote` and `text-secondary`
 * as the same class group and kept only the last one. Font sizes vanished with
 * no error — text simply inherited the body size everywhere.
 */
describe('cn — custom token handling', () => {
  it('keeps a font size when combined with a text colour', () => {
    for (const size of FONT_SIZE_TOKENS) {
      for (const colour of ['text-secondary', 'text-label', 'text-tertiary', 'text-tint', 'text-danger']) {
        const out = cn(`text-${size}`, colour);
        expect(out, `${size} + ${colour}`).toContain(`text-${size}`);
        expect(out, `${size} + ${colour}`).toContain(colour);
      }
    }
  });

  it('keeps the colour when a caller overrides only the size', () => {
    expect(cn('text-footnote text-secondary', 'text-subhead')).toBe('text-secondary text-subhead');
  });

  it('still resolves genuine conflicts the way tailwind-merge should', () => {
    // Two font sizes: the later wins.
    expect(cn('text-body', 'text-footnote')).toBe('text-footnote');
    // Two colours: the later wins.
    expect(cn('text-label', 'text-secondary')).toBe('text-secondary');
    // Conditional composition still works.
    expect(cn('base', false && 'x', undefined, 'text-footnote text-secondary')).toBe('base text-footnote text-secondary');
  });

  it('keeps the custom radius and shadow scales', () => {
    for (const r of RADIUS_TOKENS) expect(cn(`rounded-${r}`, 'bg-card')).toContain(`rounded-${r}`);
    for (const s of SHADOW_TOKENS) expect(cn(`shadow-${s}`, 'rounded-ios')).toContain(`shadow-${s}`);
    // And resolves conflicts within them.
    expect(cn('rounded-ios-md', 'rounded-ios-lg')).toBe('rounded-ios-lg');
  });
});

/**
 * The token lists are hand-maintained mirrors of @theme in globals.css. This is
 * what stops them drifting: add a font size to the CSS without adding it here and
 * the suite fails, rather than the size silently disappearing in the UI.
 */
describe('cn — token lists mirror globals.css', () => {
  const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');

  it('declares every custom font size that globals.css defines', () => {
    // `--text-body--line-height` and friends are sub-properties of a ramp step,
    // not ramp steps themselves, so names containing `--` are excluded.
    const inCss = [...css.matchAll(/--text-([a-z0-9-]+):/g)]
      .map((m) => m[1])
      .filter((name) => !name.includes('--'));

    const missing = [...new Set(inCss)].filter((n) => !(FONT_SIZE_TOKENS as readonly string[]).includes(n));
    expect(missing, `missing from FONT_SIZE_TOKENS: ${missing.join(', ')}`).toEqual([]);
  });

  it('declares every ios-* colour that globals.css defines', () => {
    const inCss = [...css.matchAll(/--ios-([a-z]+):/g)].map((m) => `ios-${m[1]}`);
    const missing = [...new Set(inCss)].filter((c) => !(TEXT_COLOR_TOKENS as readonly string[]).includes(c));
    expect(missing, `missing from TEXT_COLOR_TOKENS: ${missing.join(', ')}`).toEqual([]);
  });
});
