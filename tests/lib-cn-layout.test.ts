import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/utils';

describe('cn with the layout scale', () => {
  it('a layout token beats a component default on the same axis', () => {
    // This is the bug the calendar agent hit: shadcn's Card hard-codes py-6,
    // and p-card was silently losing to it.
    expect(cn('py-6 px-6', 'p-card')).toBe('p-card');
  });
  it('a later utility on one axis refines a token without dropping it', () => {
    // `p-card` sets every axis; `py-6` overrides only the block axis, so both
    // must survive — dropping `p-card` would lose the inline padding.
    expect(cn('p-card', 'py-6')).toBe('p-card py-6');
  });
  it('different axes do not conflict', () => {
    expect(cn('p-card', 'gap-stack')).toBe('p-card gap-stack');
  });
  it('layout tokens conflict with each other', () => {
    expect(cn('px-gutter', 'px-row')).toBe('px-row');
    expect(cn('gap-stack', 'gap-gutter')).toBe('gap-gutter');
  });
  it('numeric scale still conflicts with layout tokens', () => {
    expect(cn('px-4', 'px-gutter')).toBe('px-gutter');
    expect(cn('px-gutter', 'px-4')).toBe('px-4');
  });
});
