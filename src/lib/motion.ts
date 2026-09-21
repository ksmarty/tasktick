'use client';

/**
 * The app's single reduced-motion source.
 *
 * The OS `prefers-reduced-motion` query is a floor, not the whole answer: this is
 * a self-hosted app and its user may want less motion without changing the
 * setting for every app on the device. So the effective value folds two inputs:
 *
 *   effective = pref === 'reduce' || (pref === 'system' && osPrefersReduced)
 *
 * A `'reduce'` preference therefore wins even when the OS asks for motion, and a
 * `'system'` preference still follows the OS. There is deliberately no
 * "force motion" value: a user who has asked their OS for less motion should
 * never have an app overrule them.
 *
 * ## Why a module store rather than a prop or a provider
 *
 * The callers are the shared GodUI primitives (`accordion`, `dynamic-island`,
 * `segmented-control`, `tab-bar`, …) that render on screens this feature does not
 * own, including the signed-out routes. Threading a prop through every one of
 * them, or wrapping the whole app in a provider, would be far more invasive than
 * a tiny external store. The store is seeded from a cookie (the same mechanism
 * the theme already uses) so a reload does not lose the preference before the
 * database round trip, and `applyServerMotionPreferences` refreshes it from the
 * persisted value once the settings response arrives.
 *
 * ## The Low Power Mode heuristic (opt-in, and honest about it)
 *
 * There is no web API for Low Power Mode. iOS Safari throttles
 * `requestAnimationFrame` to roughly 30 fps under it, so the workable signal is
 * that frames take materially longer than the display's refresh interval. The
 * inference is opt-in, is only attempted while the tab is visible, and is a
 * *heuristic*: a slow device, a busy main thread or a genuinely 30 fps display
 * will read as low power. It is never persisted — only the user's choice to run
 * it is.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { useReducedMotion as useFramerReducedMotion } from 'framer-motion';
import type { ReducedMotionPreference } from './types';

export const REDUCED_MOTION_COOKIE = 'tasktick-motion';
export const LOW_POWER_COOKIE = 'tasktick-motion-low-power';

/** What the app knows about motion at any moment. */
export interface MotionPreferences {
  /** The stored preference. */
  reducedMotion: ReducedMotionPreference;
  /** Whether the user opted in to the Low Power Mode inference. */
  reduceMotionLowPower: boolean;
  /** The last inference result. Never persisted. */
  lowPowerInferred: boolean;
}

