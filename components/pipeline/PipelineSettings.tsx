import { Error, Loading } from '@/components/shared';
import SettingsNav from '@/components/shared/shell/SettingsNav';
import useApi, { send } from 'hooks/useApi';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import toast from 'react-hot-toast';

type Stage = { id: string; name: string; kind: string; order: number };
type Trigger =
  | { type: 'APPLICATION_CREATED'; jobId?: string }
  | { type: 'STAGE_ENTERED'; stageId: string }
  | { type: 'MATCH_SCORED'; minScore: number; jobId?: string }
  | { type: 'STAGE_STALE'; days: number; stageId?: string }
  | { type: 'JOB_LOW_APPLICANTS'; maxApplicants: number; afterDays: number };
type Action =
  | {
      type: 'CREATE_MESSAGE_DRAFT';
      kind: string;
      subject: string;
      body: string;
    }
  | { type: 'ADD_TAG'; tag: string }
  | { type: 'NOTIFY_ASSIGNED'; title: string }
  | { type: 'NOTIFY_USERS'; userIds: string[]; title: string };
type Rule = {
  id: string;
  name: string;
  enabled: boolean;
  requiresApproval: boolean;
  trigger: Trigger;
  action: Action;
};

const dot = (kind: string) =>
  kind === 'ACTIVE'
    ? 'bg-primary'
    : kind === 'HIRED'
      ? 'bg-success'
      : kind === 'REJECTED'
        ? 'bg-error'
        : 'bg-base-300';

const Stages = ({ slug }: { slug: string }) => {
  const { t } = useTranslation('common');
  const { data, isLoading, isError, refresh } = useApi<{ stages: Stage[] }>(
    `/api/teams/${slug}/stages`
  );
  const [name, setName] = useState('');

  if (isLoading) return <Loading />;
  if (isError) return <Error message={isError.message} />;

  const stages = data?.stages ?? [];
  const active = stages.filter((s) => s.kind === 'ACTIVE');

  const run = async (p: Promise<{ ok: boolean; error?: string }>) => {
    const r = await p;

    if (!r.ok) toast.error(r.error as string);

    refresh();
  };

  const move = (i: number, d: number) => {
    const ids = active.map((s) => s.id);
    const j = i + d;

    if (j < 0 || j >= ids.length) return;

    [ids[i], ids[j]] = [ids[j], ids[i]];
    run(send(`/api/teams/${slug}/stages/reorder`, 'PUT', { orderedIds: ids }));
  };

  const arrow = (
    label: string,
    glyph: string,
    disabled: boolean,
    fn: () => void
  ) => (
    <button
      type="button"
      className="btn btn-square btn-sm btn-outline"
      aria-label={label}
      disabled={disabled}
      onClick={fn}
    >
      {glyph}
    </button>
  );

  return (
    <section className="space-y-3 rounded-2xl border bg-base-100 p-6">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-semibold">
          {t('pipeline-stages', 'Pipeline stages')}
        </h3>
        <span className="text-sm opacity-70">{`${stages.length} ${t('stages', 'stages')}`}</span>
      </div>
      <ol className="space-y-2 text-sm">
        {active.map((s, i) => (
          <li
            key={s.id}
            className="flex items-center gap-3 rounded-xl border px-3 py-2"
          >
            <span aria-hidden className={`h-3 w-3 rounded-sm ${dot(s.kind)}`} />
            <input
              className="min-w-0 flex-1 bg-transparent text-base font-medium focus:outline-none"
              aria-label={`${t('stage-name', 'Stage name')} ${i + 1}`}
              defaultValue={s.name}
              onBlur={(e) =>
                e.target.value !== s.name &&
                run(
                  send(`/api/teams/${slug}/stages/${s.id}`, 'PUT', {
                    name: e.target.value,
                  })
                )
              }
            />
            <span className="opacity-60">{t('active', 'Active')}</span>
            {arrow(`${t('move-up', 'Move up')} ${s.name}`, '↑', i === 0, () =>
              move(i, -1)
            )}
            {arrow(
              `${t('move-down', 'Move down')} ${s.name}`,
              '↓',
              i === active.length - 1,
              () => move(i, 1)
            )}
            <button
              type="button"
              className="btn btn-square btn-sm btn-ghost text-error"
              aria-label={`${t('remove')} ${s.name}`}
              onClick={() =>
                run(send(`/api/teams/${slug}/stages/${s.id}`, 'DELETE'))
              }
            >
              {'✕'}
            </button>
          </li>
        ))}
        {stages
          .filter((s) => s.kind !== 'ACTIVE')
          .map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-3 rounded-xl border px-3 py-2 opacity-70"
            >
              <span
                aria-hidden
                className={`h-3 w-3 rounded-sm ${dot(s.kind)}`}
              />
              <span className="flex-1 text-base font-medium">{s.name}</span>
              <span>{t('terminal', 'Terminal')}</span>
            </li>
          ))}
      </ol>
      <div className="flex gap-2">
        <input
          className="input min-w-0 flex-1"
          placeholder="New stage"
          aria-label={t('new-stage', 'New stage')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-outline"
          disabled={name.trim().length < 2}
          onClick={async () => {
            await run(send(`/api/teams/${slug}/stages`, 'POST', { name }));
            setName('');
          }}
        >
          {`+ ${t('add-stage', 'Add stage')}`}
        </button>
      </div>
      <p className="text-xs opacity-70">
        {t(
          'terminal-note',
          'Terminal stages (Hired, Rejected, Withdrawn) stay last. Renames keep history.'
        )}
      </p>
    </section>
  );
};

