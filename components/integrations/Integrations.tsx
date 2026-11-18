import { Error, Loading } from '@/components/shared';
import useApi, { send } from 'hooks/useApi';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import toast from 'react-hot-toast';

type App = {
  key: string;
  kind: string;
  name: string;
  description: string;
  auth: 'oauth' | 'webhook' | 'link';
  href: string | null;
  entitled: boolean;
  availableOnServer: boolean;
  connected: boolean;
  accountLabel: string | null;
  config: { url?: string; video?: boolean; hasSecret?: boolean } | null;
  lastError: string | null;
};
type Domain = {
  id: string;
  hostname: string;
  verified: boolean;
  certificateStatus: string;
  lastError: string | null;
  records: {
    cname: { name: string; value: string } | null;
    txt: { name: string; value: string };
  };
  url: string | null;
};

const Webhook = ({
  slug,
  app,
  refresh,
}: {
  slug: string;
  app: App;
  refresh: () => void;
}) => {
  const { t } = useTranslation('common');
  const [url, setUrl] = useState(app.config?.url ?? '');
  const [secret, setSecret] = useState('');

  const save = async () => {
    const r = await send(`/api/teams/${slug}/integrations/${app.key}`, 'PUT', {
      url,
      ...(secret ? { secret } : {}),
    });

    if (!r.ok) toast.error(r.error as string);
    else {
      setSecret('');
      toast.success(t('saved', 'Saved.'));
      refresh();
    }
  };

  return (
    <div className="space-y-2">
      <input
        className="input  input-sm w-full"
        aria-label={`${app.name} URL`}
        placeholder="https://partner.example.com/hooks"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <input
        type="password"
        autoComplete="off"
        className="input  input-sm w-full"
        aria-label={`${app.name} signing secret`}
        placeholder={
          app.config?.hasSecret
            ? t('int-secret-saved', 'Signing secret saved')
            : t('int-secret', 'Signing secret (16+ characters)')
        }
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
      />
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={!url}
        onClick={save}
      >
        {t('save-changes')}
      </button>
    </div>
  );
};

const DomainCard = ({ slug, enabled }: { slug: string; enabled: boolean }) => {
  const { t } = useTranslation('common');
  const { data, refresh } = useApi<{ enabled: boolean; domains: Domain[] }>(
    `/api/teams/${slug}/domain`
  );
  const [host, setHost] = useState('');
  const d = data?.domains[0];

  const call = async (path: string, method: string, body?: unknown) => {
    const r = await send(`/api/teams/${slug}/domain${path}`, method, body);

    if (!r.ok) toast.error(r.error as string);

    refresh();
  };

  return (
    <section className="space-y-3 rounded-xl border p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{t('domain-title', 'Custom domain')}</h3>
        <span className="badge badge-sm">
          {t('plan-enterprise', 'Enterprise')}
        </span>
      </div>
      {!enabled && (
        <p className="text-sm opacity-70">
          {t('domain-off', 'Custom domains are not enabled on this server.')}
        </p>
      )}
      {enabled && !d && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            call('', 'POST', { hostname: host });
          }}
        >
          <input
            className="input  input-sm min-w-60 flex-1"
            aria-label={t('domain-host', 'Domain')}
            placeholder="careers.example.com"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          />
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={host.trim().length < 4}
          >
            {t('domain-add', 'Add domain')}
          </button>
        </form>
      )}
      {d && (
        <div className="space-y-2 text-sm">
          <p>
            <strong>{d.hostname}</strong>
          </p>
          {!d.verified && (
            <ol className="list-decimal space-y-1 pl-5">
              {d.records.cname && (
                <li>
                  {t('domain-cname', 'Add a CNAME')}:{' '}
                  <code>{d.records.cname.name}</code> →{' '}
                  <code>{d.records.cname.value}</code>
                </li>
              )}
              <li>
                {t('domain-txt', 'Add a TXT')}:{' '}
                <code>{d.records.txt.name}</code> →{' '}
                <code className="break-all">{d.records.txt.value}</code>
              </li>
              <li>
                {t(
                  'domain-cert',
                  'We serve it over HTTPS automatically after verification.'
                )}
              </li>
            </ol>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {!d.verified && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => call('/verify', 'POST')}
              >
                {t('domain-check', 'Check DNS')}
              </button>
            )}
            <button
              type="button"
              className="btn btn-sm btn-ghost text-error"
              onClick={() => call('', 'DELETE')}
            >
              {t('remove')}
            </button>
            <span
              className={`text-sm font-semibold ${d.verified ? 'text-success' : 'text-warning'}`}
            >
              {d.verified
                ? `${t('domain-live', 'Verified · live at')} ${d.url}`
                : (d.lastError ??
                  t('domain-waiting', 'Waiting for DNS records'))}
            </span>
          </div>
        </div>
      )}
    </section>
  );
};

