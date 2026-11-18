import { Error, Loading } from '@/components/shared';
import useApi, { send } from 'hooks/useApi';
import usePortalAccess from 'hooks/usePortalAccess';
import { useSession } from 'next-auth/react';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import { useState } from 'react';
import toast from 'react-hot-toast';

export type OfferView = {
  id: string;
  applicationId: string;
  job: { title: string };
  candidate: { name: string };
  fixed: number;
  variable: number;
  joiningBonus: number;
  currency: string;
  equityNote: string | null;
  startDate: string | null;
  expiresAt: string | null;
  status: string;
  round: number;
  approvals: {
    userId: string;
    name: string;
    round: number;
    order: number;
    status: string;
    comment: string | null;
  }[];
};

const money = (n: number, c: string) => `${c} ${n.toLocaleString('en-IN')}`;

export const OffersList = ({ slug }: { slug: string }) => {
  const { t } = useTranslation('common');
  const { data, isLoading, isError } = useApi<OfferView[]>(
    `/api/teams/${slug}/offers`
  );

  if (isLoading) return <Loading />;
  if (isError) return <Error message={isError.message} />;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-medium">{t('offers', 'Offers')}</h2>
      {data?.length === 0 && (
        <p className="text-sm opacity-70">{t('no-offers', 'No offers.')}</p>
      )}
      <ul className="space-y-2">
        {(data ?? []).map((o) => (
          <li
            key={o.id}
            className="flex flex-wrap items-center gap-3 rounded border p-3 text-sm"
          >
            <Link
              className="link font-medium"
              href={`/teams/${slug}/offers/${o.id}`}
            >
              {o.candidate.name}
            </Link>
            <span>{o.job.title}</span>
            <span>{money(o.fixed, o.currency)}</span>
            <span className="badge">{o.status}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

type Person = {
  userId: string;
  name: string;
  email: string;
  role: string | null;
};

export const OfferDetail = ({
  slug,
  offerId,
}: {
  slug: string;
  offerId: string;
}) => {
  const { t } = useTranslation('common');
  const { can } = usePortalAccess(slug);
  const { data: session } = useSession();
  const { data, isLoading, isError, refresh } = useApi<OfferView>(
    `/api/teams/${slug}/offers/${offerId}`
  );
  const people = useApi<Person[]>(
    can('offers.manage')
      ? `/api/teams/${slug}/people?permission=offers.approve`
      : null
  );
  const [picked, setPicked] = useState<string[]>([]);
  const [comment, setComment] = useState('');

  if (isLoading) return <Loading />;
  if (isError) return <Error message={isError.message} />;
  if (!data) return null;

  const act = async (body: object) => {
    const r = await send(
      `/api/teams/${slug}/offers/${offerId}/actions`,
      'POST',
      body
    );

    if (!r.ok) {
      toast.error(r.error as string);
      return;
    }

    refresh();
  };

  const current = data.approvals.filter((a) => a.round === data.round);
  const next = current
    .filter((a) => a.status === 'PENDING')
    .sort((a, b) => a.order - b.order)[0];
  const myTurn =
    data.status === 'PENDING_APPROVAL' &&
    next &&
    next.userId === session?.user?.id;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium">
          {data.candidate.name} - {data.job.title}
        </h2>
        <p>
          <span className="badge badge-lg">{data.status}</span>
        </p>
      </div>
      <dl className="grid grid-cols-[10rem_1fr] gap-1 text-sm">
        <dt className="opacity-60">{t('fixed', 'Fixed')}</dt>
        <dd>{money(data.fixed, data.currency)}</dd>
        <dt className="opacity-60">{t('variable', 'Variable')}</dt>
        <dd>{money(data.variable, data.currency)}</dd>
        <dt className="opacity-60">{t('joining-bonus', 'Joining bonus')}</dt>
        <dd>{money(data.joiningBonus, data.currency)}</dd>
        <dt className="opacity-60">{t('equity', 'Equity')}</dt>
        <dd>{data.equityNote ?? '-'}</dd>
        <dt className="opacity-60">{t('start-date', 'Start date')}</dt>
        <dd>
          {data.startDate ? new Date(data.startDate).toLocaleDateString() : '-'}
        </dd>
        <dt className="opacity-60">{t('expires', 'Expires')}</dt>
        <dd>
          {data.expiresAt ? new Date(data.expiresAt).toLocaleDateString() : '-'}
        </dd>
      </dl>

      <section className="space-y-2">
        <h3 className="font-semibold">
          {t('approval-chain', 'Approval chain')}
        </h3>
        <ol className="space-y-1 text-sm">
          {current.map((a) => (
            <li key={a.userId}>
              {a.order + 1}. {a.name} -{' '}
              <span className="badge badge-sm">{a.status}</span> {a.comment}
            </li>
          ))}
          {current.length === 0 && (
            <li className="opacity-70">
              {t('not-submitted', 'Not submitted yet.')}
            </li>
          )}
        </ol>
      </section>

      {can('offers.manage') && data.status === 'DRAFT' && (
        <section className="space-y-2 rounded border p-3 text-sm">
          <h4 className="font-semibold">
            {t('submit-for-approval', 'Submit for approval (in this order)')}
          </h4>
          <div className="flex flex-wrap gap-3">
            {(people.data ?? [])
              .filter((p) => p.userId !== session?.user?.id)
              .map((p) => (
                <label key={p.userId} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={picked.includes(p.userId)}
                    onChange={(e) =>
                      setPicked(
                        e.target.checked
                          ? [...picked, p.userId]
                          : picked.filter((x) => x !== p.userId)
                      )
                    }
                  />
                  {p.name}
                </label>
              ))}
          </div>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={picked.length === 0}
            onClick={() => act({ action: 'submit', approverIds: picked })}
          >
            {t('submit', 'Submit')}
          </button>
        </section>
      )}

      {myTurn && (
        <section className="space-y-2 rounded border p-3 text-sm">
          <textarea
            className="textarea textarea-bordered w-full"
            rows={2}
            aria-label={t('comment', 'Comment')}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() =>
                act({ action: 'approve', comment: comment || undefined })
              }
            >
              {t('approve', 'Approve')}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-error btn-outline"
              onClick={() =>
                act({ action: 'reject', comment: comment || undefined })
              }
            >
              {t('reject', 'Reject')}
            </button>
          </div>
        </section>
      )}

      {can('offers.manage') && data.status === 'APPROVED' && (
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => act({ action: 'send' })}
        >
          {t('send-offer', 'Send offer to candidate')}
        </button>
      )}
    </div>
  );
};

/** Create an offer (used on the application page). */
export const CreateOffer = ({
  slug,
  applicationId,
  onDone,
}: {
  slug: string;
  applicationId: string;
  onDone: (id: string) => void;
}) => {
  const { t } = useTranslation('common');
  const [f, setF] = useState({
    fixed: '',
    variable: '',
    joiningBonus: '',
    currency: 'INR',
    expiresAt: '',
    startDate: '',
  });

  const submit = async () => {
    const r = await send<{ id: string }>(`/api/teams/${slug}/offers`, 'POST', {
      applicationId,
      fixed: Number(f.fixed),
      variable: Number(f.variable) || 0,
      joiningBonus: Number(f.joiningBonus) || 0,
      currency: f.currency,
      expiresAt: f.expiresAt ? new Date(f.expiresAt).toISOString() : null,
      startDate: f.startDate ? new Date(f.startDate).toISOString() : null,
    });

    if (!r.ok) {
      toast.error(r.error as string);
      return;
    }

    onDone(r.data!.id);
  };

  const field = (k: keyof typeof f, label: string, type = 'number') => (
    <input
      type={type}
      className="input input-bordered input-sm w-36"
      aria-label={label}
      placeholder={label}
      value={f[k]}
      onChange={(e) => setF({ ...f, [k]: e.target.value })}
    />
  );

  return (
    <div className="space-y-2 rounded border p-3 text-sm">
      <h4 className="font-semibold">{t('create-offer', 'Create offer')}</h4>
      <div className="flex flex-wrap gap-2">
        {field('fixed', t('fixed', 'Fixed'))}
        {field('variable', t('variable', 'Variable'))}
        {field('joiningBonus', t('joining-bonus', 'Joining bonus'))}
        {field('currency', t('currency', 'Currency'), 'text')}
        {field('startDate', t('start-date', 'Start date'), 'date')}
        {field('expiresAt', t('expires', 'Expires'), 'date')}
      </div>
      <button
        type="button"
        className="btn btn-sm btn-primary"
        disabled={!f.fixed}
        onClick={submit}
      >
        {t('create', 'Create')}
      </button>
    </div>
  );
};