type TriggerKey =
  | 'APPLICATION_CREATED'
  | 'STAGE_ENTERED'
  | 'MATCH_SCORED'
  | 'STAGE_STALE'
  | 'JOB_LOW_APPLICANTS';

const Rules = ({ slug }: { slug: string }) => {
  const { t } = useTranslation('common');
  const rules = useApi<Rule[]>(`/api/teams/${slug}/automation`);
  const stagesQ = useApi<{ stages: Stage[] }>(`/api/teams/${slug}/stages`);
  const stages = stagesQ.data?.stages ?? [];
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    name: '',
    trigger: 'APPLICATION_CREATED' as TriggerKey,
    stageId: '',
    minScore: '75',
    days: '5',
    maxApplicants: '10',
    afterDays: '7',
    action: 'CREATE_MESSAGE_DRAFT',
    subject: '',
    body: '',
    tag: '',
    title: '',
  });
  const jobLevel = f.trigger === 'JOB_LOW_APPLICANTS';
  const action = jobLevel ? 'NOTIFY_ASSIGNED' : f.action;
  const stageName = (id?: string) =>
    stages.find((s) => s.id === id)?.name ?? t('any-stage', 'a stage');

  const sentence = (r: Rule) => {
    const tr = r.trigger;
    const when =
      tr.type === 'APPLICATION_CREATED'
        ? t('when-created', 'When a new application arrives')
        : tr.type === 'STAGE_ENTERED'
          ? t('when-stage', 'When a candidate enters {{stage}}', {
              stage: stageName(tr.stageId),
            })
          : tr.type === 'MATCH_SCORED'
            ? t('when-score', 'When an application scores ≥ {{n}}% match', {
                n: tr.minScore,
              })
            : tr.type === 'STAGE_STALE'
              ? t(
                  'when-stale',
                  'When an application sits in {{stage}} for {{n}}+ days',
                  {
                    stage: tr.stageId
                      ? stageName(tr.stageId)
                      : t('any-active-stage', 'any active stage'),
                    n: tr.days,
                  }
                )
              : t(
                  'when-low',
                  'When a job has fewer than {{n}} applicants after {{d}} days',
                  { n: tr.maxApplicants, d: tr.afterDays }
                );
    const a = r.action;
    const then =
      a.type === 'CREATE_MESSAGE_DRAFT'
        ? t('then-draft', 'draft a message: {{subject}}', {
            subject: a.subject,
          })
        : a.type === 'ADD_TAG'
          ? t('then-tag', 'tag the candidate “{{tag}}”', { tag: a.tag })
          : a.type === 'NOTIFY_ASSIGNED'
            ? t(
                'then-notify-assigned',
                'notify the assigned recruiter and hiring manager'
              )
            : t('then-notify', 'notify selected people');

    return { when, then };
  };

  const create = async () => {
    const trigger: Trigger =
      f.trigger === 'STAGE_ENTERED'
        ? { type: 'STAGE_ENTERED', stageId: f.stageId }
        : f.trigger === 'MATCH_SCORED'
          ? { type: 'MATCH_SCORED', minScore: Number(f.minScore) }
          : f.trigger === 'STAGE_STALE'
            ? {
                type: 'STAGE_STALE',
                days: Number(f.days),
                ...(f.stageId ? { stageId: f.stageId } : {}),
              }
            : f.trigger === 'JOB_LOW_APPLICANTS'
              ? {
                  type: 'JOB_LOW_APPLICANTS',
                  maxApplicants: Number(f.maxApplicants),
                  afterDays: Number(f.afterDays),
                }
              : { type: 'APPLICATION_CREATED' };
    const act: Action =
      action === 'ADD_TAG'
        ? { type: 'ADD_TAG', tag: f.tag }
        : action === 'NOTIFY_ASSIGNED'
          ? {
              type: 'NOTIFY_ASSIGNED',
              title: f.title || f.name,
            }
          : {
              type: 'CREATE_MESSAGE_DRAFT',
              kind: 'STATUS_UPDATE',
              subject: f.subject,
              body: f.body,
            };
    const r = await send(`/api/teams/${slug}/automation`, 'POST', {
      name: f.name,
      trigger,
      action: act,
    });

    if (!r.ok) {
      toast.error(r.error as string);
      return;
    }

    setF({ ...f, name: '', subject: '', body: '', tag: '', title: '' });
    setOpen(false);
    rules.refresh();
  };

  const toggle = async (r: Rule) => {
    await send(`/api/teams/${slug}/automation/${r.id}`, 'PUT', {
      name: r.name,
      trigger: r.trigger,
      action: r.action,
      requiresApproval: r.requiresApproval,
      enabled: !r.enabled,
    });
    rules.refresh();
  };

  const remove = async (r: Rule) => {
    await send(`/api/teams/${slug}/automation/${r.id}`, 'DELETE');
    rules.refresh();
  };

  const num = (
    k: 'minScore' | 'days' | 'maxApplicants' | 'afterDays',
    label: string
  ) => (
    <label className="text-sm">
      <span className="mb-1 block">{label}</span>
      <input
        type="number"
        min={1}
        className="input input-sm w-28"
        aria-label={label}
        value={f[k]}
        onChange={(e) => setF({ ...f, [k]: e.target.value })}
      />
    </label>
  );

  return (
    <section className="space-y-3 rounded-2xl border bg-base-100 p-6">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-semibold">
          {t('automation-rules', 'Automation rules')}
        </h3>
        <button
          type="button"
          className="btn btn-outline"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {`+ ${t('new-rule', 'New rule')}`}
        </button>
      </div>

      {open && (
        <div className="space-y-3 rounded-xl border bg-base-200 p-4 text-sm">
          <input
            className="input w-full"
            placeholder="Rule name"
            aria-label={t('rule-name', 'Rule name')}
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
          <div className="flex flex-wrap items-end gap-3">
            <label>
              <span className="mb-1 block">{t('when', 'When')}</span>
              <select
                className="select select-sm"
                aria-label={t('when', 'When')}
                value={f.trigger}
                onChange={(e) =>
                  setF({
                    ...f,
                    trigger: e.target.value as TriggerKey,
                  })
                }
              >
                <option value="APPLICATION_CREATED">
                  {t('trg-created', 'A new application arrives')}
                </option>
                <option value="STAGE_ENTERED">
                  {t('trg-stage', 'A candidate enters a stage')}
                </option>
                <option value="MATCH_SCORED">
                  {t('trg-score', 'An AI match score is at least')}
                </option>
                <option value="STAGE_STALE">
                  {t('trg-stale', 'An application sits in a stage')}
                </option>
                <option value="JOB_LOW_APPLICANTS">
                  {t('trg-low', 'A job has few applicants')}
                </option>
              </select>
            </label>
            {(f.trigger === 'STAGE_ENTERED' || f.trigger === 'STAGE_STALE') && (
              <label>
                <span className="mb-1 block">{t('stage', 'Stage')}</span>
                <select
                  className="select select-sm"
                  aria-label={t('stage', 'Stage')}
                  value={f.stageId}
                  onChange={(e) => setF({ ...f, stageId: e.target.value })}
                >
                  <option value="">
                    {f.trigger === 'STAGE_STALE'
                      ? t('any-active-stage', 'Any active stage')
                      : t('stage', 'Stage')}
                  </option>
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {f.trigger === 'MATCH_SCORED' &&
              num('minScore', t('min-score', 'Minimum score (%)'))}
            {f.trigger === 'STAGE_STALE' &&
              num('days', t('days-in-stage', 'Days in stage'))}
            {f.trigger === 'JOB_LOW_APPLICANTS' && (
              <>
                {num(
                  'maxApplicants',
                  t('fewer-than', 'Fewer than (applicants)')
                )}
                {num('afterDays', t('after-days', 'After (days)'))}
              </>
            )}
            <label>
              <span className="mb-1 block">{t('then', 'Then')}</span>
              <select
                className="select select-sm"
                aria-label={t('then', 'Then')}
                disabled={jobLevel}
                value={action}
                onChange={(e) => setF({ ...f, action: e.target.value })}
              >
                <option value="CREATE_MESSAGE_DRAFT">
                  {t('act-draft', 'Draft a message (needs approval)')}
                </option>
                <option value="ADD_TAG">
                  {t('act-tag', 'Tag the candidate')}
                </option>
                <option value="NOTIFY_ASSIGNED">
                  {t('act-notify', 'Notify the assigned recruiter')}
                </option>
              </select>
            </label>
          </div>
          {action === 'ADD_TAG' && (
            <input
              className="input input-sm"
              placeholder="Tag"
              aria-label={t('tag', 'Tag')}
              value={f.tag}
              onChange={(e) => setF({ ...f, tag: e.target.value })}
            />
          )}
          {action === 'NOTIFY_ASSIGNED' && (
            <input
              className="input input-sm w-full"
              placeholder="Notification text"
              aria-label={t('notification-text', 'Notification text')}
              value={f.title}
              onChange={(e) => setF({ ...f, title: e.target.value })}
            />
          )}
          {action === 'CREATE_MESSAGE_DRAFT' && (
            <>
              <input
                className="input input-sm w-full"
                placeholder="Subject ({{candidate_name}}, {{job_title}}, {{company}})"
                aria-label={t('subject', 'Subject')}
                value={f.subject}
                onChange={(e) => setF({ ...f, subject: e.target.value })}
              />
              <textarea
                className="textarea w-full"
                rows={3}
                placeholder="Message"
                aria-label={t('body', 'Message')}
                value={f.body}
                onChange={(e) => setF({ ...f, body: e.target.value })}
              />
            </>
          )}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={f.name.trim().length < 2}
            onClick={create}
          >
            {t('add-rule', 'Add rule')}
          </button>
        </div>
      )}

      <ul className="space-y-2">
        {(rules.data ?? []).map((r) => {
          const s = sentence(r);

          return (
            <li
              key={r.id}
              className="flex items-start gap-3 rounded-xl border px-4 py-3"
            >
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium">{r.name}</p>
                <p>
                  <span className="opacity-70">{t('when', 'When')}</span>{' '}
                  {s.when.replace(/^When\s+/i, '')}
                </p>
                <p>
                  <span className="opacity-70">{t('then', 'Then')}</span>{' '}
                  {s.then}
                </p>
                {r.action.type === 'CREATE_MESSAGE_DRAFT' && (
                  <span className="mt-1 inline-block rounded-full bg-warning/20 px-2.5 py-0.5 text-xs font-semibold text-warning-content">
                    {t('human-approval', 'Human approval before sending')}
                  </span>
                )}
              </div>
              <input
                type="checkbox"
                role="switch"
                className="toggle toggle-primary"
                aria-label={`${r.enabled ? t('disable', 'Disable') : t('enable', 'Enable')} ${r.name}`}
                checked={r.enabled}
                onChange={() => toggle(r)}
              />
              <button
                type="button"
                className="btn btn-square btn-xs btn-ghost text-error"
                aria-label={`${t('remove')} ${r.name}`}
                onClick={() => remove(r)}
              >
                {'✕'}
              </button>
            </li>
          );
        })}
        {rules.data?.length === 0 && (
          <li className="text-sm opacity-70">
            {t('no-rules', 'No automation rules yet.')}
          </li>
        )}
      </ul>
      <p className="text-xs opacity-70">
        {t(
          'automation-hint',
          'Rules can add tags, notify people and prepare message drafts. They never move or reject candidates, and messages always wait for a person to approve them. Every automated action is written to the application’s audit trail.'
        )}
      </p>
    </section>
  );
};

const PipelineSettings = ({ slug }: { slug: string }) => {
  const { t } = useTranslation('common');

  return (
    <div className="space-y-4">
      <SettingsNav slug={slug} />
      <div>
        <h2 className="font-display text-3xl font-bold">
          {t('pipeline-automation', 'Pipeline & automation')}
        </h2>
        <p className="text-sm opacity-70">
          {t(
            'pipeline-scope',
            'Applies to all jobs in this portal unless a job overrides it.'
          )}
        </p>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <Stages slug={slug} />
        <Rules slug={slug} />
      </div>
    </div>
  );
};

export default PipelineSettings;