/** What the server renders: no cookie, no OS query, no sampling. */
const SERVER_STATE: MotionPreferences = {
  reducedMotion: 'system',
  reduceMotionLowPower: false,
  lowPowerInferred: false,
};

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string): void {
  if (typeof document === 'undefined') return;
  // A year, path-wide, SameSite=Lax — the same shape the theme cookie uses.
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; SameSite=Lax`;
}

/** Anything other than the exact string `reduce` means "follow the OS". */
export function parseReducedMotion(value: string | null | undefined): ReducedMotionPreference {
  return value === 'reduce' ? 'reduce' : 'system';
}

function initialState(): MotionPreferences {
  return {
    reducedMotion: parseReducedMotion(readCookie(REDUCED_MOTION_COOKIE)),
    reduceMotionLowPower: readCookie(LOW_POWER_COOKIE) === '1',
    lowPowerInferred: false,
  };
}

let state: MotionPreferences = initialState();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): MotionPreferences {
  return state;
}

function getServerSnapshot(): MotionPreferences {
  return SERVER_STATE;
}

/** Reads the current preferences without subscribing (event handlers, etc.). */
export function getMotionPreferences(): MotionPreferences {
  return state;
}

/**
 * Writes the preference and mirrors it into the cookie so a reload (and the
 * server's next render) sees it immediately. The inference result is never a
 * parameter here — it is owned by the sampler.
 */
export function setMotionPreferences(
  next: Partial<Pick<MotionPreferences, 'reducedMotion' | 'reduceMotionLowPower'>>,
): void {
  const merged: MotionPreferences = { ...state, ...next };
  if (
    merged.reducedMotion === state.reducedMotion &&
    merged.reduceMotionLowPower === state.reduceMotionLowPower
  ) {
    return;
  }
  state = merged;
  writeCookie(REDUCED_MOTION_COOKIE, merged.reducedMotion);
  writeCookie(LOW_POWER_COOKIE, merged.reduceMotionLowPower ? '1' : '0');
  emit();
}

/**
 * Seeds the store from the persisted settings once they load. This is what makes
 * the preference follow the account to a new device, where the cookie is absent.
 */
export function applyServerMotionPreferences(
  reducedMotion: ReducedMotionPreference | string | null | undefined,
  reduceMotionLowPower: boolean | null | undefined,
): void {
  setMotionPreferences({
    reducedMotion: parseReducedMotion(reducedMotion),
    reduceMotionLowPower: Boolean(reduceMotionLowPower),
  });
}

function setLowPowerInferred(value: boolean): void {
  if (state.lowPowerInferred === value) return;
  state = { ...state, lowPowerInferred: value };
  emit();
}

/* -------------------------------------------------------------------------- */
/* folding the two inputs                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The one place the effective value is decided. Pure so the rule is testable
 * without a DOM:
 *
 *   pref === 'reduce' || (pref === 'system' && (osPrefersReduced || lowPower))
 */
export function resolveReducedMotion(
  pref: ReducedMotionPreference,
  osPrefersReduced: boolean,
  lowPowerInferred: boolean,
): boolean {
  if (pref === 'reduce') return true;
  return osPrefersReduced || lowPowerInferred;
}

/* -------------------------------------------------------------------------- */
/* low power inference                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The error an autoplay rejection carries when it was *refused* rather than
 * failed. On iOS, Low Power Mode blocks autoplay even for a muted inline video,
 * and this is the name the rejection comes back with — so the rejection is not a
 * failure to handle, it is the signal.
 */
const AUTOPLAY_REFUSED = 'NotAllowedError';

export interface LowPowerProbeResult {
  lowPower: boolean;
  /** False when the probe could not reach a verdict and `lowPower` is a default. */
  answered: boolean;
}

/**
 * Reads Low Power Mode off an autoplay attempt.
 *
 * Takes the `play` function rather than a video element so the rule is testable
 * without a DOM: the caller supplies a promise that resolves when playback
 * starts and rejects with `NotAllowedError` when the platform refuses.
 *
 * **This replaced an inference from frame timings**, which sampled
 * `requestAnimationFrame` deltas and read a slow mean as Low Power Mode. That
 * was a guess: a slow device, a busy main thread and a background tab all look
 * the same as Low Power Mode, and any of them silently turned the user's
 * animations off. An autoplay refusal is the platform stating the fact.
 *
 * A rejection for any *other* reason answers nothing, and the caller keeps
 * whatever it had — an unrelated failure must never be read as "low power",
 * because the cost of a wrong yes is the user's motion preference being
 * overridden.
 */
export async function probeLowPower(play: () => Promise<unknown>): Promise<LowPowerProbeResult> {
  try {
    await play();
    return { lowPower: false, answered: true };
  } catch (error) {
    const name = (error as { name?: unknown } | null | undefined)?.name;
    if (name === AUTOPLAY_REFUSED) return { lowPower: true, answered: true };
    return { lowPower: false, answered: false };
  }
}

/** How often to re-probe while the opt-in is on, so LPM turning on is noticed. */
const RESAMPLE_INTERVAL_MS = 60_000;

let samplerUsers = 0;
let resampleTimer: ReturnType<typeof setInterval> | null = null;
let probing = false;
let probeGeneration = 0;

/**
 * A muted, inline, invisible video, created only to be asked to play.
 *
 * It is never in the shipped HTML — it exists for the length of one probe and is
 * removed as soon as the answer arrives. `sr-only` rather than inline styles does
 * the hiding: the element is 1px, clipped and out of flow, so neither it nor the
 * play button iOS paints over a refused autoplay can be seen. That is also why no
 * `::-webkit-media-controls` rule is needed here — there is nothing on screen for
 * controls to sit on.
 */
function createProbeVideo(): HTMLVideoElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  const video = document.createElement('video');
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('aria-hidden', 'true');
  video.tabIndex = -1;
  video.preload = 'auto';
  video.className = 'sr-only';
  document.body.appendChild(video);
  return video;
}

/**
 * Ends the current probe's authority. An in-flight answer is dropped rather than
 * applied, so a probe that started before the app was hidden cannot set the
 * preference afterwards.
 */
function stopSampling(): void {
  probeGeneration += 1;
  probing = false;
}

function startSampling(): void {
  if (typeof document === 'undefined') return;
  /*
   * A hidden tab is throttled by the browser by design. The old frame-timing
   * probe had to guard against that explicitly; an autoplay refusal is unaffected
   * by throttling, but a probe in a hidden tab is still wasted work that can be
   * refused for reasons which are not Low Power Mode, so it is skipped.
   */
  if (document.visibilityState !== 'visible') return;
  if (probing) return;

  const video = createProbeVideo();
  if (!video || typeof video.play !== 'function') {
    video?.remove();
    return;
  }

  probing = true;
  const generation = probeGeneration;
  void probeLowPower(() => video.play()).then(({ lowPower, answered }) => {
    video.remove();
    if (generation !== probeGeneration) return;
    probing = false;
    // An unanswered probe leaves the previous value alone: only the platform
    // saying "no" may turn the user's motion off.
    if (answered) setLowPowerInferred(lowPower);
  });
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'visible') startSampling();
  else stopSampling();
}

function attachSampler(): void {
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange);
  startSampling();
  // Low Power Mode can be switched on while the app is open, so re-measure
  // periodically rather than only at mount.
  if (typeof window !== 'undefined') {
    resampleTimer = setInterval(() => {
      if (document.visibilityState === 'visible') startSampling();
    }, RESAMPLE_INTERVAL_MS);
  }
}

function detachSampler(): void {
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange);
  if (resampleTimer !== null) {
    clearInterval(resampleTimer);
    resampleTimer = null;
  }
  stopSampling();
  setLowPowerInferred(false);
}

/**
 * Ref-counted so the (potentially many) components that call the motion hook
 * share exactly one probe rather than each running their own.
 */
function useLowPowerSampler(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) {
      setLowPowerInferred(false);
      return;
    }
    samplerUsers += 1;
    if (samplerUsers === 1) attachSampler();
    return () => {
      samplerUsers -= 1;
      if (samplerUsers === 0) detachSampler();
    };
  }, [enabled]);
}

/* -------------------------------------------------------------------------- */
/* hooks                                                                      */
/* -------------------------------------------------------------------------- */

export function useMotionPreferences(): MotionPreferences {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * The app-level reduced-motion hook. Components should import this instead of
 * `useReducedMotion` from `framer-motion`, which only reads the OS.
 */
export function useReducedMotion(): boolean {
  const osPrefersReduced = useFramerReducedMotion() ?? false;
  const preferences = useMotionPreferences();
  useLowPowerSampler(preferences.reduceMotionLowPower);
  return resolveReducedMotion(preferences.reducedMotion, osPrefersReduced, preferences.lowPowerInferred);
}

/**
 * The same fold for event handlers and imperative code that cannot use a hook
 * (a confetti burst fired from a click, for example). It reads the last sampler
 * result rather than starting one.
 */
export function appReducedMotionNow(): boolean {
  const osPrefersReduced =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
  return resolveReducedMotion(state.reducedMotion, osPrefersReduced, state.lowPowerInferred);
}
