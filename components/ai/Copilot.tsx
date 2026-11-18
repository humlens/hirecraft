import { send } from 'hooks/useApi';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import { useState } from 'react';
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

const Copilot = ({ slug }: { slug: string }) => {
  const { t } = useTranslation('common');
  const [thread, setThread] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

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

  return (
    <div className="flex flex-wrap gap-4">
      <aside className="w-full space-y-2 lg:w-64">
        <h2 className="text-xl font-medium">{t('copilot', 'Copilot')}</h2>
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
            className="btn btn-sm h-auto w-full justify-start py-2 text-left font-normal normal-case"
            onClick={() => ask(p)}
          >
            {p}
          </button>
        ))}
        <button
          type="button"
          className="link text-sm"
          onClick={() => setThread([])}
        >
          {t('copilot-clear', 'Clear conversation')}
        </button>
      </aside>

      <section className="flex min-h-112 min-w-0 flex-1 flex-col rounded-lg border">
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
                <div className="chat-bubble chat-bubble-primary">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={i} className="max-w-[92%] space-y-2">
                {m.steps && m.steps.length > 0 && (
                  <span className="text-xs opacity-60">
                    {t('copilot-used', 'Used: {{tools}}', {
                      tools: m.steps.map((s) => s.tool).join(', '),
                    })}
                  </span>
                )}
                <div className="whitespace-pre-line rounded-lg bg-base-200 p-3 text-sm">
                  {m.content}
                </div>
                {m.sources && m.sources.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {m.sources.map((s) => (
                      <Link
                        key={`${s.type}:${s.id}`}
                        href={href(slug, s)}
                        className="badge badge-outline"
                      >
                        {s.label}
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
            className="input  input-sm flex-1"
            aria-label={t('copilot-message', 'Message copilot')}
            placeholder={t(
              'copilot-placeholder',
              'Ask about jobs, candidates, interviews…'
            )}
            maxLength={2000}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={busy}
          >
            {t('send', 'Send')}
          </button>
        </form>
      </section>
    </div>
  );
};

export default Copilot;
