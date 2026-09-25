import { useState } from 'react';
import { addDays, today } from '../../domain/dates';
import { latestWeight } from '../../domain/progress';
import { showToast } from '../../lib/toast';
import { addWeight } from '../../store/actions';
import { useAppState } from '../../store/store';
import { Button } from '../../components/ui/Button';
import { Field, Segmented, parseNumber } from '../../components/ui/Controls';
import { Sheet } from '../../components/ui/Sheet';
import styles from './progress.module.css';

interface WeightSheetProps {
  open: boolean;
  onClose: () => void;
}

export function WeightSheet({ open, onClose }: WeightSheetProps) {
  const state = useAppState();
  return (
    <Sheet open={open} onClose={onClose} title="Gewicht eintragen" subtitle="Am besten morgens, nach dem Aufstehen">
      {open && <WeightForm initial={latestWeight(state.weights)?.kg} onDone={onClose} />}
    </Sheet>
  );
}

function WeightForm({ initial, onDone }: { initial?: number; onDone: () => void }) {
  const [value, setValue] = useState(initial ? String(initial).replace('.', ',') : '');
  const [day, setDay] = useState<'today' | 'yesterday'>('today');
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const kg = parseNumber(value);
    if (!Number.isFinite(kg) || kg < 30 || kg > 300) {
      setError('Bitte gib ein Gewicht zwischen 30 und 300 kg ein.');
      return;
    }
    addWeight(day === 'today' ? today() : addDays(today(), -1), kg);
    showToast('Gewicht gespeichert – dein Trend ist aktualisiert');
    onDone();
  };

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Segmented
        label="Tag"
        value={day}
        onChange={setDay}
        options={[
          { value: 'today', label: 'Heute' },
          { value: 'yesterday', label: 'Gestern' },
        ]}
      />
      <Field
        label="Gewicht"
        inputMode="decimal"
        suffix="kg"
        autoFocus
        value={value}
        error={error ?? undefined}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
      />
      <Button type="submit" block size="lg">
        Speichern
      </Button>
    </form>
  );
}
