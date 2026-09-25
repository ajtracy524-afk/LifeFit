import type { HTMLAttributes, ReactNode } from 'react';
import { Icon } from './Icon';
import styles from './Card.module.css';

interface CardProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  as?: 'section' | 'div' | 'article';
  padded?: boolean;
  tone?: 'default' | 'accent';
}

export function Card({ children, as: Tag = 'section', padded = true, tone = 'default', className, ...rest }: CardProps) {
  return (
    <Tag className={[styles.card, padded && styles.padded, tone === 'accent' && styles.accent, className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </Tag>
  );
}

interface CardHeaderProps {
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
}

export function CardHeader({ title, meta, action }: CardHeaderProps) {
  return (
    <header className={styles.header}>
      <h2 className={styles.title}>{title}</h2>
      {meta && <span className={styles.meta}>{meta}</span>}
      {action}
    </header>
  );
}

interface LinkRowProps {
  href: string;
  icon?: ReactNode;
  children: ReactNode;
}

/** A compact, fully tappable card row that navigates somewhere. */
export function LinkCard({ href, icon, children }: LinkRowProps) {
  return (
    <a href={href} className={`${styles.card} ${styles.link}`}>
      {icon && <span className={styles.linkIcon}>{icon}</span>}
      <span className={styles.linkBody}>{children}</span>
      <Icon name="chevronRight" size={18} className={styles.chevron} />
    </a>
  );
}
