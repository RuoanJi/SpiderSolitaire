/**
 * Progressive Web App support: offline service worker, "new version" notice,
 * and the "Install app" prompt (Chrome / Android).
 */

/** Launched from the home screen as an installed app? */
export function isStandalone(): boolean {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    matchMedia('(display-mode: fullscreen)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/** Running inside another page's frame (e.g. a preview)? Service workers and history tricks are skipped there. */
export function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredInstall: InstallPromptEvent | null = null;
let waitingWorker: ServiceWorker | null = null;

export interface PwaHooks {
  /** An install prompt became available (true) or was used up (false). */
  onInstallable(available: boolean): void;
  /** A new version has been downloaded and is ready. */
  onUpdateReady(): void;
  onInstalled(): void;
}

export function initPWA(hooks: PwaHooks) {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we show our own "Install app" menu item instead of the mini-infobar
    deferredInstall = e as InstallPromptEvent;
    hooks.onInstallable(true);
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    hooks.onInstallable(false);
    hooks.onInstalled();
  });

  if (!('serviceWorker' in navigator) || isFramed()) return;
  const secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!secure) return;

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Only reload when the player asked for the update (not on the very first install).
    if (refreshing || !waitingWorker) return;
    refreshing = true;
    location.reload();
  });

  navigator.serviceWorker
    .register('sw.js')
    .then((reg) => {
      const ready = (w: ServiceWorker | null) => {
        if (w && navigator.serviceWorker.controller) {
          waitingWorker = w;
          hooks.onUpdateReady();
        }
      };
      ready(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => w.state === 'installed' && ready(w));
      });
      // Look for updates when the app comes back to the foreground, and hourly.
      document.addEventListener('visibilitychange', () => !document.hidden && reg.update().catch(() => {}));
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    })
    .catch(() => {
      /* e.g. blocked by the browser: the game still works online */
    });
}

/** Switch to the downloaded version (the page reloads). */
export function applyUpdate() {
  waitingWorker?.postMessage('skip-waiting');
}

export async function promptInstall(): Promise<boolean> {
  const e = deferredInstall;
  if (!e) return false;
  deferredInstall = null;
  await e.prompt();
  const choice = await e.userChoice;
  return choice.outcome === 'accepted';
}
