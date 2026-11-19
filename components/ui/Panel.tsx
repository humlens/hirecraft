import classNames from 'classnames';
import React from 'react';

type Pad = 'none' | 'sm' | 'md' | 'lg';
const PAD: Record<Pad, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
};

export type PanelProps = Omit<
  React.HTMLAttributes<HTMLElement>,
  'title' | 'children'
> & {
  /** element to render; sections by default */
  as?: 'section' | 'div' | 'article' | 'aside' | 'li' | 'fieldset' | 'form';
  pad?: Pad;
  /** heading rendered at the top, with optional `actions` on the right */
  title?: React.ReactNode;
  actions?: React.ReactNode;
  /** highlight: the selected card in a list, the current plan */
  selected?: boolean;
  children?: React.ReactNode;
};

/** The rounded white card every screen is built from. */
export const Panel = ({
  as: Tag = 'section',
  pad = 'md',
  title,
  actions,
  selected,
  className,
  children,
  ...rest
}: PanelProps) => (
  <Tag
    className={classNames(
      'rounded-2xl border bg-base-100',
      PAD[pad],
      selected && 'border-2 border-primary',
      className
    )}
    {...rest}
  >
    {(title || actions) && (
      <div className="mb-3 flex items-center justify-between gap-2">
        {title && (
          <h3 className="font-display text-lg font-semibold">{title}</h3>
        )}
        {actions}
      </div>
    )}
    {children}
  </Tag>
);

export default Panel;
