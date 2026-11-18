import { Card, Error, InputWithLabel, Loading } from '@/components/shared';
import { defaultHeaders } from '@/lib/common';
import { useJob } from 'hooks/useJobs';
import usePortalAccess from 'hooks/usePortalAccess';
import useSWR from 'swr';
import fetcher from '@/lib/fetcher';
import { useTranslation } from 'next-i18next';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/daisy';
import JobDescriptionAI from '@/components/ai/JobDescriptionAI';
import toast from 'react-hot-toast';
import type { ApiResponse } from 'types';

type Question = {
  type: 'TEXT' | 'SINGLE' | 'MULTI' | 'NUMBER' | 'BOOLEAN';
  prompt: string;
  options: string;
  required: boolean;
};
type Location = { city: string; region: string; country: string };

type FormState = {
  title: string;
  descriptionHtml: string;
  responsibilities: string;
  visibility: string;
  employmentType: string;
  workMode: string;
  experienceMin: string;
  experienceMax: string;
  salaryMin: string;
  salaryMax: string;
  salaryCurrency: string;
  salaryVisible: boolean;
  department: string;
  industry: string;
  education: string;
  vacancies: string;
  benefits: string;
  closesAt: string;
  requiredSkills: string;
  optionalSkills: string;
  locations: Location[];
  questions: Question[];
};

const empty: FormState = {
  title: '',
  descriptionHtml: '',
  responsibilities: '',
  visibility: 'PUBLIC',
  employmentType: 'FULL_TIME',
  workMode: 'ONSITE',
  experienceMin: '',
  experienceMax: '',
  salaryMin: '',
  salaryMax: '',
  salaryCurrency: 'INR',
  salaryVisible: false,
  department: '',
  industry: '',
  education: '',
  vacancies: '1',
  benefits: '',
  closesAt: '',
  requiredSkills: '',
  optionalSkills: '',
  locations: [{ city: '', region: '', country: '' }],
  questions: [],
};

const list = (s: string, sep: RegExp) =>
  s
    .split(sep)
    .map((x) => x.trim())
    .filter(Boolean);
const num = (s: string) => (s.trim() === '' ? null : Number(s));

