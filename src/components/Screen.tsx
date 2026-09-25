import type { ReactNode } from 'react';
import styles from './Screen.module.css';

interface ScreenProps {
  title?: string;
  eyebrow?: string;
  actions?: ReactNode;
  children: ReactNode;
  /** Extra toolbar under the title (segmented controls, date switchers). */
  toolbar?: ReactNode;
}

/** Common layout for tab screens: large title, optional toolbar, stacked content. */
export function Screen({ title, eyebrow, actions, toolbar, children }: ScreenProps) {
  return (
    <main className={styles.screen}>
      {(title || actions) && (
        <header className={styles.header}>
          <div className={styles.titles}>
            {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
            {title && <h1 className={styles.title}>{title}</h1>}
          </div>
          {actions && <div className={styles.actions}>{actions}</div>}
        </header>
      )}
      {toolbar && <div className={styles.toolbar}>{toolbar}</div>}
      <div className={styles.content}>{children}</div>
    </main>
  );
}

export function Section({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.section}>
      {(title || action) && (
        <div className={styles.sectionHeader}>
          {title && <h2 className={styles.sectionTitle}>{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
