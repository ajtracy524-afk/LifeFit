import { useMemo, useState, type ReactNode } from 'react';
import { DIFFICULTY_LABEL, EQUIPMENT_LABEL, filterExercises, MUSCLE_FILTERS, TYPE_LABEL, type ExerciseFilter } from '../../domain/exerciseLibrary';
import type { Difficulty, Equipment, Exercise, ExerciseType } from '../../domain/types';
import { navigate } from '../../lib/router';
import { Screen } from '../../components/Screen';
import { IconButton } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Controls';
import { EmptyState } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/Icon';
import { Sheet } from '../../components/ui/Sheet';
import { BodyMap } from './BodyMap';
import { ExerciseSheet } from './ExerciseSheet';
import styles from './library.module.css';

/** The library as its own screen: find an exercise, open it. */
export function ExerciseLibraryScreen() {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Screen title="Übungen" eyebrow="Training" actions={<IconButton icon="close" label="Zurück zum Training" onClick={() => navigate('training')} />}>
      <ExerciseBrowser onSelect={(e) => setOpen(e.id)} />
      <ExerciseSheet exerciseId={open} onClose={() => setOpen(null)} />
    </Screen>
  );
}

interface PickerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  onPick: (exerciseId: string) => void;
  /** Shown above the library (e.g. the alternatives when replacing). */
  top?: ReactNode;
}

/** The same library in a sheet – to add or replace an exercise (session, routine editor). */
export function ExercisePicker({ open, title, onClose, onPick, top }: PickerProps) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {top}
      <ExerciseBrowser compact onSelect={(e) => onPick(e.id)} />
    </Sheet>
  );
}

const EQUIPMENT: Equipment[] = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'kettlebell', 'band', 'cardio_machine'];
const DIFFICULTY: Difficulty[] = ['beginner', 'intermediate', 'advanced'];
const TYPES: ExerciseType[] = ['strength', 'cardio', 'mobility'];

/** Search + muscle chips first (the fast way), equipment / level / type behind "Filter". */
export function ExerciseBrowser({ onSelect, compact }: { onSelect: (e: Exercise) => void; compact?: boolean }) {
  const [filter, setFilter] = useState<ExerciseFilter>({});
  const [more, setMore] = useState(false);
  const list = useMemo(() => filterExercises(filter), [filter]);
  const set = <K extends keyof ExerciseFilter>(k: K, v: ExerciseFilter[K]) => setFilter((f) => ({ ...f, [k]: f[k] === v ? undefined : v }));
  const extra = [filter.equipment, filter.difficulty, filter.type].filter(Boolean).length;

  return (
    <div className={styles.browser}>
      <label className={styles.search}>
        <Icon name="search" size={18} />
        <input type="search" placeholder="Übung suchen" aria-label="Übung suchen" value={filter.query ?? ''} onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))} />
      </label>
      <div className={styles.chipRow} role="group" aria-label="Muskelgruppe">
        {MUSCLE_FILTERS.map((m) => (
          <Chip key={m.id} selected={filter.muscle === m.id} onClick={() => set('muscle', m.id)}>
            {m.label}
          </Chip>
        ))}
      </div>
      <button type="button" className={styles.filterToggle} aria-expanded={more} onClick={() => setMore((v) => !v)}>
        <Icon name="settings" size={16} /> Filter{extra ? ` · ${extra}` : ''}
        <Icon name="chevronDown" size={16} className={more ? styles.flip : undefined} />
      </button>
      {more && (
        <div className={styles.filters}>
          <FilterGroup label="Equipment" values={EQUIPMENT} labels={EQUIPMENT_LABEL} value={filter.equipment} onPick={(v) => set('equipment', v)} />
          <FilterGroup label="Schwierigkeit" values={DIFFICULTY} labels={DIFFICULTY_LABEL} value={filter.difficulty} onPick={(v) => set('difficulty', v)} />
          <FilterGroup label="Übungstyp" values={TYPES} labels={TYPE_LABEL} value={filter.type} onPick={(v) => set('type', v)} />
        </div>
      )}
      <p className={styles.count} aria-live="polite">
        {list.length} {list.length === 1 ? 'Übung' : 'Übungen'}
      </p>
      {list.length === 0 ? (
        <EmptyState compact emoji="🔎" title="Keine Übung gefunden" text="Weniger Filter wählen oder anders suchen." />
      ) : (
        <Card padded={false} className={compact ? styles.listCompact : undefined}>
          <ul className={styles.list}>
            {list.map((e) => (
              <li key={e.id}>
                <button type="button" className={styles.row} onClick={() => onSelect(e)}>
                  <BodyMap primary={e.primary} secondary={e.secondary} size="sm" />
                  <span className={styles.rowText}>
                    <strong>{e.name}</strong>
                    <span>
                      {e.muscle} · {EQUIPMENT_LABEL[e.equipment]}
                    </span>
                  </span>
                  <span className={styles.level} data-level={e.difficulty}>
                    {DIFFICULTY_LABEL[e.difficulty]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function FilterGroup<T extends string>({ label, values, labels, value, onPick }: { label: string; values: T[]; labels: Record<T, string>; value?: T; onPick: (v: T) => void }) {
  return (
    <div role="group" aria-label={label}>
      <p className={styles.filterLabel}>{label}</p>
      <div className={styles.chipWrap}>
        {values.map((v) => (
          <Chip key={v} selected={value === v} onClick={() => onPick(v)}>
            {labels[v]}
          </Chip>
        ))}
      </div>
    </div>
  );
}
