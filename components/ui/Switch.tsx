import classNames from 'classnames';
import React from 'react';

/** On/off toggle. Keeps a checkbox underneath, so labels and keyboard work. */
export const Switch = ({
  label,
  size,
  className,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> & {
  /** accessible name */
  label: string;
  size?: 'sm';
}) => (
  <input
    type="checkbox"
    role="switch"
    aria-label={label}
    className={classNames(
      'toggle toggle-primary',
      size === 'sm' && 'toggle-sm',
      className
    )}
    {...rest}
  />
);

export default Switch;
