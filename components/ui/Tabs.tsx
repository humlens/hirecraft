import classNames from 'classnames';
import React from 'react';

/** Underline tabs for switching views on one page. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="tablist" className="flex gap-2 overflow-x-auto border-b">
      {tabs.map((tb) => (
        <button
          key={tb.value}
          type="button"
          role="tab"
          aria-selected={tb.value === value}
          onClick={() => onChange(tb.value)}
          className={classNames(
            '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm',
            tb.value === value
              ? 'border-primary font-semibold text-primary'
              : 'border-transparent opacity-70'
          )}
        >
          {tb.label}
        </button>
      ))}
    </div>
  );
}

export default Tabs;
