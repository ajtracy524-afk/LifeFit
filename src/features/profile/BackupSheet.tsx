import { useRef, useState, type ReactNode } from 'react';
import type { AppState } from '../../domain/types';
import { formatDateLong } from '../../lib/format';
import { showToast } from '../../lib/toast';
import { withUndo } from '../../lib/undo';
import { importBackup } from '../../store/actions';
import { parseBackup } from '../../store/persistence';
import { Button } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import styles from './profile.module.css';

interface Pending {
  state: AppState;
  exportedAt?: string;
}

/**
 * "Sicherung einspielen": picks an export file, shows what it contains and
 * replaces the data only after confirming – with "Rückgängig" in the toast.
 */
export function BackupImport({ children }: { children: (pick: () => void) => ReactNode }) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const read = async (file: File | undefined) => {
    if (!file) return;
    const result = parseBackup(await file.text());
    if (!result.ok) return void showToast(result.reason, { tone: 'error' });
    setPending({ state: result.state, ...(result.exportedAt ? { exportedAt: result.exportedAt } : {}) });
  };

  const apply = () => {
    if (!pending) return;
    withUndo('Sicherung eingespielt', () => importBackup(pending.state));
    setPending(null);
  };

  const s = pending?.state;
  return (
    <>
      {children(() => input.current?.click())}
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        aria-label="Sicherungsdatei wählen"
        onChange={(e) => {
          void read(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <Sheet open={!!pending} onClose={() => setPending(null)} title="Sicherung einspielen?" subtitle="Deine aktuellen Daten werden durch die Sicherung ersetzt.">
        {s && (
          <div className={styles.form}>
            <ul className={styles.backupFacts} aria-label="Inhalt der Sicherung">
              {pending.exportedAt && <li>Erstellt am {formatDateLong(pending.exportedAt.slice(0, 10))}</li>}
              <li>{s.logEntries.length} erfasste Einträge</li>
              <li>{s.plannedMeals.length} geplante Mahlzeiten</li>
              <li>{s.workouts.length} Trainings</li>
              <li>{s.weights.length} Gewichtseinträge</li>
            </ul>
            <p className={styles.muted}>Danach kannst du es im Hinweis unten noch rückgängig machen.</p>
            <Button block size="lg" onClick={apply}>
              Einspielen
            </Button>
          </div>
        )}
      </Sheet>
    </>
  );
}
