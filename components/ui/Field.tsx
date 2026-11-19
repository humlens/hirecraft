import React from 'react';

/** Label above a control, with an optional hint underneath. */
export const Field = ({
  label,
  hint,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <label className="block text-sm">
    <span className="mb-1 block font-semibold">{label}</span>
    {children}
    {hint && <span className="mt-1 block text-xs opacity-70">{hint}</span>}
  </label>
);

export default Field;
