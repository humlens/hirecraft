import { Field, Panel, Pill, SegmentedControl, Switch } from '@/components/ui';
import {
  CERTIFICATIONS,
  SHIFTS,
  SHIFT_LABELS,
  SPECIALTIES,
  type JobAttributes,
  type Shift,
} from '@/lib/industryTemplates';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

export const ShiftPicker = ({
  value,
  onChange,
}: {
  value?: Shift;
  onChange: (s: Shift | undefined) => void;
}) => {
  const { t } = useTranslation('common');

  return (
    <SegmentedControl
      variant="pills"
      label={t('shift', 'Shift')}
      value={value ?? 'DAY'}
      onChange={(v) => onChange(v)}
      options={SHIFTS.map((s) => ({ value: s, label: SHIFT_LABELS[s] }))}
    />
  );
};

export const CertificationPicker = ({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) => {
  const { t } = useTranslation('common');
  const [custom, setCustom] = useState('');
  const all = Array.from(new Set([...CERTIFICATIONS, ...value]));
  const toggle = (c: string) =>
    onChange(value.includes(c) ? value.filter((x) => x !== c) : [...value, c]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {all.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={value.includes(c)}
            onClick={() => toggle(c)}
            className={`rounded-full border px-3 py-1 text-sm ${
              value.includes(c)
                ? 'border-primary bg-primary/10 text-primary'
                : 'hover:bg-base-200'
            }`}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className="input input-sm"
          aria-label={t('add-certification', 'Add certification')}
          placeholder={t('add-certification', 'Add certification')}
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-sm"
          disabled={!custom.trim()}
          onClick={() => {
            if (!value.includes(custom.trim()))
              onChange([...value, custom.trim()]);

            setCustom('');
          }}
        >
          {t('add', 'Add')}
        </button>
      </div>
    </div>
  );
};

/** The editor panel for a healthcare job's structured facts. */
const HealthcareFields = ({
  value,
  onChange,
}: {
  value: JobAttributes;
  onChange: (v: JobAttributes) => void;
}) => {
  const { t } = useTranslation('common');
  const set = (patch: Partial<JobAttributes>) =>
    onChange({ ...value, ...patch });

  return (
    <Panel
      title={t('healthcare-details', 'Healthcare details')}
      actions={
        <Pill tone="secondary">{t('clinical-role', 'Clinical role')}</Pill>
      }
      className="space-y-4"
    >
      <Field label={t('specialty', 'Specialty')}>
        <select
          className="select w-full"
          aria-label={t('specialty', 'Specialty')}
          value={value.specialty ?? ''}
          onChange={(e) => set({ specialty: e.target.value || undefined })}
        >
          <option value="">{t('not-specified', 'Not specified')}</option>
          {SPECIALTIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Field>

      <div className="space-y-1">
        <span className="block text-sm font-semibold">
          {t('shift', 'Shift')}
        </span>
        <ShiftPicker value={value.shift} onChange={(shift) => set({ shift })} />
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-3 text-sm font-semibold">
          <Switch
            label={t('licence-required', 'Licence required')}
            checked={!!value.licenseRequired}
            onChange={(e) => set({ licenseRequired: e.target.checked })}
          />
          {t('licence-required', 'Licence required')}
        </label>
        {value.licenseRequired && (
          <Field
            label={t('licence-body', 'Registration body')}
            hint={t(
              'licence-hint',
              'Candidates are asked for their registration number and you verify it in the pipeline.'
            )}
          >
            <input
              className="input w-full"
              aria-label={t('licence-body', 'Registration body')}
              placeholder="Nursing council"
              value={value.licenseBody ?? ''}
              onChange={(e) => set({ licenseBody: e.target.value })}
            />
          </Field>
        )}
      </div>

      <div className="space-y-1">
        <span className="block text-sm font-semibold">
          {t('certifications', 'Certifications')}
        </span>
        <CertificationPicker
          value={value.certifications ?? []}
          onChange={(certifications) => set({ certifications })}
        />
      </div>

      <label className="flex items-center gap-3 text-sm font-semibold">
        <Switch
          label={t('on-call', 'On-call duties')}
          checked={!!value.onCall}
          onChange={(e) => set({ onCall: e.target.checked })}
        />
        {t('on-call', 'On-call duties')}
      </label>
    </Panel>
  );
};

export default HealthcareFields;
