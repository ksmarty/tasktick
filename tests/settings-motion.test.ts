/**
 * The reduced-motion rule and the Low Power Mode heuristic.
 *
 * Both are pure functions on purpose: the fold between the in-app preference and
 * the OS query is the whole feature, and the heuristic is a guess that must be
 * measurable rather than asserted from a screenshot.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyServerMotionPreferences,
  detectLowPowerFromFrameDeltas,
  getMotionPreferences,
  parseReducedMotion,
  resolveReducedMotion,
  setMotionPreferences,
} from '@/lib/motion';

describe('resolveReducedMotion', () => {
  it('honours an explicit reduce even when the OS asks for motion', () => {
    expect(resolveReducedMotion('reduce', false, false)).toBe(true);
  });

  it('honours the OS when the preference is system', () => {
    expect(resolveReducedMotion('system', true, false)).toBe(true);
  });

  it('does not reduce when neither the preference nor the OS asks', () => {
    expect(resolveReducedMotion('system', false, false)).toBe(false);
  });

  it('reduces when the low-power heuristic fired under a system preference', () => {
    expect(resolveReducedMotion('system', false, true)).toBe(true);
  });

  it('is already reduced regardless of the heuristic', () => {
    expect(resolveReducedMotion('reduce', true, true)).toBe(true);
  });
});

describe('parseReducedMotion', () => {
  it('accepts the exact value', () => {
    expect(parseReducedMotion('reduce')).toBe('reduce');
  });

  it('falls back to system for anything else', () => {
    expect(parseReducedMotion('system')).toBe('system');
    expect(parseReducedMotion(null)).toBe('system');
    expect(parseReducedMotion(undefined)).toBe('system');
    expect(parseReducedMotion('REDUCE')).toBe('system');
    expect(parseReducedMotion('')).toBe('system');
  });
});

describe('detectLowPowerFromFrameDeltas', () => {
  const frames = (deltaMs: number, count = 30) => Array.from({ length: count }, () => deltaMs);

  it('reports low power for ~30 fps frames', () => {
    expect(detectLowPowerFromFrameDeltas(frames(1000 / 30))).toBe(true);
  });

  it('reports normal for ~60 fps frames', () => {
    expect(detectLowPowerFromFrameDeltas(frames(1000 / 60))).toBe(false);
  });

  it('reports normal when there is not enough evidence', () => {
    expect(detectLowPowerFromFrameDeltas(frames(1000 / 30, 5))).toBe(false);
  });

  it('ignores suspended-tab gaps instead of reading them as slow frames', () => {
    // Ten ~1000 ms gaps (a hidden tab) plus real 60 fps frames must not trip it.
    const deltas = [...frames(1000, 10), ...frames(1000 / 60, 20)];
    expect(detectLowPowerFromFrameDeltas(deltas)).toBe(false);
  });

  it('ignores non-positive and non-finite samples', () => {
    const deltas = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, ...frames(1000 / 60, 20)];
    expect(detectLowPowerFromFrameDeltas(deltas)).toBe(false);
  });
});

describe('the motion store', () => {
  beforeEach(() => {
    setMotionPreferences({ reducedMotion: 'system', reduceMotionLowPower: false });
  });

  it('writes a preference and reads it back', () => {
    setMotionPreferences({ reducedMotion: 'reduce' });
    expect(getMotionPreferences().reducedMotion).toBe('reduce');
  });

  it('adopts the persisted settings, which is how a new device catches up', () => {
    applyServerMotionPreferences('reduce', true);
    expect(getMotionPreferences().reducedMotion).toBe('reduce');
    expect(getMotionPreferences().reduceMotionLowPower).toBe(true);
  });

  it('coerces an unknown stored value to system', () => {
    applyServerMotionPreferences('nonsense', null);
    expect(getMotionPreferences().reducedMotion).toBe('system');
    expect(getMotionPreferences().reduceMotionLowPower).toBe(false);
  });
});
