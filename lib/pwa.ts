/** Browser-side PWA helpers. Everything is optional: the app works without them. */

export function registerServiceWorker() {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    process.env.NODE_ENV !== 'production'
  ) {
    return;
  }

  const register = () =>
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((error) => console.error('service worker failed', error));

  // this runs after hydration, so the load event has usually fired already
  if (document.readyState === 'complete') {
    register();
  } else {
    window.addEventListener('load', register, { once: true });
  }
}

/** On sign-out: forget every stored page and drop this device's push subscription. */
export async function clearPwaState() {
  try {
    if (!('serviceWorker' in navigator)) return;

    const reg = await navigator.serviceWorker.getRegistration();

    reg?.active?.postMessage({ type: 'CLEAR_CACHES' });
  } catch {
    // best effort
  }
}

export const urlBase64ToUint8Array = (b64: string) => {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + padding).replace(/-/g, '+').replace(/_/g, '/'));

  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
