import usePortalAccess from 'hooks/usePortalAccess';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import { useRouter } from 'next/router';

/** Settings sub-navigation shown on the portal settings pages. */
const SettingsNav = ({ slug }: { slug: string }) => {
  const { t } = useTranslation('common');
  const { asPath } = useRouter();
  const { can } = usePortalAccess(slug);
  const base = `/teams/${slug}`;
  const path = asPath.split('?')[0];

  const items = [
    { href: `${base}/settings`, label: t('team', 'Team'), ok: true },
    {
      href: `${base}/settings/pipeline`,
      label: t('pipeline-automation', 'Pipeline & automation'),
      ok: can('automation.manage'),
    },
    { href: `${base}/ai`, label: t('ai', 'AI'), ok: can('ai.configure') },
    {
      href: `${base}/billing`,
      label: t('billing', 'Billing'),
      ok: can('billing.manage'),
    },
    {
      href: `${base}/settings/integrations`,
      label: t('integrations', 'Integrations'),
      ok: can('integrations.manage'),
    },
  ].filter((i) => i.ok);

  return (
    <nav
      aria-label={t('settings-navigation', 'Settings navigation')}
      className="mb-4 flex flex-wrap gap-1"
    >
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={path === i.href ? 'page' : undefined}
          className={`rounded-lg px-3 py-1.5 text-sm ${
            path === i.href
              ? 'bg-primary/10 font-semibold text-primary'
              : 'hover:bg-base-200'
          }`}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
};

export default SettingsNav;
