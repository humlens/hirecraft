import classNames from 'classnames';
import React from 'react';

export type PillTone =
  'neutral' | 'primary' | 'secondary' | 'success' | 'warning' | 'error';

const TONE: Record<PillTone, string> = {
  neutral: 'bg-base-200',
  primary: 'bg-primary/10 text-primary',
  secondary: 'bg-secondary/10 text-secondary',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/20 text-warning-content',
  error: 'bg-error/15 text-error',
};

/** Small rounded label: statuses, scores, tags. */
export const Pill = ({
  tone = 'neutral',
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: PillTone }) => (
  <span
    className={classNames(
      'inline-flex items-center rounded-full px-2.5 py-1 text-xs',
      TONE[tone],
      className
    )}
    {...rest}
  >
    {children}
  </span>
);

/** Filter chip: removable ("React ×") or a toggle when `selected` is given. */
export const Chip = ({
  onRemove,
  removeLabel,
  tone = 'secondary',
  children,
}: {
  onRemove?: () => void;
  removeLabel?: string;
  tone?: PillTone;
  children: React.ReactNode;
}) =>
  onRemove ? (
    <button
      type="button"
      aria-label={removeLabel}
      onClick={onRemove}
      className={classNames(
        'rounded-full border px-3 py-1 text-sm',
        tone === 'secondary'
          ? 'border-secondary/30 bg-secondary/10 text-secondary'
          : 'border-primary/30 bg-primary/10 text-primary'
      )}
    >
      {children} {'×'}
    </button>
  ) : (
    <Pill tone={tone} className="text-sm">
      {children}
    </Pill>
  );

export default Pill;
