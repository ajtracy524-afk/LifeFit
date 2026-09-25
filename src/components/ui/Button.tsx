import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import styles from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'sm' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  block?: boolean;
  children?: ReactNode;
}

export function Button({ variant = 'primary', size = 'md', icon, block, className, children, type = 'button', ...rest }: ButtonProps) {
  const classes = [styles.button, styles[variant], styles[size], block && styles.block, !children && styles.iconOnly, className]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={classes} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 18 : 20} />}
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  tone?: 'default' | 'accent';
}

export function IconButton({ icon, label, tone = 'default', className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button type={type} aria-label={label} title={label} className={[styles.iconButton, tone === 'accent' && styles.iconAccent, className].filter(Boolean).join(' ')} {...rest}>
      <Icon name={icon} size={20} />
    </button>
  );
}
