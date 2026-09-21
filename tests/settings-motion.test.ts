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
  getMotionPreferences,
  parseReducedMotion,
  probeLowPower,
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

describe('probeLowPower', () => {
  it('reads Low Power Mode off an autoplay refusal', async () => {
    const refusal = Object.assign(new Error('play() failed'), { name: 'NotAllowedError' });
    await expect(probeLowPower(() => Promise.reject(refusal))).resolves.toEqual({
      lowPower: true,
      answered: true,
    });
  });

  it('reports normal when playback starts', async () => {
    await expect(probeLowPower(() => Promise.resolve(undefined))).resolves.toEqual({
      lowPower: false,
      answered: true,
    });
  });

  /*
   * The important case. A rejection for any other reason says nothing about the
   * battery, and answering "low power" anyway would switch the user's motion off
   * on the strength of an unrelated failure.
   */
  it('answers nothing when the rejection is not an autoplay refusal', async () => {
    const other = Object.assign(new Error('no source'), { name: 'NotSupportedError' });
    await expect(probeLowPower(() => Promise.reject(other))).resolves.toEqual({
      lowPower: false,
      answered: false,
    });
  });

  it('answers nothing when the failure is not an error object at all', async () => {
    await expect(probeLowPower(() => Promise.reject('nope'))).resolves.toEqual({
      lowPower: false,
      answered: false,
    });
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
