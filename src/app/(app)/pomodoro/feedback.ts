'use client';

/**
 * End-of-period feedback: a synthesised chime and a local notification.
 *
 * No audio files: the chime is two short oscillator blips built on demand
 * (`AudioContext`), which keeps the app installable without shipping assets and
 * lets the tone follow the system volume exactly.
 *
 * Everything here is guarded on a real user gesture. Browsers refuse to start an
 * audio context — and iOS refuses to show a notification — without one, and a
 * page that fires a sound at a user who never touched it is a page that gets
 * muted. Notification permission is never *requested* here either: the timer
 * only uses permission the user already granted in Settings.
 */

let audioContext: AudioContext | null = null;

interface AudioCapableWindow extends Window {
  webkitAudioContext?: typeof AudioContext;
}

/** Whether the user has interacted with the page in this session. */
export function hasUserInteracted(): boolean {
  if (typeof navigator === 'undefined') return false;
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive?: boolean } }).userActivation;
  return activation?.hasBeenActive ?? false;
}

/**
 * Plays a short two-note chime. Returns false when the browser would not allow
 * it (no Web Audio, or no audio context yet and no gesture to unlock one).
 */
export function playChime(): boolean {
  if (typeof window === 'undefined') return false;
  if (!hasUserInteracted() && !audioContext) return false;

  try {
    const Ctor = window.AudioContext ?? (window as AudioCapableWindow).webkitAudioContext;
    if (!Ctor) return false;

    audioContext ??= new Ctor();
    if (audioContext.state === 'suspended') void audioContext.resume();

    const start = audioContext.currentTime;
    const notes = [880, 1174.66];

    notes.forEach((frequency, index) => {
      const oscillator = audioContext!.createOscillator();
      const gain = audioContext!.createGain();
      const at = start + index * 0.18;

      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      // Exponential ramps cannot reach or start from zero, hence the tiny floor.
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.22, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.36);

      oscillator.connect(gain);
      gain.connect(audioContext!.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.4);
    });

    return true;
  } catch {
    return false;
  }
}

/**
 * Shows a device notification, but only with permission the user already gave.
 *
 * Goes through the service worker when one controls the page, which is the only
 * path iOS offers; falls back to the plain `Notification` constructor on the
 * desktop browsers that have no controlling worker.
 */
export async function notifyPeriodEnd(title: string, body: string): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;
  if (!hasUserInteracted()) return false;

  const options: NotificationOptions = { body, tag: 'tasktick-pomodoro', icon: '/icons/icon-192.png' };

  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        await registration.showNotification(title, options);
        return true;
      }
    }
    new Notification(title, options);
    return true;
  } catch {
    return false;
  }
}
