import useApi from 'hooks/useApi';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';

/** Shown on every portal page while a payment problem needs attention. */
const PlanBanner = ({
  slug,
  canBilling,
}: {
  slug: string;
  canBilling: boolean;
}) => {
  const { t } = useTranslation('common');
  const { data } = useApi<{
    lifecycle: {
      inGrace: boolean;
      graceEndsAt: string | null;
      readOnly: boolean;
    };
  }>(`/api/teams/${slug}/plan`);

  if (!data || (!data.lifecycle.inGrace && !data.lifecycle.readOnly))
    return null;

  return (
    <div
      role="alert"
      className={`alert mb-3 text-sm ${data.lifecycle.readOnly ? 'alert-error' : 'alert-warning'}`}
    >
      <span>
        {data.lifecycle.readOnly
          ? t(
              'banner-readonly',
              'This portal is read-only because a payment failed.'
            )
          : t(
              'banner-grace',
              'A payment failed. Update your payment method before {{date}}.',
              {
                date: new Date(
                  data.lifecycle.graceEndsAt as string
                ).toLocaleDateString(),
              }
            )}
      </span>
      {canBilling && (
        <Link className="link font-semibold" href={`/teams/${slug}/billing`}>
          {t('banner-fix', 'Fix billing')}
        </Link>
      )}
    </div>
  );
};

export default PlanBanner;
