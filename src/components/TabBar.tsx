import { href, type Tab } from '../lib/router';
import { Icon, type IconName } from './ui/Icon';
import styles from './TabBar.module.css';

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'today', label: 'Heute', icon: 'home' },
  { id: 'nutrition', label: 'Ernährung', icon: 'food' },
  { id: 'training', label: 'Training', icon: 'dumbbell' },
  { id: 'shopping', label: 'Einkauf', icon: 'cart' },
  { id: 'progress', label: 'Fortschritt', icon: 'chart' },
];

interface TabBarProps {
  active: Tab | null;
  badges?: Partial<Record<Tab, number>>;
}

export function TabBar({ active, badges = {} }: TabBarProps) {
  return (
    <nav className={styles.bar} aria-label="Hauptnavigation">
      {TABS.map((t) => {
        const badge = badges[t.id];
        return (
          <a key={t.id} href={href(t.id)} className={t.id === active ? styles.active : styles.tab} aria-current={t.id === active ? 'page' : undefined}>
            <span className={styles.iconWrap}>
              <Icon name={t.icon} size={24} strokeWidth={t.id === active ? 2.1 : 1.8} />
              {!!badge && <span className={styles.badge}>{badge > 99 ? '99+' : badge}</span>}
            </span>
            <span className={styles.label}>{t.label}</span>
          </a>
        );
      })}
    </nav>
  );
}
