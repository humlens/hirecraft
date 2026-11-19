import { INDUSTRY_TEMPLATES, type IndustryKey } from '@/lib/industryTemplates';
import { useTranslation } from 'next-i18next';

/** Card grid for choosing what kind of employer the portal is. */
const IndustryTemplatePicker = ({
  value,
  onChange,
}: {
  value: IndustryKey;
  onChange: (key: IndustryKey) => void;
}) => {
  const { t } = useTranslation('common');

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">
        {t('industry-template', 'Start from a template')}
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {INDUSTRY_TEMPLATES.map((tpl) => {
          const on = tpl.key === value;

          return (
            <button
              key={tpl.key}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(tpl.key)}
              className={`rounded-xl border p-3 text-left transition-colors ${
                on
                  ? 'border-2 border-primary bg-primary/5'
                  : 'hover:bg-base-200'
              }`}
            >
              <span className="flex items-center gap-2 font-display font-semibold">
                <span
                  aria-hidden
                  className="inline-block h-3 w-3 rounded-full"
                  style={{ background: tpl.primaryColor }}
                />
                {tpl.label}
              </span>
              <span className="mt-1 block text-sm opacity-70">
                {tpl.tagline}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
};

export default IndustryTemplatePicker;
