import classNames from 'classnames';

export const initialsOf = (name: string) =>
  name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

/** Initials in a circle. */
export const Avatar = ({
  name,
  size = 'md',
  title,
}: {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  title?: string;
}) => (
  <span
    aria-hidden
    title={title}
    className={classNames(
      'flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-bold text-primary',
      size === 'sm' && 'h-8 w-8 text-xs',
      size === 'md' && 'h-10 w-10 text-sm',
      size === 'lg' && 'h-14 w-14 font-display text-lg'
    )}
  >
    {initialsOf(name)}
  </span>
);

export default Avatar;
