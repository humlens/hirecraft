import React from 'react';

/** Circular percentage, e.g. the AI match score. */
export const RadialScore = ({
  value,
  size = '6rem',
}: {
  value: number;
  size?: string;
}) => (
  <div
    className="radial-progress text-primary"
    style={{ '--value': value, '--size': size } as React.CSSProperties}
    role="img"
    aria-label={`${value}%`}
  >
    <span className="text-xl font-bold">{value}%</span>
  </div>
);

export default RadialScore;
