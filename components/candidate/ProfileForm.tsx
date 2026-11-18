import ParsedReview from '@/components/candidate/ParsedReview';
import { Error, Loading } from '@/components/shared';
import { defaultHeaders } from '@/lib/common';
import { useMyProfile, useMyResumes } from 'hooks/useCandidate';
import { useTranslation } from 'next-i18next';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/daisy';
import toast from 'react-hot-toast';
import type { ApiResponse } from 'types';

type Exp = {
  company: string;
  title: string;
  startDate: string;
  endDate: string;
  current: boolean;
  description: string;
};
type Edu = {
  institution: string;
  degree: string;
  field: string;
  startYear: string;
  endYear: string;
};

const ProfileForm = () => {
  const { t } = useTranslation('common');
  const { data, isLoading, isError, refresh } = useMyProfile();
  const { data: resumes, refresh: refreshResumes } = useMyResumes();
  const [f, setF] = useState({
    headline: '',
    summary: '',
    phone: '',
    location: '',
    expectedSalary: '',
    noticePeriodDays: '',
    linkedinUrl: '',
    githubUrl: '',
    portfolioUrl: '',
    skills: '',
  });
  const [exps, setExps] = useState<Exp[]>([]);
  const [edus, setEdus] = useState<Edu[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) {
      return;
    }

    setF({
      headline: data.headline ?? '',
      summary: data.summary ?? '',
      phone: data.phone ?? '',
      location: data.location ?? '',
      expectedSalary: data.expectedSalary?.toString() ?? '',
      noticePeriodDays: data.noticePeriodDays?.toString() ?? '',
      linkedinUrl: data.linkedinUrl ?? '',
      githubUrl: data.githubUrl ?? '',
      portfolioUrl: data.portfolioUrl ?? '',
      skills: data.skills.map((s) => s.skill).join(', '),
    });
    setExps(
      data.experiences.map((e) => ({
        company: e.company,
        title: e.title,
        startDate: String(e.startDate).slice(0, 10),
        endDate: e.endDate ? String(e.endDate).slice(0, 10) : '',
        current: e.current,
        description: e.description ?? '',
      }))
    );
    setEdus(
      data.educations.map((e) => ({
        institution: e.institution,
        degree: e.degree,
        field: e.field ?? '',
        startYear: e.startYear?.toString() ?? '',
        endYear: e.endYear?.toString() ?? '',
      }))
    );
  }, [data]);

  if (isLoading) {
    return <Loading />;
  }

  if (isError) {
    return <Error message={isError.message} />;
  }

  const n = (s: string) => (s.trim() === '' ? null : Number(s));

  const save = async () => {
    setSaving(true);

    const r = await fetch('/api/candidate/profile', {
      method: 'PUT',
      headers: defaultHeaders,
      body: JSON.stringify({
        ...f,
        expectedSalary: n(f.expectedSalary),
        noticePeriodDays: n(f.noticePeriodDays),
        skills: f.skills
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        experiences: exps
          .filter((e) => e.company && e.title && e.startDate)
          .map((e) => ({
            ...e,
            endDate: e.current || !e.endDate ? null : e.endDate,
          })),
        educations: edus
          .filter((e) => e.institution && e.degree)
          .map((e) => ({
            ...e,
            startYear: n(e.startYear),
            endYear: n(e.endYear),
          })),
      }),
    });

    setSaving(false);

    if (!r.ok) {
      toast.error(((await r.json()) as ApiResponse).error.message);
      return;
    }

    toast.success(t('successfully-updated'));
    refresh();
  };

  const upload = async (file: File) => {
    const r = await fetch('/api/candidate/resumes', {
      method: 'POST',
      headers: {
        'Content-Type': file.type,
        'X-File-Name': encodeURIComponent(file.name),
      },
      body: file,
    });

    if (!r.ok) {
      toast.error(((await r.json()) as ApiResponse).error.message);
      return;
    }

    toast.success(t('resume-uploaded', 'Resume uploaded.'));
    refreshResumes();
    refresh();
  };

  const removeResume = async (id: string) => {
    const r = await fetch(`/api/candidate/resumes/${id}`, {
      method: 'DELETE',
      headers: defaultHeaders,
    });

    if (!r.ok) {
      toast.error(((await r.json()) as ApiResponse).error.message);
      return;
    }

    refreshResumes();
    refresh();
  };

  const input = (key: keyof typeof f, label: string, type = 'text') => (
    <label className="flex flex-col w-full">
      <span className="text-sm pb-1">{label}</span>
      <input
        type={type}
        name={key}
        className="input  input-sm"
        value={f[key]}
        onChange={(e) => setF({ ...f, [key]: e.target.value })}
      />
    </label>
  );

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t('resumes', 'Resumes')}</h2>
        <ul className="space-y-1 text-sm">
          {(resumes ?? []).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3">
              <span>{r.fileName}</span>
              <button
                type="button"
                className="link text-error"
                onClick={() => removeResume(r.id)}
              >
                {t('remove')}
              </button>
              <div className="basis-full">
                <ParsedReview resumeId={r.id} onChanged={refresh} />
              </div>
            </li>
          ))}
        </ul>
        <input
          type="file"
          accept=".pdf,.docx"
          aria-label={t('upload-resume-file', 'Upload resume')}
          className="file-input  file-input-sm"
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        {input('headline', t('headline', 'Headline'))}
        {input('location', t('location', 'Location'))}
        {input('phone', t('phone', 'Phone'))}
        {input(
          'expectedSalary',
          t('expected-salary', 'Expected salary (per year)'),
          'number'
        )}
        {input(
          'noticePeriodDays',
          t('notice-period', 'Notice period (days)'),
          'number'
        )}
        {input('linkedinUrl', 'LinkedIn')}
        {input('githubUrl', 'GitHub')}
        {input('portfolioUrl', t('portfolio', 'Portfolio'))}
        <label className="flex flex-col w-full sm:col-span-2">
          <span className="text-sm pb-1">{t('summary', 'Summary')}</span>
          <textarea
            className="textarea "
            rows={4}
            value={f.summary}
            onChange={(e) => setF({ ...f, summary: e.target.value })}
          />
        </label>
        <label className="flex flex-col w-full sm:col-span-2">
          <span className="text-sm pb-1">
            {t('skills-comma', 'Skills (comma separated)')}
          </span>
          <input
            name="skills"
            className="input  input-sm"
            value={f.skills}
            onChange={(e) => setF({ ...f, skills: e.target.value })}
          />
        </label>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          {t('experience', 'Experience')}
        </h2>
        {exps.map((e, i) => (
          <div key={i} className="grid gap-2 rounded border p-3 sm:grid-cols-2">
            <input
              className="input  input-sm"
              placeholder="Company"
              aria-label={`company ${i + 1}`}
              value={e.company}
              onChange={(ev) =>
                setExps(
                  exps.map((x, j) =>
                    j === i ? { ...x, company: ev.target.value } : x
                  )
                )
              }
            />
            <input
              className="input  input-sm"
              placeholder="Title"
              aria-label={`title ${i + 1}`}
              value={e.title}
              onChange={(ev) =>
                setExps(
                  exps.map((x, j) =>
                    j === i ? { ...x, title: ev.target.value } : x
                  )
                )
              }
            />
            <input
              type="date"
              className="input  input-sm"
              aria-label={`start ${i + 1}`}
              value={e.startDate}
              onChange={(ev) =>
                setExps(
                  exps.map((x, j) =>
                    j === i ? { ...x, startDate: ev.target.value } : x
                  )
                )
              }
            />
            <input
              type="date"
              className="input  input-sm"
              aria-label={`end ${i + 1}`}
              disabled={e.current}
              value={e.endDate}
              onChange={(ev) =>
                setExps(
                  exps.map((x, j) =>
                    j === i ? { ...x, endDate: ev.target.value } : x
                  )
                )
              }
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={e.current}
                onChange={(ev) =>
                  setExps(
                    exps.map((x, j) =>
                      j === i ? { ...x, current: ev.target.checked } : x
                    )
                  )
                }
              />
              {t('current-role', 'I currently work here')}
            </label>
            <button
              type="button"
              className="btn btn-xs btn-ghost w-fit"
              onClick={() => setExps(exps.filter((_, j) => j !== i))}
            >
              {t('remove')}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-sm"
          onClick={() =>
            setExps([
              ...exps,
              {
                company: '',
                title: '',
                startDate: '',
                endDate: '',
                current: false,
                description: '',
              },
            ])
          }
        >
          {t('add-experience', 'Add experience')}
        </button>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t('education', 'Education')}</h2>
        {edus.map((e, i) => (
          <div key={i} className="grid gap-2 rounded border p-3 sm:grid-cols-2">
            <input
              className="input  input-sm"
              placeholder="Institution"
              aria-label={`institution ${i + 1}`}
              value={e.institution}
              onChange={(ev) =>
                setEdus(
                  edus.map((x, j) =>
                    j === i ? { ...x, institution: ev.target.value } : x
                  )
                )
              }
            />
            <input
              className="input  input-sm"
              placeholder="Degree"
              aria-label={`degree ${i + 1}`}
              value={e.degree}
              onChange={(ev) =>
                setEdus(
                  edus.map((x, j) =>
                    j === i ? { ...x, degree: ev.target.value } : x
                  )
                )
              }
            />
            <button
              type="button"
              className="btn btn-xs btn-ghost w-fit"
              onClick={() => setEdus(edus.filter((_, j) => j !== i))}
            >
              {t('remove')}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-sm"
          onClick={() =>
            setEdus([
              ...edus,
              {
                institution: '',
                degree: '',
                field: '',
                startYear: '',
                endYear: '',
              },
            ])
          }
        >
          {t('add-education', 'Add education')}
        </button>
      </section>

      <Button color="primary" loading={saving} onClick={save}>
        {t('save-changes')}
      </Button>
    </div>
  );
};

export default ProfileForm;
