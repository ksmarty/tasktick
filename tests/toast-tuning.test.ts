/**
 * The toast tuning and the vendored stack's local edit.
 *
 * These are values the user asked to change, and a re-vendor of `godui/toast`
 * would silently restore the old one. The app wrapper is the place to prefer
 * changes; the one that had to live in the vendored file is pinned here so the
 * `LOCAL CHANGE` marker is not the only record.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relative: string): string {
  return readFileSync(new URL(`../src/${relative}`, import.meta.url), 'utf8');
}

const WRAPPER = source('components/app/Toast.tsx');
const STACK = source('components/godui/toast.tsx');

describe('the app toast dwell time', () => {
  it('is shorter than the old 3.2s', () => {
    expect(WRAPPER).toContain('const DEFAULT_DURATION = 2500;');
    expect(WRAPPER).not.toContain('const DEFAULT_DURATION = 3200;');
  });

  it('leaves the deliberately persistent toast alone', () => {
    expect(WRAPPER).toContain('const PERSISTENT_DURATION = 2 ** 31 - 1;');
    expect(WRAPPER).toContain('banner.duration === 0 ? PERSISTENT_DURATION : banner.duration');
  });
});

describe('the collapsed stack', () => {
  it('peeks 8px, marked as a local change', () => {
    expect(STACK).toContain('const PEEK = 8; // LOCAL CHANGE: was 16');
  });

  it('still caps the collapsed pile at three', () => {
    expect(STACK).toContain('const MAX_VISIBLE = 3;');
    expect(STACK).toContain('index >= MAX_VISIBLE');
  });

  it('keeps the live region', () => {
    expect(STACK).toContain('aria-live="polite"');
  });
});
