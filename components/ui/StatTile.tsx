import classNames from 'classnames';
import React from 'react';

/** A labelled number. `large` is the big KPI tile, the default is the compact strip tile. */
export const StatTile = ({
  label,
  value,
  hint,
  large,
  tone,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  large?: boolean;
  tone?: 'error' | 'success';
}) => (
  <div
    className={classNames(
      'border bg-base-100',
      large ? 'rounded-2xl p-5' : 'rounded-xl px-4 py-2'
    )}
  >
    <div className={large ? 'text-sm opacity-70' : 'text-xs opacity-60'}>
      {label}
    </div>
    <div
      className={classNames(
        large ? 'font-display text-4xl font-bold' : 'text-xl font-semibold',
        tone === 'error' && 'text-error',
        tone === 'success' && 'text-success'
      )}
    >
      {value}
    </div>
    {hint && <div className="text-sm opacity-70">{hint}</div>}
  </div>
);

export default StatTile;
