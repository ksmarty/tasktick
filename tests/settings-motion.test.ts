/**
 * The reduced-motion rule and the Low Power Mode heuristic.
 *
 * Both are pure functions on purpose: the fold between the in-app preference and
 * the OS query is the whole feature, and the heuristic is a guess that must be
 * measurable rather than asserted from a screenshot.
 */
import { readFileSync } from 'node:fs';
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

/*
 * The regression that cost the user every animation.
 *
 * The probe video is created without a src. On desktop a sourceless play()
 * rejects as NotSupportedError and answers nothing, but on iOS Safari it rejects
 * with NotAllowedError — the same error Low Power Mode produces. The probe
 * reported low power on a healthy phone, and because resolveReducedMotion folds
 * that into every motion decision, the completion burst AND the row collapse both
 * disappeared. One unverifiable guess, silently, and the symptom looked like two
 * unrelated bugs.
 *
 * The gate is HAVE_METADATA, and it is pinned here rather than left to a comment:
 * a video with no media may not answer at all, so the failure direction is the
 * safe one — no verdict, no change, animations keep running.
 */
describe('the low-power verdict needs real media', () => {
  const SOURCE = readFileSync(new URL('../src/lib/motion.ts', import.meta.url), 'utf8');

  it('refuses to answer from a video that never loaded', () => {
    expect(SOURCE).toContain('if (answered && video.readyState >= 1) setLowPowerInferred(lowPower);');
    // The ungated form is what shipped, and is what must not come back.
    expect(SOURCE).not.toContain('if (answered) setLowPowerInferred(lowPower);');
  });

  it('creates its probe without media, which is why the gate is load-bearing', () => {
    // If a real source is ever added, this test should be replaced by one that
    // pins the media instead — not simply deleted.
    const probe = SOURCE.slice(SOURCE.indexOf('function createProbeVideo'));
    const body = probe.slice(0, probe.indexOf('return video;'));
    expect(body).not.toContain('.src = ');
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
