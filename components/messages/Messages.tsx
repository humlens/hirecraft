import { Error, Loading } from '@/components/shared';
import useApi, { send } from 'hooks/useApi';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import usePortalAccess from 'hooks/usePortalAccess';
import toast from 'react-hot-toast';

export type MessageView = {
  id: string;
  applicationId: string | null;
  recipientEmail: string;
  recipientName: string | null;
  kind: string;
  subject: string;
  body: string;
  status: string;
  error: string | null;
  createdByAi: boolean;
  application: { job: { title: string } } | null;
};

const Message = ({
  slug,
  m,
  refresh,
}: {
  slug: string;
  m: MessageView;
  refresh: () => void;
}) => {
  const { t } = useTranslation('common');
  const [subject, setSubject] = useState(m.subject);
  const [body, setBody] = useState(m.body);

  const act = async (action: string) => {
    const r = await send(
      `/api/teams/${slug}/messages/${m.id}/actions`,
      'POST',
      { action }
    );

    if (!r.ok) {
      toast.error(r.error as string);
    } else if (action === 'send') {
      toast.success(t('message-sent', 'Message sent.'));
    }

    refresh();
  };

  const save = async () => {
    const r = await send(`/api/teams/${slug}/messages/${m.id}`, 'PUT', {
      subject,
      body,
    });

    if (!r.ok) toast.error(r.error as string);
    else toast.success(t('saved', 'Saved.'));
  };

  const editable = m.status === 'DRAFT';

  return (
    <li className="space-y-2 rounded border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge">{m.status}</span>
        <span className="badge badge-outline">{m.kind}</span>
        <span>
          {t('to', 'To')}: {m.recipientName} ({m.recipientEmail})
        </span>
        {m.application && (
          <span className="opacity-60">{m.application.job.title}</span>
        )}
        {m.createdByAi && <span className="badge badge-info">AI</span>}
      </div>
      <input
        className="input input-bordered input-sm w-full"
        aria-label={t('subject', 'Subject')}
        value={subject}
        disabled={!editable}
        onChange={(e) => setSubject(e.target.value)}
      />
      <textarea
        className="textarea textarea-bordered w-full"
        rows={5}
        aria-label={t('body', 'Message')}
        value={body}
        disabled={!editable}
        onChange={(e) => setBody(e.target.value)}
      />
      {m.error && (
        <p role="alert" className="text-error">
          {m.error}
        </p>
      )}
      <div className="flex gap-2">
        {editable && (
          <button type="button" className="btn btn-sm" onClick={save}>
            {t('save-draft', 'Save draft')}
          </button>
        )}
        {editable && (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={async () => {
              await save();
              await act('approve');
            }}
          >
            {t('approve', 'Approve')}
          </button>
        )}
        {m.status === 'APPROVED' && (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => act('send')}
          >
            {t('send', 'Send')}
          </button>
        )}
        {(m.status === 'DRAFT' || m.status === 'APPROVED') && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => act('discard')}
          >
            {t('discard', 'Discard')}
          </button>
        )}
      </div>
    </li>
  );
};

export const MessagesList = ({
  slug,
  applicationId,
}: {
  slug: string;
  applicationId?: string;
}) => {
  const { t } = useTranslation('common');
  const [status, setStatus] = useState('');
  const { can } = usePortalAccess(slug);
  const [drafting, setDrafting] = useState(false);
  const params = new URLSearchParams();

  if (status) params.set('status', status);
  if (applicationId) params.set('applicationId', applicationId);

  const { data, isLoading, isError, refresh } = useApi<MessageView[]>(
    `/api/teams/${slug}/messages?${params}`
  );

  if (isLoading) return <Loading />;
  if (isError) return <Error message={isError.message} />;

  const aiDraft = async () => {
    setDrafting(true);

    const r = await send(`/api/teams/${slug}/applications/ai-draft`, 'POST', {
      applicationId,
      kind: 'STATUS_UPDATE',
    });

    setDrafting(false);

    if (!r.ok) {
      toast.error(r.error as string);
      return;
    }

    toast.success(
      t('ai-draft-ready', 'Draft created. Review it before sending.')
    );
    refresh();
  };

  return (
    <div className="space-y-4">
      {applicationId && can('ai.use') && can('messages.send') && (
        <button
          type="button"
          className="btn btn-sm"
          disabled={drafting}
          onClick={aiDraft}
        >
          {t('ai-draft-message', 'Draft with AI')}
        </button>
      )}
      {!applicationId && (
        <div className="flex items-center gap-3">
          <h2 className="mr-auto text-xl font-medium">
            {t('messages', 'Messages')}
          </h2>
          <select
            className="select select-bordered select-sm"
            aria-label={t('status', 'Status')}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">{t('all-statuses', 'All statuses')}</option>
            {['DRAFT', 'APPROVED', 'SENT', 'DISCARDED'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
      )}
      <p className="text-xs opacity-70">
        {t(
          'messages-hint',
          'Nothing is emailed to a candidate until a person approves the text and sends it.'
        )}
      </p>
      {data?.length === 0 && (
        <p className="text-sm opacity-70">{t('no-messages', 'No messages.')}</p>
      )}
      <ul className="space-y-3">
        {(data ?? []).map((m) => (
          <Message
            key={`${m.id}-${m.status}`}
            slug={slug}
            m={m}
            refresh={refresh}
          />
        ))}
      </ul>
    </div>
  );
};

export const ComposeMessage = ({
  slug,
  applicationId,
  onDone,
}: {
  slug: string;
  applicationId: string;
  onDone: () => void;
}) => {
  const { t } = useTranslation('common');
  const [kind, setKind] = useState('CUSTOM');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const create = async () => {
    const r = await send(`/api/teams/${slug}/messages`, 'POST', {
      applicationId,
      kind,
      subject,
      body,
    });

    if (!r.ok) {
      toast.error(r.error as string);
      return;
    }

    setSubject('');
    setBody('');
    onDone();
  };

  return (
    <div className="space-y-2 rounded border p-3 text-sm">
      <h4 className="font-semibold">{t('new-message', 'New message draft')}</h4>
      <select
        className="select select-bordered select-sm"
        aria-label={t('kind', 'Type')}
        value={kind}
        onChange={(e) => setKind(e.target.value)}
      >
        {['CUSTOM', 'STATUS_UPDATE', 'REJECTION', 'INTERVIEW_INVITE'].map(
          (k) => (
            <option key={k}>{k}</option>
          )
        )}
      </select>
      <input
        className="input input-bordered input-sm w-full"
        placeholder="Subject"
        aria-label={t('subject', 'Subject')}
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
      />
      <textarea
        className="textarea textarea-bordered w-full"
        rows={4}
        placeholder="Message"
        aria-label={t('body', 'Message')}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <button
        type="button"
        className="btn btn-sm"
        disabled={!subject.trim() || !body.trim()}
        onClick={create}
      >
        {t('create-draft', 'Create draft')}
      </button>
    </div>
  );
};
