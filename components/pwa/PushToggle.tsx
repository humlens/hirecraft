import useApi, { send } from 'hooks/useApi';
import { urlBase64ToUint8Array } from '@/lib/pwa';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';

type State =
  'loading' | 'unsupported' | 'disabled-by-server' | 'blocked' | 'off' | 'on';

/**
 * Opt-in to Web Push on THIS device. Nothing is requested until the user taps
 * the button, and subscribing is the consent that lets the server push.
 */
const PushToggle = () => {
  const { t } = useTranslation('common');
  const cfg = useApi<{ enabled: boolean; publicKey: string | null }>(
    '/api/push/config'
  );
  const [state, setState] = useState<State>('loading');
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    if (
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      setState('unsupported');
      return;
    }

    if (cfg.data && !cfg.data.enabled) {
      setState('disabled-by-server');
      return;
    }

    if (Notification.permission === 'denied') {
      setState('blocked');
      return;
    }

    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();

    setState(sub ? 'on' : 'off');
  }, [cfg.data]);

  useEffect(() => {
    if (cfg.data) check();
  }, [cfg.data, check]);

  const enable = async () => {
    if (!cfg.data?.publicKey) return;

    setBusy(true);

    try {
      const permission = await Notification.requestPermission();

      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'blocked' : 'off');
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(cfg.data.publicKey),
      });
      const r = await send('/api/push/subscribe', 'POST', sub.toJSON());

      if (!r.ok) {
        await sub.unsubscribe();
        toast.error(r.error as string);
        return;
      }

      setState('on');
      toast.success(t('push-enabled', 'Notifications are on for this device.'));
    } catch (error) {
      console.error(error);
      toast.error(
        t('push-failed', 'Could not turn on notifications on this device.')
      );
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);

    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();

      if (sub) {
        await send('/api/push/subscribe', 'DELETE', { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }

      setState('off');
    } finally {
      setBusy(false);
    }
  };

  const text: Partial<Record<State, string>> = {
    unsupported: t(
      'push-unsupported',
      'This browser does not support push notifications.'
    ),
    'disabled-by-server': t(
      'push-server-off',
      'Push notifications are not enabled on this server.'
    ),
    blocked: t(
      'push-blocked',
      'Notifications are blocked in your browser settings for this site.'
    ),
  };

  return (
    <div className="space-y-2 rounded-lg border p-4">
      <h3 className="font-semibold">
        {t('push-title', 'Push notifications on this device')}
      </h3>
      {text[state] && <p className="text-sm opacity-70">{text[state]}</p>}
      {state === 'off' && (
        <>
          <p className="text-sm opacity-70">
            {t(
              'push-explain',
              'Get interview reminders and updates even when the app is closed. You can turn this off at any time.'
            )}
          </p>
          <button
            type="button"
            className="btn btn-primary btn-sm min-h-11"
            disabled={busy}
            onClick={enable}
          >
            {t('push-enable', 'Turn on notifications')}
          </button>
        </>
      )}
      {state === 'on' && (
        <button
          type="button"
          className="btn btn-sm min-h-11"
          disabled={busy}
          onClick={disable}
        >
          {t('push-disable', 'Turn off notifications on this device')}
        </button>
      )}
    </div>
  );
};

export default PushToggle;
