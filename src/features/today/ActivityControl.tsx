import { useState } from 'react';
import type { ISODate } from '../../domain/types';
import { fmt } from '../../lib/format';
import { setActivity } from '../../store/actions';
import { useAppState } from '../../store/store';
import { isNumberFree } from '../../domain/numberFree';
import { Button } from '../../components/ui/Button';
import { Field, parseNumber } from '../../components/ui/Controls';
import { Sheet } from '../../components/ui/Sheet';
import styles from './today.module.css';

/**
 * Activity of the day (active kcal, steps) – shown only when there is data.
 * Entered by hand for now; the model has a source field for a health data
 * connection later. Active calories are NOT added to the target: the target
 * already includes everyday activity, and "eating back" estimates is not
 * recommended.
 */
export function ActivityControl({ date }: { date: ISODate }) {
  const state = useAppState();
  const numberFree = isNumberFree(state);
  const a = state.activity?.[date];
  const [open, setOpen] = useState(false);
  const [kcal, setKcal] = useState('');
  const [steps, setSteps] = useState('');
  const start = () => {
    setKcal(a?.activeKcal ? String(a.activeKcal) : '');
    setSteps(a?.steps ? String(a.steps) : '');
    setOpen(true);
  };
  const k = kcal.trim() ? parseNumber(kcal) : undefined;
  const s = steps.trim() ? parseNumber(steps) : undefined;
  const valid = (k === undefined || (Number.isFinite(k) && k >= 0 && k <= 5000)) && (s === undefined || (Number.isFinite(s) && s >= 0 && s <= 100000));

  return (
    <>
      <button type="button" className={styles.activityRow} onClick={start} aria-label={a ? `Aktivität heute: ${[a.activeKcal && !numberFree ? fmt.kcal(a.activeKcal) : '', a.steps ? `${fmt.int(a.steps)} Schritte` : ''].filter(Boolean).join(', ')} – bearbeiten` : 'Aktivität eintragen'}>
        <span aria-hidden>🔥</span>
        {a ? (
          <span>
            <strong>Aktivität</strong> {[a.activeKcal ? (numberFree ? 'eingetragen' : fmt.kcal(a.activeKcal)) : undefined, a.steps ? `${fmt.int(a.steps)} Schritte` : undefined].filter(Boolean).join(' · ')}
          </span>
        ) : (
          <span className={styles.muted}>Aktivität eintragen (optional)</span>
        )}
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Aktivität heute"
        subtitle="Aus deiner Uhr oder App übernehmen – oder leer lassen."
        footer={
          <Button
            block
            disabled={!valid}
            onClick={() => {
              setActivity(date, { activeKcal: k, steps: s });
              setOpen(false);
            }}
          >
            Speichern
          </Button>
        }
      >
        <div className={styles.activityForm}>
          <Field label="Aktive Kalorien" inputMode="numeric" suffix="kcal" value={kcal} onChange={(e) => setKcal(e.target.value.replace(/[^\d]/g, ''))} error={k !== undefined && !(k <= 5000) ? 'Bitte höchstens 5000 kcal.' : undefined} />
          <Field label="Schritte" inputMode="numeric" value={steps} onChange={(e) => setSteps(e.target.value.replace(/[^\d]/g, ''))} error={s !== undefined && !(s <= 100000) ? 'Bitte höchstens 100000 Schritte.' : undefined} />
          <p className={styles.muted}>Aktive Kalorien werden nicht automatisch zu deinem Tagesziel addiert – dein Ziel enthält deine Alltagsaktivität bereits, und Schätzungen von Uhren sind oft ungenau.</p>
        </div>
      </Sheet>
    </>
  );
}
