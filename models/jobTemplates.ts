import { ApiError } from '@/lib/errors';
import { getJobTemplate, type JobTemplate } from '@/lib/industryTemplates';
import type { TenantContext } from '@/lib/tenant';
import { createJobSchema } from '@/lib/zod';
import { createJob } from './job';

/** The job form payload for a template (what the editor would send). */
export const templateToJobInput = (t: JobTemplate, industry?: string | null) =>
  createJobSchema.parse({
    title: t.title,
    descriptionHtml: t.descriptionHtml,
    responsibilities: t.responsibilities,
    employmentType: t.employmentType,
    workMode: 'ONSITE',
    experienceMin: t.experienceMin,
    experienceMax: t.experienceMax,
    department: t.department,
    industry: industry ?? undefined,
    education: t.education,
    benefits: t.benefits,
    skills: [
      ...t.requiredSkills.map((skill) => ({ skill, required: true })),
      ...t.optionalSkills.map((skill) => ({ skill, required: false })),
    ],
    questions: t.questions.map((q) => ({
      type: q.type,
      prompt: q.prompt,
      options: q.options ?? [],
      required: q.required,
    })),
    attributes: t.attributes,
  });

/** Creates draft jobs from template keys. Drafts do not count towards plan limits. */
export async function createJobsFromTemplates(
  ctx: TenantContext,
  keys: string[],
  industry?: string | null
) {
  const templates = Array.from(new Set(keys)).map((k) => {
    const t = getJobTemplate(k);

    if (!t) {
      throw new ApiError(422, `Unknown job template: ${k}`);
    }

    return t;
  });
  const created: Awaited<ReturnType<typeof createJob>>[] = [];

  for (const t of templates) {
    created.push(await createJob(ctx, templateToJobInput(t, industry)));
  }

  return created;
}
