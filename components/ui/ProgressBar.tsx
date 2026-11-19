import classNames from 'classnames';
import React from 'react';

/** Labelled progress. Turns amber from 80 % when `warnAt` is on. */
export const ProgressBar = ({
  value,
  max = 100,
  label,
  valueLabel,
  tone = 'primary',
  warnAt = 80,
}: {
  value: number;
  max?: number;
  label: string;
  valueLabel?: React.ReactNode;
  tone?: 'primary' | 'secondary';
  warnAt?: number | false;
}) => {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  const color =
    warnAt !== false && pct >= warnAt
      ? 'progress-warning'
      : tone === 'secondary'
        ? 'progress-secondary'
        : 'progress-primary';

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        {valueLabel != null && <strong>{valueLabel}</strong>}
      </div>
      <progress
        className={classNames('progress w-full', color)}
        value={pct}
        max={100}
        aria-label={label}
      />
    </div>
  );
};

export default ProgressBar;
