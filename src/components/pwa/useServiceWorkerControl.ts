'use client';

import { useEffect, useState } from 'react';

/**
 * Whether a service worker is currently controlling this page.
 *
 * The offline layer cannot store anything a request that did not pass through
 * the worker. `navigator.serviceWorker.controller` is null on the very first
 * load — the worker installs *after* the page it is meant to serve — and is set
 * later, either by `clients.claim()` or by a new worker taking over. The only
 * signal for both is `controllerchange`, so the value is re-read on that event
 * rather than sampled once on mount.
 *
 * The initial value is `false` rather than reading `navigator` during render:
 * the server has no service worker, so a first render that disagreed with the
 * server would hydrate a mismatch. The effect corrects it immediately.
 */
export function useServiceWorkerControl(): boolean {
  const [controlled, setControlled] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const container = navigator.serviceWorker;
    const update = () => setControlled(Boolean(container.controller));

    update();
    container.addEventListener('controllerchange', update);
    return () => container.removeEventListener('controllerchange', update);
  }, []);

  return controlled;
}
