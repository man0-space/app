import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Tooltip } from './tooltip';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label?: string;
  description?: string;
  icon?: ReactNode;
  active?: boolean;
  variant?: 'ghost' | 'primary' | 'secondary' | 'accent' | 'danger';
  size?: 'xs' | 'sm' | 'md';
  tooltip?: boolean | string;
  children?: ReactNode;
}

export function Button({
  label,
  description,
  icon,
  active,
  variant = 'ghost',
  size = 'md',
  tooltip = true,
  className,
  children,
  ...props
}: ButtonProps) {
  const hasChildren = children !== undefined && children !== null && children !== false;
  const resolvedLabel = typeof tooltip === 'string' ? tooltip : label ?? '';
  const classes = [
    hasChildren ? 'btn' : 'icon-btn',
    `btn-${variant}`,
    `btn-${size}`,
    active ? 'is-active' : '',
    className || '',
  ]
    .filter(Boolean)
    .join(' ');

  const node = (
    <button
      type="button"
      aria-label={hasChildren ? label || undefined : resolvedLabel || undefined}
      aria-pressed={active}
      className={classes}
      {...props}
    >
      {icon}
      {children}
    </button>
  );

  if (!tooltip || !resolvedLabel) return node;
  return (
    <Tooltip label={resolvedLabel} description={description}>
      {node}
    </Tooltip>
  );
}
