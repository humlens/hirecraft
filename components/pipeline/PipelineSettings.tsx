import { Error, Loading } from '@/components/shared';
import useApi, { send } from 'hooks/useApi';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import toast from 'react-hot-toast';

type Stage = { id: string; name: string; kind: string; order: number };
type Rule = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: { type: string; stageId?: string };
  action: {
    type: string;
    kind?: string;
    subject?: string;
    body?: string;
    tag?: string;
  };
};

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

  return (
    <section className="space-y-3">
      <h3 className="text-lg font-semibold">
        {t('pipeline-stages', 'Pipeline stages')}
      </h3>
      <ol className="space-y-1 text-sm">
        {active.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2">
            <input
              className="input  input-xs"
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
            <button
              type="button"
              className="btn btn-xs btn-ghost"
              aria-label={`${t('move-up', 'Move up')} ${s.name}`}
              onClick={() => move(i, -1)}
            >
              {'↑'}
            </button>
            <button
              type="button"
              className="btn btn-xs btn-ghost"
              aria-label={`${t('move-down', 'Move down')} ${s.name}`}
              onClick={() => move(i, 1)}
            >
              {'↓'}
            </button>
            <button
              type="button"
              className="btn btn-xs btn-ghost text-error"
              onClick={() =>
                run(send(`/api/teams/${slug}/stages/${s.id}`, 'DELETE'))
              }
            >
              {t('remove')}
            </button>
          </li>
        ))}
        {stages
          .filter((s) => s.kind !== 'ACTIVE')
          .map((s) => (
            <li key={s.id} className="opacity-60">
              {s.name} ({s.kind})
            </li>
          ))}
      </ol>
      <div className="flex gap-2">
        <input
          className="input  input-sm"
          placeholder="New stage"
          aria-label={t('new-stage', 'New stage')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-sm"
          disabled={name.trim().length < 2}
          onClick={async () => {
            await run(send(`/api/teams/${slug}/stages`, 'POST', { name }));
            setName('');
          }}
        >
          {t('add-stage', 'Add stage')}
        </button>
      </div>
    </section>
  );
};

const Rules = ({ slug }: { slug: string }) => {
  const { t } = useTranslation('common');
  const rules = useApi<Rule[]>(`/api/teams/${slug}/automation`);
  const stages = useApi<{ stages: Stage[] }>(`/api/teams/${slug}/stages`);
  const [f, setF] = useState({
    name: '',
    trigger: 'APPLICATION_CREATED',
    stageId: '',
    action: 'CREATE_MESSAGE_DRAFT',
    subject: '',
    body: '',
    tag: '',
  });

  const create = async () => {
    const trigger =
      f.trigger === 'STAGE_ENTERED'
        ? { type: 'STAGE_ENTERED', stageId: f.stageId }
        : { type: 'APPLICATION_CREATED' };
    const action =
      f.action === 'ADD_TAG'
        ? { type: 'ADD_TAG', tag: f.tag }
        : {
            type: 'CREATE_MESSAGE_DRAFT',
            kind: 'STATUS_UPDATE',
            subject: f.subject,
            body: f.body,
          };
    const r = await send(`/api/teams/${slug}/automation`, 'POST', {
      name: f.name,
      trigger,
      action,
    });

    if (!r.ok) {
      toast.error(r.error as string);
      return;
    }

    setF({ ...f, name: '', subject: '', body: '', tag: '' });
    rules.refresh();
  };

  const toggle = async (r: Rule) => {
    await send(`/api/teams/${slug}/automation/${r.id}`, 'PUT', {
      name: r.name,
      trigger: r.trigger,
      action: r.action,
      enabled: !r.enabled,
    });
    rules.refresh();
  };

  const remove = async (r: Rule) => {
    await send(`/api/teams/${slug}/automation/${r.id}`, 'DELETE');
    rules.refresh();
  };

  return (
    <section className="space-y-3">
      <h3 className="text-lg font-semibold">
        {t('automation-rules', 'Automation rules')}
      </h3>
      <p className="text-xs opacity-70">
        {t(
          'automation-hint',
          'Rules can add tags and prepare message drafts. They never move or reject candidates, and messages always wait for a person to approve them.'
        )}
      </p>
      <ul className="space-y-1 text-sm">
        {(rules.data ?? []).map((r) => (
          <li key={r.id} className="flex items-center gap-3 rounded border p-2">
            <span className="font-medium">{r.name}</span>
            <span className="opacity-60">
              {r.trigger.type} {'→'} {r.action.type}
            </span>
            <button
              type="button"
              className="btn btn-xs ml-auto"
              onClick={() => toggle(r)}
            >
              {r.enabled ? t('disable', 'Disable') : t('enable', 'Enable')}
            </button>
            <button
              type="button"
              className="btn btn-xs btn-ghost text-error"
              onClick={() => remove(r)}
            >
              {t('remove')}
            </button>
          </li>
        ))}
      </ul>
      <div className="space-y-2 rounded border p-3 text-sm">
        <input
          className="input  input-sm w-full"
          placeholder="Rule name"
          aria-label={t('rule-name', 'Rule name')}
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
        />
        <div className="flex flex-wrap gap-2">
          <select
            className="select  select-sm"
            aria-label={t('when', 'When')}
            value={f.trigger}
            onChange={(e) => setF({ ...f, trigger: e.target.value })}
          >
            <option value="APPLICATION_CREATED">APPLICATION_CREATED</option>
            <option value="STAGE_ENTERED">STAGE_ENTERED</option>
          </select>
          {f.trigger === 'STAGE_ENTERED' && (
            <select
              className="select  select-sm"
              aria-label={t('stage', 'Stage')}
              value={f.stageId}
              onChange={(e) => setF({ ...f, stageId: e.target.value })}
            >
              <option value="" disabled>
                {t('stage', 'Stage')}
              </option>
              {(stages.data?.stages ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <select
            className="select  select-sm"
            aria-label={t('then', 'Then')}
            value={f.action}
            onChange={(e) => setF({ ...f, action: e.target.value })}
          >
            <option value="CREATE_MESSAGE_DRAFT">CREATE_MESSAGE_DRAFT</option>
            <option value="ADD_TAG">ADD_TAG</option>
          </select>
        </div>
        {f.action === 'ADD_TAG' ? (
          <input
            className="input  input-sm"
            placeholder="Tag"
            aria-label={t('tag', 'Tag')}
            value={f.tag}
            onChange={(e) => setF({ ...f, tag: e.target.value })}
          />
        ) : (
          <>
            <input
              className="input  input-sm w-full"
              placeholder="Subject ({{candidate_name}}, {{job_title}}, {{company}})"
              aria-label={t('subject', 'Subject')}
              value={f.subject}
              onChange={(e) => setF({ ...f, subject: e.target.value })}
            />
            <textarea
              className="textarea  w-full"
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
          className="btn btn-sm btn-primary"
          disabled={f.name.trim().length < 2}
          onClick={create}
        >
          {t('add-rule', 'Add rule')}
        </button>
      </div>
    </section>
  );
};

const PipelineSettings = ({ slug }: { slug: string }) => (
  <div className="space-y-8">
    <Stages slug={slug} />
    <Rules slug={slug} />
  </div>
);

export default PipelineSettings;
