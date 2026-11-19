import { Error, Loading } from '@/components/shared';
import useApi, { send } from 'hooks/useApi';
import usePortalAccess from 'hooks/usePortalAccess';
import { useSession } from 'next-auth/react';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import { useEffect, useState } from 'react';
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
  templateKey: string | null;
  band: {
    status: 'NONE' | 'BELOW' | 'WITHIN' | 'ABOVE';
    min: number | null;
    max: number | null;
    expected: number | null;
  };
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

export const OFFER_TEMPLATES = [
  { key: 'india-full-time-v4', label: 'India — Full-time (v4)' },
  { key: 'india-contract-v2', label: 'India — Contract (v2)' },
  { key: 'global-full-time-v1', label: 'Global — Full-time (v1)' },
];

const lakh = (n: number | null) =>
  n == null ? '' : `₹${Math.round((n / 100000) * 10) / 10} L`;

const toDateInput = (d: string | null) => (d ? d.slice(0, 10) : '');

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
  const [chain, setChain] = useState<string[]>([]);
  const [seeded, setSeeded] = useState(false);
  const [comment, setComment] = useState('');
  const [form, setForm] = useState<{
    fixed: string;
    variable: string;
    joiningBonus: string;
    equityNote: string;
    startDate: string;
    expiresAt: string;
    templateKey: string;
  } | null>(null);

  useEffect(() => {
    if (data && !form) {
      setForm({
        fixed: String(data.fixed),
        variable: String(data.variable),
        joiningBonus: String(data.joiningBonus),
        equityNote: data.equityNote ?? '',
        startDate: toDateInput(data.startDate),
        expiresAt: toDateInput(data.expiresAt),
        templateKey: data.templateKey ?? OFFER_TEMPLATES[0].key,
      });
    }
  }, [data, form]);

  useEffect(() => {
    if (!seeded && people.data && data?.status === 'DRAFT') {
      setSeeded(true);
      setChain(
        people.data
          .filter((p) => p.userId !== session?.user?.id)
          .slice(0, 3)
          .map((p) => p.userId)
      );
    }
  }, [people.data, seeded, data?.status, session?.user?.id]);

  if (isLoading) return <Loading />;
  if (isError) return <Error message={isError.message} />;
  if (!data || !form) return null;

  const draft = data.status === 'DRAFT' && can('offers.manage');
  const num = (v: string) => Number(v.replace(/[^\d]/g, '')) || 0;
  const ctc = num(form.fixed) + num(form.variable) + num(form.joiningBonus);

  const act = async (body: object) => {
    const r = await send(
      `/api/teams/${slug}/offers/${offerId}/actions`,
      'POST',
      body
    );

    if (!r.ok) {
      toast.error(r.error as string);
      return false;
    }

    refresh();

    return true;
  };

  const save = async () => {
    const r = await send(`/api/teams/${slug}/offers/${offerId}`, 'PUT', {
      fixed: num(form.fixed),
      variable: num(form.variable),
      joiningBonus: num(form.joiningBonus),
      equityNote: form.equityNote || null,
      startDate: form.startDate ? new Date(form.startDate).toISOString() : null,
      expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      templateKey: form.templateKey,
    });

    if (!r.ok) {
      toast.error(r.error as string);
      return false;
    }

    refresh();

    return true;
  };

  const requestApproval = async () => {
    if (
      (await save()) &&
      (await act({ action: 'submit', approverIds: chain }))
    ) {
      toast.success(t('approval-requested', 'Approval requested.'));
    }
  };

  const current = data.approvals.filter((a) => a.round === data.round);
  const next = current
    .filter((a) => a.status === 'PENDING')
    .sort((a, b) => a.order - b.order)[0];
  const myTurn =
    data.status === 'PENDING_APPROVAL' &&
    next &&
    next.userId === session?.user?.id;
  const byId = new Map((people.data ?? []).map((p) => [p.userId, p]));
  const available = (people.data ?? []).filter(
    (p) => p.userId !== session?.user?.id && !chain.includes(p.userId)
  );
  const moveRow = (i: number, d: number) => {
    const j = i + d;

    if (j < 0 || j >= chain.length) return;

    const c = [...chain];

    [c[i], c[j]] = [c[j], c[i]];
    setChain(c);
  };
  const statusText = (s: string) =>
    ({
      PENDING:
        data.status === 'PENDING_APPROVAL'
          ? t('pending', 'Pending')
          : t('not-started', 'Not started'),
      APPROVED: t('approved', 'Approved'),
      REJECTED: t('rejected', 'Rejected'),
    })[s] ?? s;
  const field = (
    k: 'fixed' | 'variable' | 'joiningBonus' | 'equityNote',
    label: string,
    placeholder = ''
  ) => (
    <label className="block text-sm">
      <span className="mb-1 block font-semibold">{label}</span>
      <input
        className="input w-full"
        aria-label={label}
        inputMode={k === 'equityNote' ? 'text' : 'numeric'}
        placeholder={placeholder}
        disabled={!draft}
        value={form[k]}
        onChange={(e) => setForm({ ...form, [k]: e.target.value })}
      />
    </label>
  );
  const band = data.band;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <p className="text-sm opacity-70">{`${data.candidate.name} · ${data.job.title}`}</p>
          <h2 className="font-display text-3xl font-bold">
            {t('offer', 'Offer')}
          </h2>
        </div>
        <span className="badge badge-lg">{data.status}</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-4 rounded-2xl border bg-base-100 p-6">
          <h3 className="font-display text-lg font-semibold">
            {t('compensation-terms', 'Compensation & terms')}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {field('fixed', `${t('fixed', 'Fixed')} (${data.currency})`)}
            {field(
              'variable',
              `${t('variable', 'Variable')} (${data.currency})`
            )}
            {field(
              'joiningBonus',
              `${t('joining-bonus', 'Joining bonus')} (${data.currency})`
            )}
            {field('equityNote', t('equity', 'ESOPs'))}
            <label className="block text-sm">
              <span className="mb-1 block font-semibold">
                {t('start-date', 'Start date')}
              </span>
              <input
                type="date"
                className="input w-full"
                aria-label={t('start-date', 'Start date')}
                disabled={!draft}
                value={form.startDate}
                onChange={(e) =>
                  setForm({ ...form, startDate: e.target.value })
                }
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-semibold">
                {t('offer-expires', 'Offer expires')}
              </span>
              <input
                type="date"
                className="input w-full"
                aria-label={t('offer-expires', 'Offer expires')}
                disabled={!draft}
                value={form.expiresAt}
                onChange={(e) =>
                  setForm({ ...form, expiresAt: e.target.value })
                }
              />
            </label>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-base-200 px-4 py-3">
            <span>{t('total-ctc', 'Total first-year CTC')}</span>
            <strong className="font-display text-lg">
              {money(ctc, data.currency)}
            </strong>
          </div>

          {band.status !== 'NONE' && (
            <p
              role="status"
              className={`rounded-xl border p-3 text-sm ${
                band.status === 'WITHIN'
                  ? 'border-warning/50 bg-warning/10'
                  : 'border-error/50 bg-error/10'
              }`}
            >
              <strong>{t('band-check', 'Band check:')}</strong>{' '}
              {band.status === 'WITHIN'
                ? t(
                    'band-within',
                    'fixed pay is within the approved {{band}} band.',
                    { band: `${lakh(band.min)}–${lakh(band.max)}` }
                  )
                : band.status === 'BELOW'
                  ? t(
                      'band-below',
                      'fixed pay is below the approved {{band}} band.',
                      { band: `${lakh(band.min)}–${lakh(band.max)}` }
                    )
                  : t(
                      'band-above',
                      'fixed pay is above the approved {{band}} band.',
                      { band: `${lakh(band.min)}–${lakh(band.max)}` }
                    )}
              {band.expected != null &&
                ` ${t('candidate-expected', 'Candidate expected')} ${lakh(band.expected)}.`}
            </p>
          )}

          <label className="block text-sm">
            <span className="mb-1 block font-semibold">
              {t('letter-template', 'Letter template')}
            </span>
            <select
              className="select w-full"
              aria-label={t('letter-template', 'Letter template')}
              disabled={!draft}
              value={form.templateKey}
              onChange={(e) =>
                setForm({ ...form, templateKey: e.target.value })
              }
            >
              {OFFER_TEMPLATES.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {draft && (
            <button type="button" className="btn btn-outline" onClick={save}>
              {t('save-changes', 'Save changes')}
            </button>
          )}
        </section>

        <div className="space-y-4">
          <section className="space-y-3 rounded-2xl border bg-base-100 p-6">
            <h3 className="font-display text-lg font-semibold">
              {t('approval-chain', 'Approval chain')}
            </h3>
            <ol className="space-y-2">
              {(draft
                ? chain.map((id) => ({ id, a: null }))
                : current.map((a) => ({ id: a.userId, a }))
              ).map((row, i) => {
                const person = byId.get(row.id);

                return (
                  <li
                    key={row.id}
                    className="flex items-center gap-3 rounded-xl border p-3"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-base-200 text-sm font-semibold">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">
                        {row.a?.name ?? person?.name ?? ''}
                      </div>
                      <div className="text-xs opacity-70">
                        {person?.role ?? row.a?.comment ?? ''}
                      </div>
                    </div>
                    {draft ? (
                      <span className="flex items-center gap-1">
                        <span className="mr-2 text-sm opacity-70">
                          {t('not-started', 'Not started')}
                        </span>
                        <button
                          type="button"
                          className="btn btn-xs btn-ghost"
                          aria-label={`${t('move-up', 'Move up')} ${person?.name ?? ''}`}
                          onClick={() => moveRow(i, -1)}
                        >
                          {'↑'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-xs btn-ghost"
                          aria-label={`${t('move-down', 'Move down')} ${person?.name ?? ''}`}
                          onClick={() => moveRow(i, 1)}
                        >
                          {'↓'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-xs btn-ghost text-error"
                          aria-label={`${t('remove')} ${person?.name ?? ''}`}
                          onClick={() =>
                            setChain(chain.filter((x) => x !== row.id))
                          }
                        >
                          {'✕'}
                        </button>
                      </span>
                    ) : (
                      <span className="text-sm">
                        {statusText(row.a?.status ?? 'PENDING')}
                      </span>
                    )}
                  </li>
                );
              })}
              {!draft && current.length === 0 && (
                <li className="text-sm opacity-70">
                  {t('not-submitted', 'Not submitted yet.')}
                </li>
              )}
            </ol>

            {draft && available.length > 0 && (
              <select
                className="select select-sm"
                aria-label={t('add-approver', 'Add approver')}
                value=""
                onChange={(e) =>
                  e.target.value && setChain([...chain, e.target.value])
                }
              >
                <option value="" disabled>
                  {`+ ${t('add-approver', 'Add approver')}`}
                </option>
                {available.map((p) => (
                  <option key={p.userId} value={p.userId}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}

            {draft && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={chain.length === 0}
                onClick={requestApproval}
              >
                {t('request-approval', 'Request approval')}
              </button>
            )}

            {myTurn && (
              <div className="space-y-2 border-t pt-3 text-sm">
                <textarea
                  className="textarea w-full"
                  rows={2}
                  aria-label={t('comment', 'Comment')}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() =>
                      act({ action: 'approve', comment: comment || undefined })
                    }
                  >
                    {t('approve', 'Approve')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-error btn-outline"
                    onClick={() =>
                      act({ action: 'reject', comment: comment || undefined })
                    }
                  >
                    {t('reject', 'Reject')}
                  </button>
                </div>
              </div>
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
          </section>
        </div>
      </div>
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
      className="input  input-sm w-36"
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
