import classNames from 'classnames';
import React from 'react';

/** Step pills: done = green with a check, current = filled, later = outlined. */
export const Stepper = ({
  steps,
  current,
  color,
  label,
}: {
  steps: { label: React.ReactNode; done?: boolean }[];
  current: number;
  /** fill colour of the current step (a portal's brand colour) */
  color?: string;
  label: string;
}) => (
  <ol aria-label={label} className="flex flex-wrap gap-2 text-sm">
    {steps.map((s, i) => (
      <li
        key={i}
        aria-current={i === current ? 'step' : undefined}
        className={classNames(
          'rounded-full px-3 py-1',
          i === current
            ? classNames('font-semibold text-white', !color && 'bg-primary')
            : s.done
              ? 'bg-success/15 text-success'
              : 'border opacity-60'
        )}
        style={i === current && color ? { backgroundColor: color } : undefined}
      >
        {s.done && i !== current ? '✓ ' : ''}
        {s.label}
      </li>
    ))}
  </ol>
);

export default Stepper;
