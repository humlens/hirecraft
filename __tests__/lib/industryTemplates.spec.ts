/**
 * @jest-environment node
 */
import {
  INDUSTRY_TEMPLATES,
  JOB_TEMPLATES,
  getJobTemplate,
  jobAttributesSchema,
} from '@/lib/industryTemplates';
import { createJobSchema } from '@/lib/zod';
import { templateToJobInput } from 'models/jobTemplates';

describe('industry templates', () => {
  it('every suggested job exists and keys are unique', () => {
    const keys = JOB_TEMPLATES.map((j) => j.key);

    expect(new Set(keys).size).toBe(keys.length);
    INDUSTRY_TEMPLATES.forEach((t) =>
      t.jobs.forEach((k) => expect(getJobTemplate(k)).toBeDefined())
    );
  });

  it('every job template passes the same validation as the job form', () => {
    for (const t of JOB_TEMPLATES) {
      const input = templateToJobInput(t);

      expect(createJobSchema.safeParse(input).success).toBe(true);
      expect(input.attributes).toEqual(jobAttributesSchema.parse(t.attributes));
    }
  });

  it('licensed roles ask for the registration number', () => {
    for (const t of JOB_TEMPLATES.filter((j) => j.attributes.licenseRequired)) {
      expect(
        t.questions.some(
          (q) => /registration number/i.test(q.prompt) && q.required
        )
      ).toBe(true);
      expect(t.attributes.licenseBody).toBeTruthy();
    }
  });

  it('healthcare pipelines keep the terminal stages last and add a verification step', () => {
    for (const t of INDUSTRY_TEMPLATES.filter((x) => x.stages)) {
      const stages = t.stages!;
      const kinds = stages.map((s) => s.kind);

      expect(kinds.slice(-3)).toEqual(['HIRED', 'REJECTED', 'WITHDRAWN']);
      expect(kinds.slice(0, -3).every((k) => k === 'ACTIVE')).toBe(true);
      expect(stages.some((s) => /Credential|Registration/.test(s.name))).toBe(
        true
      );
      expect(stages[0].name).toBe('Applied');
    }
  });

  it('attributes reject unknown shifts', () => {
    expect(jobAttributesSchema.safeParse({ shift: 'WEEKENDS' }).success).toBe(
      false
    );
    expect(jobAttributesSchema.safeParse({}).success).toBe(true);
  });
});
