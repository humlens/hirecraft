import classNames from 'classnames';
import React from 'react';

/** Pill-style single choice: date ranges, billing interval, work mode. */
export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  label,
  variant = 'boxed',
}: {
  options: { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  /** `boxed`: tabs in a grey tray; `pills`: separate outlined buttons */
  variant?: 'boxed' | 'pills';
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={classNames(
        'flex text-sm',
        variant === 'boxed'
          ? 'rounded-xl bg-base-300/50 p-1'
          : 'flex-wrap gap-2'
      )}
    >
      {options.map((o) => {
        const on = o.value === value;

        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={classNames(
              variant === 'boxed'
                ? classNames(
                    'rounded-lg px-4 py-2',
                    on ? 'bg-base-100 font-semibold shadow' : 'opacity-70'
                  )
                : classNames(
                    'min-h-10 rounded-lg border px-3',
                    on
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-base-300 hover:bg-base-200'
                  )
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default SegmentedControl;
