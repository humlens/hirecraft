import { runAIFeature } from '@/lib/ai/run';
import { sanitizeJobHtml } from '@/lib/jobs';
import type { TenantContext } from '@/lib/tenant';
import { aiContext } from './context';

export type JdInput = {
  title: string;
  tone: 'professional' | 'friendly' | 'concise';
  workMode?: string;
  location?: string;
  experience?: string;
  skills: string[];
  notes?: string;
};

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const list = (items: string[]) =>
  items.length
    ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
    : '';

/** Structured, editable job description. The HTML is built here and sanitised. */
export async function generateJobDescription(
  ctx: TenantContext,
  input: JdInput
) {
  const { data, model, promptVersion } = await runAIFeature(
    aiContext(ctx),
    'jd.generate',
    {
      title: input.title,
      tone: input.tone,
      workMode: input.workMode ?? 'not specified',
      location: input.location ?? 'not specified',
      experience: input.experience ?? 'not specified',
      skills: input.skills,
      notes: input.notes ?? '',
    }
  );

  const html = [
    `<p>${esc(data.overview)}</p>`,
    '<h3>Responsibilities</h3>',
    list(data.responsibilities),
    '<h3>What we are looking for</h3>',
    list(data.requirements),
    data.niceToHave.length
      ? `<h3>Nice to have</h3>${list(data.niceToHave)}`
      : '',
    data.benefits.length ? `<h3>Benefits</h3>${list(data.benefits)}` : '',
  ].join('');

  return {
    sections: data,
    descriptionHtml: sanitizeJobHtml(html),
    model,
    promptVersion,
  };
}