const Integrations = ({
  slug,
  teamFeatures,
}: {
  slug: string;
  teamFeatures: {
    sso: boolean;
    dsync: boolean;
    webhook: boolean;
    apiKey: boolean;
  };
}) => {
  const { t } = useTranslation('common');
  const router = useRouter();
  const apps = useApi<App[]>(`/api/teams/${slug}/integrations`);

  if (apps.isLoading) return <Loading />;
  if (apps.isError) return <Error message={apps.isError.message} />;

  const connect = async (a: App) => {
    const r = await send<{ url: string }>(
      `/api/teams/${slug}/integrations/${a.key}`,
      'POST'
    );

    if (!r.ok) toast.error(r.error as string);
    else window.location.href = r.data!.url;
  };

  const disconnect = async (a: App) => {
    const r = await send(`/api/teams/${slug}/integrations/${a.key}`, 'DELETE');

    if (!r.ok) toast.error(r.error as string);

    apps.refresh();
  };

  const toggleVideo = async (a: App, video: boolean) => {
    await send(`/api/teams/${slug}/integrations/${a.key}`, 'PUT', { video });
    apps.refresh();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium">
          {t('int-title', 'Integrations, webhooks & domain')}
        </h2>
        <p className="text-sm opacity-70">
          {t(
            'int-note',
            'Connected through official APIs and OAuth only. Nothing is scraped.'
          )}
        </p>
      </div>

      {router.query.connected && (
        <div role="status" className="alert alert-success text-sm">
          {t('int-connected', 'Connected.')}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(apps.data ?? []).map((a) => (
          <article
            key={a.key}
            className="flex flex-col gap-2 rounded-xl border p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <strong>{a.name}</strong>
              {a.connected && (
                <span className="badge badge-success badge-sm">
                  {t('int-on', 'Connected')}
                </span>
              )}
            </div>
            <p className="text-sm opacity-70">{a.description}</p>
            {a.accountLabel && <p className="text-xs">{a.accountLabel}</p>}
            {a.lastError && (
              <p className="text-xs text-warning">{a.lastError}</p>
            )}

            {!a.entitled && (
              <p className="text-xs text-warning">
                {t(
                  'int-upgrade',
                  'Not included in your plan. Upgrade to use it.'
                )}
              </p>
            )}
            {a.entitled && a.auth === 'oauth' && !a.availableOnServer && (
              <p className="text-xs opacity-70">
                {t('int-not-configured', 'Not configured on this server.')}
              </p>
            )}
            {a.entitled &&
              a.auth === 'oauth' &&
              a.availableOnServer &&
              !a.connected && (
                <button
                  type="button"
                  className="btn btn-sm min-h-10"
                  onClick={() => connect(a)}
                >
                  {t('int-connect', 'Connect')}
                </button>
              )}
            {a.entitled && a.auth === 'oauth' && a.connected && (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={a.config?.video !== false}
                    onChange={(e) => toggleVideo(a, e.target.checked)}
                  />
                  {t('int-video', 'Create meeting links')}
                </label>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost text-error"
                  onClick={() => disconnect(a)}
                >
                  {t('int-disconnect', 'Disconnect')}
                </button>
              </>
            )}
            {a.entitled && a.auth === 'webhook' && (
              <>
                <Webhook slug={slug} app={a} refresh={apps.refresh} />
                {a.connected && (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost text-error"
                    onClick={() => disconnect(a)}
                  >
                    {t('int-disconnect', 'Disconnect')}
                  </button>
                )}
              </>
            )}
            {a.auth === 'link' && teamFeatures.webhook && (
              <Link
                className="btn btn-sm min-h-10"
                href={`/teams/${slug}/${a.href}`}
              >
                {t('int-open-webhooks', 'Open webhooks')}
              </Link>
            )}
          </article>
        ))}
      </div>

      <DomainCard slug={slug} enabled />

      <section className="space-y-1 rounded-xl border p-4 text-sm">
        <h3 className="font-semibold">
          {t('int-sso', 'Single sign-on, provisioning & API')}
        </h3>
        <ul className="list-disc pl-5">
          {teamFeatures.sso && (
            <li>
              <Link className="link" href={`/teams/${slug}/sso`}>
                {t('int-link-sso', 'SAML single sign-on')}
              </Link>
            </li>
          )}
          {teamFeatures.dsync && (
            <li>
              <Link className="link" href={`/teams/${slug}/directory-sync`}>
                {t('int-link-scim', 'SCIM directory sync')}
              </Link>
            </li>
          )}
          {teamFeatures.webhook && (
            <li>
              <Link className="link" href={`/teams/${slug}/webhooks`}>
                {t('int-link-webhooks', 'Webhooks')}
              </Link>
            </li>
          )}
          {teamFeatures.apiKey && (
            <li>
              <Link className="link" href={`/teams/${slug}/api-keys`}>
                {t('int-link-api', 'API keys')}
              </Link>
            </li>
          )}
        </ul>
      </section>
    </div>
  );
};

export default Integrations;
