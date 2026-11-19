import { Panel } from '@/components/ui';
import { send } from 'hooks/useApi';
import usePortalAccess from 'hooks/usePortalAccess';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import toast from 'react-hot-toast';

type Source = { type: string; id: string; label: string };
type Msg = {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  steps?: { tool: string; ok: boolean }[];
};

const href = (slug: string, s: Source) =>
  s.type === 'candidate'
    ? `/teams/${slug}/talent/${s.id}`
    : s.type === 'application'
      ? `/teams/${slug}/applications/${s.id}`
      : s.type === 'job'
        ? `/teams/${slug}/jobs/${s.id}`
        : s.type === 'interview'
          ? `/teams/${slug}/interviews/${s.id}`
          : `/teams/${slug}/messages`;

/** Splits an answer into text and Markdown tables (| a | b | rows). */
const Answer = ({ text }: { text: string }) => {
  const blocks: ({ text: string } | { rows: string[][] })[] = [];
  let buf: string[] = [];
  let table: string[][] = [];

  const flushText = () => {
    if (buf.length) blocks.push({ text: buf.join('\n') });

    buf = [];
  };
  const flushTable = () => {
    if (table.length) blocks.push({ rows: table });

    table = [];
  };

  for (const line of text.split('\n')) {
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushText();

      if (!/^\s*\|[\s:|-]+\|\s*$/.test(line)) {
        table.push(
          line
            .trim()
            .replace(/^\||\|$/g, '')
            .split('|')
            .map((c) => c.trim())
        );
      }
    } else {
      flushTable();
      buf.push(line);
    }
  }

  flushText();
  flushTable();

  return (
    <>
      {blocks.map((b, i) =>
        'rows' in b ? (
          <div
            key={i}
            className="overflow-x-auto rounded-xl border bg-base-100"
          >
            <table className="table table-sm">
              <thead>
                <tr>
                  {b.rows[0].map((c, j) => (
                    <th key={j}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.slice(1).map((r, j) => (
                  <tr key={j}>
                    {r.map((c, k) => (
                      <td key={k} className={k === 0 ? 'opacity-70' : ''}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          b.text.trim() && (
            <div
              key={i}
              className="whitespace-pre-line rounded-2xl bg-base-200 p-4 text-sm"
            >
              {b.text.trim()}
            </div>
          )
        )
      )}
    </>
  );
};

const Copilot = ({ slug }: { slug: string }) => {
  const { t } = useTranslation('common');
  const { access } = usePortalAccess(slug);
  const [thread, setThread] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const asked = useRef(false);

  const prompts = [
    t('copilot-p1', 'Which candidates best match our open roles?'),
    t('copilot-p2', 'Summarize applications for my jobs'),
    t('copilot-p3', 'Generate interview questions for system design'),
    t('copilot-p4', 'Draft a follow-up email to a waiting candidate'),
  ];

  const ask = async (q: string) => {
    if (!q.trim() || busy) return;

    const next: Msg[] = [...thread, { role: 'user', content: q }];

    setThread(next);
    setText('');
    setBusy(true);

    const r = await send<{
      answer: string;
      sources: Source[];
      steps: { tool: string; ok: boolean }[];
    }>(`/api/teams/${slug}/copilot`, 'POST', {
      messages: next.slice(-12).map(({ role, content }) => ({ role, content })),
    });

    setBusy(false);

    if (!r.ok) {
      toast.error(r.error as string);
      return;
    }

    setThread([
      ...next,
      {
        role: 'assistant',
        content: r.data!.answer,
        sources: r.data!.sources,
        steps: r.data!.steps,
      },
    ]);
  };

  // the dashboard assistant sends its question as ?q=
  useEffect(() => {
    const q = router.query.q;

    if (!asked.current && typeof q === 'string' && q.trim()) {
      asked.current = true;
      ask(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.query.q]);

  return (
    <div className="flex flex-wrap gap-4">
      <aside className="w-full space-y-2 lg:w-64">
        <h2 className="font-display text-2xl font-bold">
          <span aria-hidden className="mr-2 text-secondary">
            {'✦'}
          </span>
          {t('copilot', 'Copilot')}
        </h2>
        <p className="text-sm opacity-70">
          {t(
            'copilot-note',
            'Answers come only from records your role can access in this portal. Actions that contact candidates need your approval.'
          )}
        </p>
        <span className="block pt-2 text-xs font-bold uppercase opacity-60">
          {t('copilot-try', 'Try')}
        </span>
        {prompts.map((p) => (
          <button
            key={p}
            type="button"
            className="w-full rounded-xl border bg-base-100 px-4 py-3 text-left text-sm hover:bg-base-200"
            onClick={() => ask(p)}
          >
            {p}
          </button>
        ))}
        <button
          type="button"
          className="link text-sm font-medium text-primary"
          onClick={() => setThread([])}
        >
          {t('copilot-clear', 'Clear conversation')}
        </button>
      </aside>

      <Panel pad="none" className="flex min-h-112 min-w-0 flex-1 flex-col">
        <div className="flex-1 space-y-4 p-4" aria-live="polite">
          {thread.length === 0 && (
            <p className="py-16 text-center text-sm opacity-70">
              {t(
                'copilot-empty',
                'Pick a question on the left or type your own.'
              )}
            </p>
          )}
          {thread.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="chat chat-end">
                <div className="chat-bubble chat-bubble-primary rounded-full">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={i} className="max-w-[92%] space-y-2">
                {m.steps && m.steps.length > 0 && (
                  <span className="block text-xs opacity-60">
                    {`${t('copilot-read', 'Read')} ${m.sources?.length ?? 0} ${t('copilot-records', 'records')} · ${t('copilot-used-short', 'used')}: ${m.steps.map((s) => s.tool).join(', ')}${access?.role ? ` · ${t('your-access', 'your access')}: ${access.role.name}` : ''}`}
                  </span>
                )}
                <Answer text={m.content} />
                {m.sources && m.sources.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {m.sources.slice(0, 4).map((s) => (
                      <Link
                        key={`${s.type}:${s.id}`}
                        href={href(slug, s)}
                        className="btn btn-sm btn-outline"
                      >
                        {`${t('open', 'Open')} ${s.label}`}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )
          )}
          {busy && <span className="loading loading-dots" role="status" />}
        </div>
        <form
          className="flex gap-2 border-t p-3"
          onSubmit={(e) => {
            e.preventDefault();
            ask(text);
          }}
        >
          <input
            className="input flex-1"
            aria-label={t('copilot-message', 'Message copilot')}
            placeholder={t(
              'copilot-placeholder',
              'Ask about jobs, candidates, interviews…'
            )}
            maxLength={2000}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {t('send', 'Send')}
          </button>
        </form>
      </Panel>
    </div>
  );
};

export default Copilot;
