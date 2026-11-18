import { Error, Loading } from '@/components/shared';
import useApi, { send } from 'hooks/useApi';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import toast from 'react-hot-toast';
import PushToggle from '@/components/pwa/PushToggle';
import InstallPrompt from '@/components/pwa/InstallPrompt';

type N = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};
type Pref = {
  type: string;
  label: string;
  inApp: boolean;
  email: boolean;
  push: boolean;
};

export const Notifications = () => {
  const { t } = useTranslation('common');
  const list = useApi<{ notifications: N[]; unread: number }>(
    '/api/notifications'
  );
  const prefs = useApi<Pref[]>('/api/notifications/preferences');

  if (list.isLoading) return <Loading />;
  if (list.isError) return <Error message={list.isError.message} />;

  const markAll = async () => {
    await send('/api/notifications', 'POST', { all: true });
    list.refresh();
  };

  const savePref = async (p: Pref, patch: Partial<Pref>) => {
    const r = await send('/api/notifications/preferences', 'PUT', {
      preferences: [
        {
          type: p.type,
          inApp: p.inApp,
          email: p.email,
          push: p.push,
          ...patch,
        },
      ],
    });

    if (!r.ok) toast.error(r.error as string);

    prefs.refresh();
  };

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center">
          <h2 className="mr-auto text-xl font-medium">
            {t('notifications', 'Notifications')}
          </h2>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!list.data?.unread}
            onClick={markAll}
          >
            {t('mark-all-read', 'Mark all as read')}
          </button>
        </div>
        {list.data?.notifications.length === 0 && (
          <p className="text-sm opacity-70">
            {t('no-notifications', 'No notifications.')}
          </p>
        )}
        <ul className="space-y-2">
          {(list.data?.notifications ?? []).map((n) => (
            <li
              key={n.id}
              className={`rounded border p-3 text-sm ${n.readAt ? 'opacity-60' : 'border-primary'}`}
            >
              {n.link ? (
                <Link className="link font-medium" href={n.link}>
                  {n.title}
                </Link>
              ) : (
                <span className="font-medium">{n.title}</span>
              )}
              {n.body && <p>{n.body}</p>}
              <p className="text-xs opacity-60">
                {new Date(n.createdAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <PushToggle />
        <InstallPrompt />
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">
          {t('notification-preferences', 'Preferences')}
        </h3>
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>{t('type', 'Type')}</th>
                <th>{t('in-app', 'In-app')}</th>
                <th>{t('email')}</th>
                <th>{t('push', 'Push')}</th>
              </tr>
            </thead>
            <tbody>
              {(prefs.data ?? []).map((p) => (
                <tr key={p.type}>
                  <td>{p.label}</td>
                  <td>
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm"
                      aria-label={`${p.label} in-app`}
                      checked={p.inApp}
                      onChange={(e) => savePref(p, { inApp: e.target.checked })}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm"
                      aria-label={`${p.label} email`}
                      checked={p.email}
                      onChange={(e) => savePref(p, { email: e.target.checked })}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm"
                      aria-label={`${p.label} push`}
                      checked={p.push}
                      onChange={(e) => savePref(p, { push: e.target.checked })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default Notifications;
