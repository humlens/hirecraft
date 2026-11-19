import { Panel, Pill, Tabs } from '@/components/ui';
import { JOB_TEMPLATES, type JobTemplate } from '@/lib/industryTemplates';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

const CATEGORIES = [
  'All',
  'Nursing',
  'Physicians',
  'Allied health',
  'Pharmacy',
  'Operations',
] as const;

/** Healthcare job templates grouped by category; picking one fills the job form. */
const JobTemplatePicker = ({
  onPick,
}: {
  onPick: (template: JobTemplate) => void;
}) => {
  const { t } = useTranslation('common');
  const [cat, setCat] = useState<(typeof CATEGORIES)[number]>('All');
  const shown = JOB_TEMPLATES.filter(
    (j) => cat === 'All' || j.category === cat
  );

  return (
    <Panel
      title={t('job-templates', 'Start from a healthcare template')}
      className="space-y-3"
    >
      <p className="text-sm opacity-70">
        {t(
          'job-templates-hint',
          'Fills the description, skills, screening questions and licence requirements. You can change everything.'
        )}
      </p>
      <Tabs
        value={cat}
        onChange={setCat}
        tabs={CATEGORIES.map((c) => ({ value: c, label: c }))}
      />
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((j) => (
          <li key={j.key}>
            <button
              type="button"
              onClick={() => onPick(j)}
              className="h-full w-full rounded-xl border p-3 text-left hover:bg-base-200"
            >
              <span className="block font-display font-semibold">
                {j.title}
              </span>
              <span className="block text-sm opacity-70">{j.department}</span>
              <span className="mt-2 flex flex-wrap gap-1.5">
                <Pill tone="secondary">{j.category}</Pill>
                {j.attributes.licenseRequired && (
                  <Pill tone="primary">
                    {t('licence-required', 'Licence required')}
                  </Pill>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
};

export default JobTemplatePicker;