const JobForm = ({ slug, jobId }: { slug: string; jobId?: string }) => {
  const { t } = useTranslation('common');
  const router = useRouter();
  const { job, isLoading, isError, mutateJob } = useJob(slug, jobId);
  const { can } = usePortalAccess(slug);
  const [f, setF] = useState<FormState>(empty);
  const [saving, setSaving] = useState(false);
  const [publishAt, setPublishAt] = useState('');

  useEffect(() => {
    if (!job) {
      return;
    }

    setF({
      title: job.title,
      descriptionHtml: job.descriptionHtml,
      responsibilities: job.responsibilities.join('\n'),
      visibility: job.visibility,
      employmentType: job.employmentType,
      workMode: job.workMode,
      experienceMin: job.experienceMin?.toString() ?? '',
      experienceMax: job.experienceMax?.toString() ?? '',
      salaryMin: job.salaryMin?.toString() ?? '',
      salaryMax: job.salaryMax?.toString() ?? '',
      salaryCurrency: job.salaryCurrency,
      salaryVisible: job.salaryVisible,
      department: job.department ?? '',
      industry: job.industry ?? '',
      education: job.education ?? '',
      vacancies: String(job.vacancies),
      benefits: job.benefits.join(', '),
      closesAt: job.closesAt ? job.closesAt.toString().slice(0, 10) : '',
      requiredSkills: job.skills
        .filter((s) => s.required)
        .map((s) => s.skill)
        .join(', '),
      optionalSkills: job.skills
        .filter((s) => !s.required)
        .map((s) => s.skill)
        .join(', '),
      locations: job.locations.length
        ? job.locations.map((l) => ({
            city: l.city ?? '',
            region: l.region ?? '',
            country: l.country ?? '',
          }))
        : [{ city: '', region: '', country: '' }],
      questions: job.questions.map((q) => ({
        type: q.type,
        prompt: q.prompt,
        options: q.options.join(', '),
        required: q.required,
      })),
    });
  }, [job]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setF((s) => ({ ...s, [k]: v }));

  if (jobId && isLoading) {
    return <Loading />;
  }

  if (jobId && isError) {
    return <Error message={isError.message} />;
  }

  const body = () => ({
    title: f.title,
    descriptionHtml: f.descriptionHtml,
    responsibilities: list(f.responsibilities, /\n/),
    visibility: f.visibility,
    employmentType: f.employmentType,
    workMode: f.workMode,
    experienceMin: num(f.experienceMin),
    experienceMax: num(f.experienceMax),
    salaryMin: num(f.salaryMin),
    salaryMax: num(f.salaryMax),
    salaryCurrency: f.salaryCurrency || 'INR',
    salaryVisible: f.salaryVisible,
    department: f.department,
    industry: f.industry,
    education: f.education,
    vacancies: Number(f.vacancies) || 1,
    benefits: list(f.benefits, /,/),
    closesAt: f.closesAt ? new Date(f.closesAt).toISOString() : null,
    skills: [
      ...list(f.requiredSkills, /,/).map((skill) => ({
        skill,
        required: true,
      })),
      ...list(f.optionalSkills, /,/).map((skill) => ({
        skill,
        required: false,
      })),
    ],
    locations: f.locations.filter((l) => l.city || l.region || l.country),
    questions: f.questions
      .filter((q) => q.prompt.trim())
      .map((q) => ({
        type: q.type,
        prompt: q.prompt,
        options: list(q.options, /,/),
        required: q.required,
      })),
  });

  const save = async () => {
    setSaving(true);

    const r = await fetch(
      jobId ? `/api/teams/${slug}/jobs/${jobId}` : `/api/teams/${slug}/jobs`,
      {
        method: jobId ? 'PUT' : 'POST',
        headers: defaultHeaders,
        body: JSON.stringify(body()),
      }
    );
    const json = (await r.json()) as ApiResponse<{ id: string }>;

    setSaving(false);

    if (!r.ok) {
      toast.error(json.error.message);
      return;
    }

    toast.success(t('job-saved', 'Job saved.'));

    if (jobId) {
      mutateJob();
    } else {
      router.push(`/teams/${slug}/jobs/${json.data.id}`);
    }
  };

  const act = async (action: string, extra: object = {}) => {
    const r = await fetch(`/api/teams/${slug}/jobs/${jobId}/actions`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ action, ...extra }),
    });
    const json = (await r.json()) as ApiResponse<{ id: string }>;

    if (!r.ok) {
      toast.error(json.error.message);
      return;
    }

    if (action === 'duplicate') {
      router.push(`/teams/${slug}/jobs/${json.data.id}`);
      return;
    }

    toast.success(t('job-updated', 'Job updated.'));
    mutateJob();
  };

  const status = job?.status;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      {job && (
        <Card className="lg:col-span-2">
          <Card.Body>
            <div className="flex flex-wrap items-center gap-2">
              <span className="badge badge-lg">{job.effectiveStatus}</span>
              <span className="text-sm opacity-70">
                {job.applicationCount} {t('applicants', 'Applicants')}
              </span>
              <Link
                className="btn btn-sm ml-auto"
                href={`/teams/${slug}/jobs/${job.id}/pipeline`}
              >
                {t('pipeline', 'Pipeline')}
              </Link>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {can('jobs.publish') &&
                (status === 'DRAFT' || status === 'SCHEDULED') && (
                  <Button
                    size="sm"
                    color="primary"
                    onClick={() => act('publish')}
                  >
                    {t('publish', 'Publish')}
                  </Button>
                )}
              {can('jobs.publish') && status === 'DRAFT' && (
                <span className="flex items-center gap-1">
                  <input
                    type="datetime-local"
                    className="input  input-sm"
                    aria-label={t('publish-at', 'Publish at')}
                    value={publishAt}
                    onChange={(e) => setPublishAt(e.target.value)}
                  />
                  <Button
                    size="sm"
                    disabled={!publishAt}
                    onClick={() =>
                      act('schedule', {
                        publishAt: new Date(publishAt).toISOString(),
                      })
                    }
                  >
                    {t('schedule', 'Schedule')}
                  </Button>
                </span>
              )}
              {can('jobs.publish') &&
                (status === 'PUBLISHED' || status === 'SCHEDULED') && (
                  <Button size="sm" onClick={() => act('close')}>
                    {t('close-job', 'Close job')}
                  </Button>
                )}
              {can('jobs.publish') && status === 'CLOSED' && (
                <Button size="sm" onClick={() => act('reopen')}>
                  {t('reopen', 'Reopen')}
                </Button>
              )}
              {can('jobs.create') && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => act('duplicate')}
                >
                  {t('duplicate', 'Duplicate')}
                </Button>
              )}
              {can('jobs.delete') && status !== 'ARCHIVED' && (
                <Button
                  size="sm"
                  color="error"
                  variant="outline"
                  onClick={() => act('archive')}
                >
                  {t('archive', 'Archive')}
                </Button>
              )}
            </div>
          </Card.Body>
        </Card>
      )}

      <div className="min-w-0 space-y-6">
        <Card>
          <Card.Body>
            <Card.Header>
              <Card.Title>{t('job-details', 'Job details')}</Card.Title>
            </Card.Header>
            <InputWithLabel
              name="title"
              label={t('title', 'Title')}
              value={f.title}
              onChange={(e) => set('title', e.target.value)}
            />
            <label className="flex flex-col w-full">
              <span className="text-sm pb-2">
                {t('job-description', 'Description (basic HTML allowed)')}
              </span>
              <textarea
                name="descriptionHtml"
                className="textarea "
                rows={8}
                value={f.descriptionHtml}
                onChange={(e) => set('descriptionHtml', e.target.value)}
              />
            </label>
            <label className="flex flex-col w-full">
              <span className="text-sm pb-2">
                {t('responsibilities', 'Responsibilities (one per line)')}
              </span>
              <textarea
                name="responsibilities"
                className="textarea "
                rows={4}
                value={f.responsibilities}
                onChange={(e) => set('responsibilities', e.target.value)}
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-3">
              <Select
                label={t('employment-type', 'Employment type')}
                name="employmentType"
                value={f.employmentType}
                onChange={(v) => set('employmentType', v)}
                options={[
                  'FULL_TIME',
                  'PART_TIME',
                  'CONTRACT',
                  'INTERNSHIP',
                  'TEMPORARY',
                ]}
              />
              <Select
                label={t('work-mode', 'Work mode')}
                name="workMode"
                value={f.workMode}
                onChange={(v) => set('workMode', v)}
                options={['ONSITE', 'HYBRID', 'REMOTE']}
              />
              <Select
                label={t('visibility', 'Visibility')}
                name="visibility"
                value={f.visibility}
                onChange={(v) => set('visibility', v)}
                options={['PUBLIC', 'UNLISTED', 'INTERNAL']}
              />
              <InputWithLabel
                name="experienceMin"
                type="number"
                label={t('experience-min', 'Min experience (years)')}
                value={f.experienceMin}
                onChange={(e) => set('experienceMin', e.target.value)}
              />
              <InputWithLabel
                name="experienceMax"
                type="number"
                label={t('experience-max', 'Max experience (years)')}
                value={f.experienceMax}
                onChange={(e) => set('experienceMax', e.target.value)}
              />
              <InputWithLabel
                name="vacancies"
                type="number"
                label={t('vacancies', 'Vacancies')}
                value={f.vacancies}
                onChange={(e) => set('vacancies', e.target.value)}
              />
              <InputWithLabel
                name="salaryMin"
                type="number"
                label={t('salary-min', 'Salary min (per year)')}
                value={f.salaryMin}
                onChange={(e) => set('salaryMin', e.target.value)}
              />
              <InputWithLabel
                name="salaryMax"
                type="number"
                label={t('salary-max', 'Salary max (per year)')}
                value={f.salaryMax}
                onChange={(e) => set('salaryMax', e.target.value)}
              />
              <InputWithLabel
                name="salaryCurrency"
                label={t('currency', 'Currency')}
                value={f.salaryCurrency}
                onChange={(e) =>
                  set(
                    'salaryCurrency',
                    e.target.value.toUpperCase().slice(0, 3)
                  )
                }
              />
              <InputWithLabel
                name="department"
                label={t('department', 'Department')}
                value={f.department}
                onChange={(e) => set('department', e.target.value)}
              />
              <InputWithLabel
                name="industry"
                label={t('portal-industry')}
                value={f.industry}
                onChange={(e) => set('industry', e.target.value)}
              />
              <InputWithLabel
                name="education"
                label={t('education', 'Education')}
                value={f.education}
                onChange={(e) => set('education', e.target.value)}
              />
              <InputWithLabel
                name="closesAt"
                type="date"
                label={t('closes-at', 'Closing date')}
                value={f.closesAt}
                onChange={(e) => set('closesAt', e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={f.salaryVisible}
                onChange={(e) => set('salaryVisible', e.target.checked)}
              />
              {t('salary-visible', 'Show salary on the public job page')}
            </label>
            <InputWithLabel
              name="benefits"
              label={t('benefits', 'Benefits (comma separated)')}
              value={f.benefits}
              onChange={(e) => set('benefits', e.target.value)}
            />
            <InputWithLabel
              name="requiredSkills"
              label={t('required-skills', 'Required skills (comma separated)')}
              value={f.requiredSkills}
              onChange={(e) => set('requiredSkills', e.target.value)}
            />
            <InputWithLabel
              name="optionalSkills"
              label={t(
                'optional-skills',
                'Nice-to-have skills (comma separated)'
              )}
              value={f.optionalSkills}
              onChange={(e) => set('optionalSkills', e.target.value)}
            />
          </Card.Body>
        </Card>

        <Card>
          <Card.Body>
            <Card.Header>
              <Card.Title>{t('locations', 'Locations')}</Card.Title>
            </Card.Header>
            {f.locations.map((l, i) => (
              <div key={i} className="flex flex-wrap gap-2">
                {(['city', 'region', 'country'] as const).map((k) => (
                  <input
                    key={k}
                    className="input  input-sm"
                    placeholder={k}
                    aria-label={`${k} ${i + 1}`}
                    value={l[k]}
                    onChange={(e) =>
                      set(
                        'locations',
                        f.locations.map((x, j) =>
                          j === i ? { ...x, [k]: e.target.value } : x
                        )
                      )
                    }
                  />
                ))}
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() =>
                    set(
                      'locations',
                      f.locations.filter((_, j) => j !== i)
                    )
                  }
                >
                  {t('remove')}
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-sm w-fit"
              onClick={() =>
                set('locations', [
                  ...f.locations,
                  { city: '', region: '', country: '' },
                ])
              }
            >
              {t('add-location', 'Add location')}
            </button>
          </Card.Body>
        </Card>

        <Card>
          <Card.Body>
            <Card.Header>
              <Card.Title>
                {t('screening-questions', 'Screening questions')}
              </Card.Title>
            </Card.Header>
            {f.questions.map((q, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <select
                  className="select  select-sm"
                  aria-label={`type ${i + 1}`}
                  value={q.type}
                  onChange={(e) =>
                    set(
                      'questions',
                      f.questions.map((x, j) =>
                        j === i
                          ? { ...x, type: e.target.value as Question['type'] }
                          : x
                      )
                    )
                  }
                >
                  {['TEXT', 'SINGLE', 'MULTI', 'NUMBER', 'BOOLEAN'].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
                <input
                  className="input  input-sm min-w-[16rem] flex-1"
                  placeholder="Question"
                  aria-label={`question ${i + 1}`}
                  value={q.prompt}
                  onChange={(e) =>
                    set(
                      'questions',
                      f.questions.map((x, j) =>
                        j === i ? { ...x, prompt: e.target.value } : x
                      )
                    )
                  }
                />
                {(q.type === 'SINGLE' || q.type === 'MULTI') && (
                  <input
                    className="input  input-sm"
                    placeholder="Options, comma separated"
                    aria-label={`options ${i + 1}`}
                    value={q.options}
                    onChange={(e) =>
                      set(
                        'questions',
                        f.questions.map((x, j) =>
                          j === i ? { ...x, options: e.target.value } : x
                        )
                      )
                    }
                  />
                )}
                <label className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={q.required}
                    onChange={(e) =>
                      set(
                        'questions',
                        f.questions.map((x, j) =>
                          j === i ? { ...x, required: e.target.checked } : x
                        )
                      )
                    }
                  />
                  {t('required', 'Required')}
                </label>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() =>
                    set(
                      'questions',
                      f.questions.filter((_, j) => j !== i)
                    )
                  }
                >
                  {t('remove')}
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-sm w-fit"
              onClick={() =>
                set('questions', [
                  ...f.questions,
                  { type: 'TEXT', prompt: '', options: '', required: false },
                ])
              }
            >
              {t('add-question', 'Add question')}
            </button>
          </Card.Body>
        </Card>

        {(!jobId || can('jobs.update')) && (
          <Button color="primary" loading={saving} onClick={save}>
            {t('save-changes')}
          </Button>
        )}

        {jobId && can('jobs.update') && (
          <Assignments slug={slug} jobId={jobId} />
        )}
      </div>

      {can('ai.use') && (
        <aside className="lg:sticky lg:top-24">
          <JobDescriptionAI
            slug={slug}
            title={f.title}
            skills={f.requiredSkills
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean)}
            workMode={f.workMode}
            onApply={(html) => set('descriptionHtml', html)}
          />
        </aside>
      )}
    </div>
  );
};

const Select = ({
  label,
  name,
  value,
  onChange,
  options,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) => (
  <label className="flex flex-col w-full">
    <span className="text-sm pb-2">{label}</span>
    <select
      name={name}
      className="select "
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  </label>
);

type Assignee = {
  userId: string;
  name: string;
  email: string;
  role: string | null;
};

const Assignments = ({ slug, jobId }: { slug: string; jobId: string }) => {
  const { t } = useTranslation('common');
  const { job, mutateJob } = useJob(slug, jobId);
  const { data } = useSWR<ApiResponse<Assignee[]>>(
    `/api/teams/${slug}/jobs/${jobId}/assignments`,
    fetcher
  );
  const [picked, setPicked] = useState<Record<string, string>>({});

  useEffect(() => {
    if (job) {
      setPicked(
        Object.fromEntries(job.assignments.map((a) => [a.userId, a.kind]))
      );
    }
  }, [job]);

  const save = async () => {
    const r = await fetch(`/api/teams/${slug}/jobs/${jobId}/assignments`, {
      method: 'PUT',
      headers: defaultHeaders,
      body: JSON.stringify({
        assignments: Object.entries(picked)
          .filter(([, kind]) => kind)
          .map(([userId, kind]) => ({ userId, kind })),
      }),
    });

    if (!r.ok) {
      toast.error(((await r.json()) as ApiResponse).error.message);
      return;
    }

    toast.success(t('assignments-saved', 'Assignments saved.'));
    mutateJob();
  };

  return (
    <Card>
      <Card.Body>
        <Card.Header>
          <Card.Title>{t('assignments', 'Assignments')}</Card.Title>
          <Card.Description>
            {t(
              'assignments-hint',
              'Recruiters, hiring managers and interviewers only see jobs they are assigned to.'
            )}
          </Card.Description>
        </Card.Header>
        {(data?.data ?? []).map((m) => (
          <div key={m.userId} className="flex items-center gap-2 text-sm">
            <span className="w-56 truncate">
              {m.name} ({m.email})
            </span>
            <select
              className="select  select-sm"
              aria-label={`assignment ${m.email}`}
              value={picked[m.userId] ?? ''}
              onChange={(e) =>
                setPicked({ ...picked, [m.userId]: e.target.value })
              }
            >
              <option value="">{t('not-assigned', 'Not assigned')}</option>
              <option value="RECRUITER">RECRUITER</option>
              <option value="HIRING_MANAGER">HIRING_MANAGER</option>
              <option value="INTERVIEWER">INTERVIEWER</option>
            </select>
          </div>
        ))}
        <Button size="sm" className="w-fit" onClick={save}>
          {t('save-assignments', 'Save assignments')}
        </Button>
      </Card.Body>
    </Card>
  );
};

export default JobForm;
