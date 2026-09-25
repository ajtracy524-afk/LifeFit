import type { ReactNode } from 'react';
import { dismissToast, useToasts } from '../../lib/toast';
import { Icon, type IconName } from './Icon';
import styles from './Feedback.module.css';

interface EmptyStateProps {
  icon?: IconName;
  emoji?: string;
  title: string;
  text?: string;
  action?: ReactNode;
  compact?: boolean;
}

/** Always: one explaining sentence and one primary action. */
export function EmptyState({ icon, emoji, title, text, action, compact }: EmptyStateProps) {
  return (
    <div className={compact ? styles.emptyCompact : styles.empty}>
      {(icon || emoji) && <div className={styles.emptyIcon}>{emoji ?? (icon && <Icon name={icon} size={26} />)}</div>}
      <p className={styles.emptyTitle}>{title}</p>
      {text && <p className={styles.emptyText}>{text}</p>}
      {action && <div className={styles.emptyAction}>{action}</div>}
    </div>
  );
}

interface BannerProps {
  tone?: 'info' | 'warning' | 'error';
  children: ReactNode;
  action?: ReactNode;
}

export function Banner({ tone = 'info', children, action }: BannerProps) {
  return (
    <div className={`${styles.banner} ${styles[tone]}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name="info" size={18} />
      <div className={styles.bannerText}>{children}</div>
      {action}
    </div>
  );
}

export function ToastHost() {
  const toasts = useToasts();
  return (
    <div className={styles.toastHost} aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={t.tone === 'error' ? `${styles.toast} ${styles.toastError}` : styles.toast}>
          <span className={styles.toastText}>{t.message}</span>
          {t.action && (
            <button
              type="button"
              className={styles.toastAction}
              onClick={() => {
                t.action!.onClick();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
