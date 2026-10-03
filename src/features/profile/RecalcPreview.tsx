import type { RecalcPreview as Preview } from '../../domain/onboarding/recalc';
import styles from './profile.module.css';

/** "Vorher → Nachher" of the daily target – shown before anything is saved (Prompt 9). */
export function RecalcPreview({ preview }: { preview: Preview }) {
  return (
    <div className={styles.preview} aria-label="Vorher und Nachher">
      <p className={styles.label}>Neue Tagesziele ab heute</p>
      {preview.lines.map((line) => (
        <p key={line} className={styles.previewLine}>
          {line}
        </p>
      ))}
    </div>
  );
}
