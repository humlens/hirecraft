import React from 'react';

/** Page title with subtitle, an optional line above (breadcrumb) and actions on the right. */
export const PageHeader = ({
  title,
  subtitle,
  eyebrow,
  actions,
  as: Tag = 'h2',
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  as?: 'h1' | 'h2';
}) => (
  <div className="flex flex-wrap items-start gap-3">
    <div className="mr-auto min-w-0">
      {eyebrow && <p className="text-sm opacity-70">{eyebrow}</p>}
      <Tag className="font-display text-3xl font-bold">{title}</Tag>
      {subtitle && <p className="text-sm opacity-70">{subtitle}</p>}
    </div>
    {actions && (
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    )}
  </div>
);

export default PageHeader;
