/**
 * TaskTick PWA client layer.
 *
 * `ServiceWorkerRegistrar` and `OfflineBanner` are app-global: they are mounted
 * once in the root layout via `src/app/providers.tsx`. `InstallPrompt` and
 * `IosInstallHint` are surfaced from the notifications settings screen, where
 * the "install first" precondition is actually relevant to the user.
 *
 * `platform.ts` holds the pure detection helpers for callers that need to branch
 * on iOS/standalone themselves.
 *
 * There is deliberately NO push-permission component here: the notification
 * consent flow lives in `src/components/settings/NotificationSettings.tsx`,
 * because it needs to render the server's VAPID configuration state, the
 * registered-device count and the test-notification action alongside the
 * permission button. A second copy of that flow in this directory would be a
 * second place for the platform rules to drift.
 */
export { ServiceWorkerRegistrar } from './ServiceWorkerRegistrar';
export { OfflineBanner } from './OfflineBanner';
export { useServiceWorkerControl } from './useServiceWorkerControl';
export { InstallPrompt } from './InstallPrompt';
export { IosInstallHint } from './IosInstallHint';
export { isIos, isStandalone, isIosSafari } from './platform';
