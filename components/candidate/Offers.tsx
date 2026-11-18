import { Error, Loading } from '@/components/shared';
import useApi, { send } from 'hooks/useApi';
import { useTranslation } from 'next-i18next';
import toast from 'react-hot-toast';

type Offer = {
  id: string;
  job: string;
  portal: string;
  fixed: number;
  variable: number;
  joiningBonus: number;
  currency: string;
  equityNote: string | null;
  startDate: string | null;
  expiresAt: string | null;
  terms: string | null;
  status: string;
};

const Offers = () => {
  const { t } = useTranslation('common');
  const { data, isLoading, isError, refresh } = useApi<Offer[]>(
    '/api/candidate/offers'
  );

  if (isLoading) return <Loading />;
  if (isError) return <Error message={isError.message} />;

  const respond = async (id: string, accept: boolean) => {
    if (
      !window.confirm(
        accept
          ? t('confirm-accept-offer', 'Accept this offer?')
          : t('confirm-decline-offer', 'Decline this offer?')
      )
    ) {
      return;
    }

    const r = await send(`/api/candidate/offers/${id}/respond`, 'POST', {
      accept,
    });

    if (!r.ok) toast.error(r.error as string);

    refresh();
  };

  if (!data?.length) {
    return (
      <p className="text-sm opacity-70">
        {t('no-offers-yet', 'You have no offers yet.')}
      </p>
    );
  }

  return (
    <ul className="space-y-4">
      {data.map((o) => (
        <li key={o.id} className="space-y-2 rounded border p-4 text-sm">
          <div className="flex items-center gap-3">
            <span className="font-semibold">{o.job}</span>
            <span className="opacity-70">{o.portal}</span>
            <span className="badge ml-auto">{o.status}</span>
          </div>
          <p>{`${t('fixed', 'Fixed')}: ${o.currency} ${o.fixed.toLocaleString('en-IN')} | ${t('variable', 'Variable')}: ${o.variable.toLocaleString('en-IN')} | ${t('joining-bonus', 'Joining bonus')}: ${o.joiningBonus.toLocaleString('en-IN')}`}</p>
          {o.equityNote && <p>{o.equityNote}</p>}
          {o.terms && <p className="whitespace-pre-line">{o.terms}</p>}
          {o.expiresAt && (
            <p className="opacity-70">
              {t('expires', 'Expires')}:{' '}
              {new Date(o.expiresAt).toLocaleDateString()}
            </p>
          )}
          {o.status === 'SENT' && (
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => respond(o.id, true)}
              >
                {t('accept', 'Accept')}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={() => respond(o.id, false)}
              >
                {t('decline', 'Decline')}
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
};

export default Offers;
