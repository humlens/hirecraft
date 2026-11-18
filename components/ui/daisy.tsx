import classNames from 'classnames';
import React from 'react';

/**
 * Thin daisyUI 5 components with the prop names the app already used from
 * react-daisyui (which only supports daisyUI 4). They only add daisyUI classes.
 */
type Color =
  | 'neutral'
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'info'
  | 'success'
  | 'warning'
  | 'error';
type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const color = (prefix: string, c?: string) => (c ? `${prefix}-${c}` : '');
const size = (prefix: string, s?: string) => (s ? `${prefix}-${s}` : '');

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  color?: Color | 'ghost';
  size?: Size;
  variant?: 'outline' | 'link';
  shape?: 'circle' | 'square';
  active?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  wide?: boolean;
  startIcon?: React.ReactNode;
  endIcon?: React.ReactNode;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      color: c,
      size: s,
      variant,
      shape,
      active,
      loading,
      fullWidth,
      wide,
      startIcon,
      endIcon,
      className,
      children,
      disabled,
      type,
      ...rest
    },
    ref
  ) {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled}
        className={classNames(
          'btn',
          color('btn', c),
          size('btn', s),
          variant && `btn-${variant}`,
          shape && `btn-${shape}`,
          active && 'btn-active',
          fullWidth && 'w-full',
          wide && 'btn-wide',
          className
        )}
        {...rest}
      >
        {loading && (
          <span className="loading loading-spinner" aria-hidden="true" />
        )}
        {!loading && startIcon}
        {children as React.ReactNode}
        {endIcon}
      </button>
    );
  }
);

export type InputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'size' | 'color'
> & {
  color?: Color | 'ghost';
  size?: Size;
  /** kept for source compatibility: daisyUI 5 inputs always have a border */
  bordered?: boolean;
};

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    { color: c, size: s, bordered, className, ...rest },
    ref
  ) {
    return (
      <input
        ref={ref}
        className={classNames(
          'input',
          color('input', c),
          size('input', s),
          className
        )}
        {...rest}
      />
    );
  }
);

export const Checkbox = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'color'> & {
    color?: Color;
    size?: Size;
  }
>(function Checkbox({ color: c, size: s, className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      type="checkbox"
      className={classNames(
        'checkbox',
        color('checkbox', c),
        size('checkbox', s),
        className
      )}
      {...rest}
    />
  );
});

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  color?: Color | 'ghost';
  size?: Size;
  variant?: 'outline';
};

export const Badge = ({
  color: c,
  size: s,
  variant,
  className,
  children,
  ...rest
}: BadgeProps) => (
  <span
    className={classNames(
      'badge',
      color('badge', c),
      size('badge', s),
      variant && `badge-${variant}`,
      className
    )}
    {...rest}
  >
    {children}
  </span>
);

export type AlertProps = React.HTMLAttributes<HTMLDivElement> & {
  status?: 'info' | 'success' | 'warning' | 'error';
  icon?: React.ReactNode;
};

export const Alert = ({
  status,
  icon,
  className,
  children,
  ...rest
}: AlertProps) => (
  <div
    role="alert"
    className={classNames('alert', status && `alert-${status}`, className)}
    {...rest}
  >
    {icon}
    {children as React.ReactNode}
  </div>
);

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  bordered?: boolean;
  compact?: boolean;
};

export const Card = ({
  bordered,
  compact,
  className,
  children,
  ...rest
}: CardProps) => (
  <div
    className={classNames(
      'card',
      bordered && 'card-border',
      compact && 'card-sm',
      className
    )}
    {...rest}
  >
    {children}
  </div>
);

const CardBody = ({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={classNames('card-body', className)} {...rest}>
    {children}
  </div>
);

const CardTitle = ({
  tag: Tag = 'h2',
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLElement> & { tag?: React.ElementType }) => (
  <Tag className={classNames('card-title', className)} {...rest}>
    {children}
  </Tag>
);

const CardActions = ({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={classNames('card-actions', className)} {...rest}>
    {children}
  </div>
);

/** daisyUI 5 modal: a box inside a `modal` wrapper that is shown with `modal-open`. */
export const Modal = ({
  open,
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { open?: boolean }) => (
  <div
    role="dialog"
    aria-modal="true"
    aria-label="Modal"
    className={classNames('modal', open && 'modal-open')}
    {...rest}
  >
    <div className={classNames('modal-box', className)}>{children}</div>
  </div>
);

Card.Body = CardBody;
Card.Title = CardTitle;
Card.Actions = CardActions;
