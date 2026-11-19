import classNames from 'classnames';
import React from 'react';

const TONE = {
  info: 'bg-secondary/10 text-secondary',
  muted: 'bg-base-200',
  warning: 'border border-warning/50 bg-warning/10',
  error: 'border border-error/50 bg-error/10',
} as const;

/** A boxed note: AI hints, fairness notes, band checks, warnings. */
export const Notice = ({
  tone = 'info',
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLParagraphElement> & {
  tone?: keyof typeof TONE;
}) => (
  <p
    className={classNames('rounded-xl p-3 text-sm', TONE[tone], className)}
    {...rest}
  >
    {children}
  </p>
);

export default Notice;
