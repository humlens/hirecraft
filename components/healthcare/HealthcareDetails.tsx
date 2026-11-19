import { Notice, Pill } from '@/components/ui';
import { SHIFT_LABELS, type JobAttributes } from '@/lib/industryTemplates';
import { useTranslation } from 'next-i18next';

/** True when a job carries any healthcare fact worth showing. */
export const hasHealthcare = (a?: JobAttributes | null) =>
  !!a &&
  !!(
    a.specialty ||
    a.shift ||
    a.licenseRequired ||
    a.onCall ||
    a.certifications?.length
  );

/** Public view of a healthcare job's facts: pills plus a registration note. */
const HealthcareDetails = ({ attributes }: { attributes: JobAttributes }) => {
  const { t } = useTranslation('common');

  if (!hasHealthcare(attributes)) return null;

  return (
    <section
      aria-label={t('healthcare-details', 'Healthcare details')}
      className="mt-5 space-y-2 rounded-xl border p-4"
    >
      <h3 className="font-display font-semibold">
        {t('role-details', 'Role details')}
      </h3>
      <div className="flex flex-wrap gap-2">
        {attributes.specialty && (
          <Pill tone="secondary">{attributes.specialty}</Pill>
        )}
        {attributes.shift && <Pill>{SHIFT_LABELS[attributes.shift]}</Pill>}
        {attributes.onCall && <Pill>{t('on-call', 'On-call duties')}</Pill>}
        {(attributes.certifications ?? []).map((c) => (
          <Pill key={c} tone="primary">
            {c}
          </Pill>
        ))}
      </div>
      {attributes.licenseRequired && (
        <Notice tone="muted">
          {t(
            'licence-public-note',
            'Current registration with {{body}} is required. We verify it before any offer.',
            {
              body:
                attributes.licenseBody ||
                t('licence-the-body', 'the relevant council'),
            }
          )}
        </Notice>
      )}
    </section>
  );
};

export default HealthcareDetails;
