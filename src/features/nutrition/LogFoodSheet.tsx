import { useMemo, useState } from 'react';
import { FOODS, getFood } from '../../data/foods';
import { foodAllowed, foodMacros } from '../../domain/nutrition';
import type { Food, ISODate, MealSlot } from '../../domain/types';
import { fmt, relativeDay, SLOT_LABEL } from '../../lib/format';
import { showToast } from '../../lib/toast';
import { logFood, logQuick } from '../../store/actions';
import { useAppState } from '../../store/store';
import { Button } from '../../components/ui/Button';
import { Field, Segmented, Stepper, parseNumber } from '../../components/ui/Controls';
import { EmptyState } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/Icon';
import { Sheet } from '../../components/ui/Sheet';
import styles from './nutrition.module.css';

export interface LogTarget {
  date: ISODate;
  slot: MealSlot;
}

interface LogFoodSheetProps {
  target: LogTarget | null;
  onClose: () => void;
}

type Mode = 'search' | 'quick';

/** Logging of anything not in the plan: food search or a quick calorie entry. */
export function LogFoodSheet({ target, onClose }: LogFoodSheetProps) {
  const state = useAppState();
  const [mode, setMode] = useState<Mode>('search');
  const [slot, setSlot] = useState<MealSlot | null>(null);
  const [query, setQuery] = useState('');
  const [food, setFood] = useState<Food | null>(null);
  const [amount, setAmount] = useState(100);
  const [quick, setQuick] = useState({ name: '', kcal: '', protein: '' });
  const [quickError, setQuickError] = useState<string | null>(null);

  const close = () => {
    setMode('search');
    setSlot(null);
    setQuery('');
    setFood(null);
    setQuick({ name: '', kcal: '', protein: '' });
    setQuickError(null);
    onClose();
  };

  const recentFoodIds = useMemo(() => {
    const ids: string[] = [];
    for (const e of [...state.logEntries].reverse()) {
      if (e.foodId && !ids.includes(e.foodId)) ids.push(e.foodId);
      if (ids.length >= 6) break;
    }
    return ids;
  }, [state.logEntries]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recentFoodIds.map(getFood).filter((f): f is Food => !!f);
    return FOODS.filter((f) => f.name.toLowerCase().includes(q)).sort(
      (a, b) => Number(foodAllowed(b, state.nutritionProfile)) - Number(foodAllowed(a, state.nutritionProfile)),
    );
  }, [query, recentFoodIds, state.nutritionProfile]);

  if (!target) return <Sheet open={false} onClose={close} title="" children={null} />;

  const activeSlot = slot ?? target.slot;
  const slots = state.nutritionProfile?.slots ?? (['breakfast', 'snack', 'lunch', 'dinner'] as MealSlot[]);
  const slotPicker = (
    <Segmented label="Mahlzeit" value={activeSlot} onChange={setSlot} options={slots.map((s) => ({ value: s, label: SLOT_LABEL[s].replace('essen', '') }))} />
  );

  // ----- Amount step -----
  if (food) {
    const usesPieces = !!food.pieceG;
    const grams = usesPieces ? amount * food.pieceG! : amount;
    const m = foodMacros(food, grams);
    return (
      <Sheet
        open
        onClose={close}
        title={food.name}
        subtitle={`${SLOT_LABEL[activeSlot]} · ${relativeDay(target.date)}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setFood(null)}>
              Zurück
            </Button>
            <Button
              block
              icon="plus"
              onClick={() => {
                logFood(target.date, activeSlot, food.id, grams);
                showToast(`${food.name} erfasst`);
                close();
              }}
            >
              Hinzufügen
            </Button>
          </>
        }
      >
        <div className={styles.amountBlock}>
          <Stepper
            label="Menge"
            value={amount}
            onChange={setAmount}
            step={usesPieces ? 1 : 10}
            min={usesPieces ? 1 : 10}
            max={usesPieces ? 20 : 1500}
            format={(v) => (usesPieces ? `${v} ${food.pieceLabel}` : `${v} g`)}
          />
          {usesPieces && <p className={styles.muted}>≈ {fmt.g(grams)}</p>}
        </div>
        <div className={styles.macroGrid}>
          <MacroCell label="kcal" value={fmt.int(m.kcal)} strong />
          <MacroCell label="Protein" value={`${fmt.dec(m.protein)} g`} />
          <MacroCell label="Kohlenh." value={`${fmt.dec(m.carbs)} g`} />
          <MacroCell label="Fett" value={`${fmt.dec(m.fat)} g`} />
        </div>
      </Sheet>
    );
  }

  // ----- Search / quick -----
  const submitQuick = () => {
    const kcal = parseNumber(quick.kcal);
    const protein = quick.protein ? parseNumber(quick.protein) : 0;
    if (!Number.isFinite(kcal) || kcal <= 0 || kcal > 5000) {
      setQuickError('Bitte gib Kalorien zwischen 1 und 5000 ein.');
      return;
    }
    if (!Number.isFinite(protein) || protein < 0 || protein > 300) {
      setQuickError('Bitte prüfe den Proteinwert.');
      return;
    }
    logQuick(target.date, activeSlot, quick.name, { kcal, protein, carbs: 0, fat: 0 });
    showToast(`${fmt.kcal(kcal)} erfasst`);
    close();
  };

  return (
    <Sheet open onClose={close} title="Essen erfassen" subtitle={relativeDay(target.date)}>
      <div className={styles.logHeader}>
        {slotPicker}
        <Segmented
          label="Erfassungsart"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'search', label: 'Lebensmittel' },
            { value: 'quick', label: 'Nur Kalorien' },
          ]}
        />
      </div>

      {mode === 'search' ? (
        <>
          <label className={styles.search}>
            <Icon name="search" size={18} />
            <span className="visually-hidden">Lebensmittel suchen</span>
            <input type="search" autoFocus placeholder="z. B. Banane, Skyr, Proteinriegel" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          {results.length === 0 ? (
            query ? (
              <EmptyState
                compact
                emoji="🔍"
                title={`„${query}“ nicht gefunden`}
                text="Trag es als Schnelleintrag mit Kalorien ein."
                action={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setQuick({ ...quick, name: query });
                      setMode('quick');
                    }}
                  >
                    Als Schnelleintrag erfassen
                  </Button>
                }
              />
            ) : (
              <p className={styles.searchHint}>Suche nach einem Lebensmittel. Zuletzt verwendete erscheinen hier.</p>
            )
          ) : (
            <>
              {!query && <p className={styles.listCaption}>Zuletzt verwendet</p>}
              <ul className={styles.optionList}>
                {results.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      className={styles.optionRow}
                      onClick={() => {
                        setFood(f);
                        setAmount(f.pieceG ? 1 : 100);
                      }}
                    >
                      <span className={styles.mealText}>
                        <span className={styles.mealTitle}>{f.name}</span>
                        <span className={styles.mealMeta}>
                          {fmt.int(f.per100.kcal)} kcal · {fmt.dec(f.per100.protein)} g Protein pro 100 g
                          {!foodAllowed(f, state.nutritionProfile) && ' · passt nicht zu deinen Vorlieben'}
                        </span>
                      </span>
                      <Icon name="plus" size={18} className={styles.muted} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : (
        <form
          className={styles.quickForm}
          onSubmit={(e) => {
            e.preventDefault();
            submitQuick();
          }}
        >
          <Field label="Bezeichnung (optional)" placeholder="z. B. Burger im Restaurant" value={quick.name} onChange={(e) => setQuick({ ...quick, name: e.target.value })} />
          <div className={styles.fieldRow}>
            <Field
              label="Kalorien"
              inputMode="numeric"
              suffix="kcal"
              value={quick.kcal}
              error={quickError ?? undefined}
              onChange={(e) => {
                setQuick({ ...quick, kcal: e.target.value });
                setQuickError(null);
              }}
            />
            <Field label="Protein" inputMode="decimal" suffix="g" value={quick.protein} onChange={(e) => setQuick({ ...quick, protein: e.target.value })} />
          </div>
          <Button type="submit" block icon="plus">
            Hinzufügen
          </Button>
        </form>
      )}
    </Sheet>
  );
}

function MacroCell({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? styles.macroCellStrong : styles.macroCell}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
