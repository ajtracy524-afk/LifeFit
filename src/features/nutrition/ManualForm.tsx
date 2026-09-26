import { useState } from 'react';
import { manualEntry, suggestCatalogFoods, type EntryContent, type ManualErrors, type ManualInput } from '../../domain/foodEntry';
import type { FoodUnit } from '../../domain/types';
import { newId } from '../../lib/id';
import { Button } from '../../components/ui/Button';
import { Chip, Field, Segmented } from '../../components/ui/Controls';
import styles from './nutrition.module.css';

interface Props {
  initial: ManualInput;
  /** `id` is fixed per form – submitting twice logs once. */
  onSubmit: (entry: EntryContent, id: string) => void;
  onBack?: () => void;
}

const UNITS: { value: FoodUnit; label: string }[] = [
  { value: 'g', label: 'g' },
  { value: 'ml', label: 'ml' },
  { value: 'portion', label: 'Portion' },
  { value: 'piece', label: 'Stück' },
];

/**
 * Manual entry: only calories are required. Everything else is optional and
 * stays unknown when left empty – LifeFit fills in nothing.
 */
export function ManualForm({ initial, onSubmit, onBack }: Props) {
  const [input, setInput] = useState<ManualInput>(initial);
  const [errors, setErrors] = useState<ManualErrors>({});
  const [more, setMore] = useState(!!(initial.fiber || initial.sugar || initial.salt));
  const [id] = useState(newId);
  const set = (patch: Partial<ManualInput>) => {
    setInput((i) => ({ ...i, ...patch }));
    setErrors({});
  };
  const measured = input.unit === 'g' || input.unit === 'ml';
  const suggestions = input.name.trim().length >= 3 ? suggestCatalogFoods(input.name) : [];

  const submit = () => {
    const result = manualEntry(input);
    if (!result.ok) setErrors(result.errors);
    else onSubmit(result.entry, id);
  };

  return (
    <form
      className={styles.quickForm}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field label="Name" placeholder="z. B. Käsebrötchen vom Bäcker" value={input.name} onChange={(e) => set({ name: e.target.value })} />
      {suggestions.length > 0 && (
        <div>
          <p className={styles.fieldLabel}>Entspricht in LifeFit (optional – für Vorrat & Vorlieben)</p>
          <div className={styles.chipRow}>
            {suggestions.map((f) => (
              <Chip key={f.id} selected={input.foodId === f.id} onClick={() => set({ foodId: input.foodId === f.id ? undefined : f.id })}>
                {f.name}
              </Chip>
            ))}
          </div>
        </div>
      )}
      <div className={styles.fieldRow}>
        <Field label="Menge" inputMode="decimal" placeholder="optional" value={input.amount} error={errors.amount} onChange={(e) => set({ amount: e.target.value })} />
        <div>
          <p className={styles.fieldLabel}>Einheit</p>
          <Segmented label="Einheit" value={input.unit} onChange={(unit) => set({ unit, per: unit === 'g' || unit === 'ml' ? input.per : 'amount' })} options={UNITS} />
        </div>
      </div>
      {measured && (
        <Segmented
          label="Werte gelten für"
          value={input.per}
          onChange={(per) => set({ per })}
          options={[
            { value: 'amount', label: 'Diese Menge' },
            { value: '100', label: `Pro 100 ${input.unit}` },
          ]}
        />
      )}
      <Field label="Kalorien" inputMode="decimal" suffix="kcal" value={input.kcal} error={errors.kcal} onChange={(e) => set({ kcal: e.target.value })} />
      <div className={styles.fieldRow3}>
        <Field label="Protein" inputMode="decimal" suffix="g" placeholder="–" value={input.protein} error={errors.protein} onChange={(e) => set({ protein: e.target.value })} />
        <Field label="Kohlenh." inputMode="decimal" suffix="g" placeholder="–" value={input.carbs} error={errors.carbs} onChange={(e) => set({ carbs: e.target.value })} />
        <Field label="Fett" inputMode="decimal" suffix="g" placeholder="–" value={input.fat} error={errors.fat} onChange={(e) => set({ fat: e.target.value })} />
      </div>
      {more ? (
        <div className={styles.fieldRow3}>
          <Field label="Ballaststoffe" inputMode="decimal" suffix="g" placeholder="–" value={input.fiber} error={errors.fiber} onChange={(e) => set({ fiber: e.target.value })} />
          <Field label="Zucker" inputMode="decimal" suffix="g" placeholder="–" value={input.sugar} error={errors.sugar} onChange={(e) => set({ sugar: e.target.value })} />
          <Field label="Salz" inputMode="decimal" suffix="g" placeholder="–" value={input.salt} error={errors.salt} onChange={(e) => set({ salt: e.target.value })} />
        </div>
      ) : (
        <button type="button" className={styles.moreToggle} onClick={() => setMore(true)}>
          + Ballaststoffe, Zucker, Salz
        </button>
      )}
      <p className={styles.sourceNote}>Nur Kalorien sind nötig. Leere Felder bleiben leer – LifeFit schätzt nichts dazu.</p>
      <div className={styles.confirmFooter}>
        {onBack && (
          <Button variant="secondary" onClick={onBack}>
            Zurück
          </Button>
        )}
        <Button type="submit" block icon="plus">
          Hinzufügen
        </Button>
      </div>
    </form>
  );
}
