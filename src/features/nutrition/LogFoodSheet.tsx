import { useMemo, useState } from 'react';
import { FOODS, getFood } from '../../data/foods';
import { getRecipe } from '../../data/recipes';
import { today } from '../../domain/dates';
import { explainMeal } from '../../domain/explain';
import { EMPTY_MANUAL, manualFromProduct, type ManualInput } from '../../domain/foodEntry';
import { foodAllowed, foodMacros, recipeMacros } from '../../domain/nutrition';
import type { Food, ISODate, MealSlot, PlannedMeal, Product } from '../../domain/types';
import { dayTargetFor, pantryEstimate, slotSuggestions } from '../../domain/week';
import { fmt, formatGrams, relativeDay, SLOT_LABEL } from '../../lib/format';
import { newId } from '../../lib/id';
import { withUndo } from '../../lib/undo';
import { eatSuggestion, logEntry, logFood, logProduct, markEaten } from '../../store/actions';
import { useAppState } from '../../store/store';
import { Button } from '../../components/ui/Button';
import { Segmented, Stepper } from '../../components/ui/Controls';
import { EmptyState } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/Icon';
import { Sheet } from '../../components/ui/Sheet';
import { BarcodeLookup } from './BarcodeLookup';
import { ManualForm } from './ManualForm';
import { MicroLine, NutrientGrid, ProductConfirm } from './ProductConfirm';
import styles from './nutrition.module.css';

export interface LogTarget {
  date: ISODate;
  slot: MealSlot;
}

interface LogFoodSheetProps {
  target: LogTarget | null;
  onClose: () => void;
}

type Mode = 'suggest' | 'search' | 'barcode' | 'manual';
type Step = { kind: 'food'; food: Food } | { kind: 'product'; product: Product } | { kind: 'manual'; initial: ManualInput } | null;

/**
 * "Lebensmittel hinzufügen" – one sheet for everything eaten:
 *   Vorschlag (planner, one tap) · Suchen (catalog + scanned products) ·
 *   Barcode · Manuell. (Replacing a planned meal lives in MealSheet → Ersetzen.)
 * Every path ends in the same log (store/actions), nothing is tracked twice.
 */
export function LogFoodSheet({ target, onClose }: LogFoodSheetProps) {
  const state = useAppState();
  const [mode, setMode] = useState<Mode | null>(null);
  const [slot, setSlot] = useState<MealSlot | null>(null);
  const [step, setStep] = useState<Step>(null);

  const close = () => {
    setMode(null);
    setSlot(null);
    setStep(null);
    onClose();
  };

  if (!target) return <Sheet open={false} onClose={close} title="" children={null} />;

  const activeSlot = slot ?? target.slot;
  const modes: { value: Mode; label: string }[] = [
    { value: 'suggest', label: 'Vorschlag' },
    { value: 'search', label: 'Suchen' },
    { value: 'barcode', label: 'Barcode' },
    { value: 'manual', label: 'Manuell' },
  ];
  const activeMode = mode ?? modes[0]!.value;
  const subtitle = `${SLOT_LABEL[activeSlot]} · ${relativeDay(target.date)}`;
  const done = (message: string, action: () => boolean | void) => {
    if (withUndo(message, action)) navigator.vibrate?.(10);
    close();
  };

  // ----- Steps after choosing something -----
  if (step?.kind === 'food') {
    return <FoodAmount food={step.food} subtitle={subtitle} onBack={() => setStep(null)} onClose={close} onAdd={(grams, id) => done(`${step.food.name} erfasst`, () => logFood(target.date, activeSlot, step.food.id, grams, { id }))} />;
  }
  if (step?.kind === 'product') {
    const product = step.product;
    return (
      <Sheet open onClose={close} title="Produkt prüfen" subtitle={subtitle}>
        <ProductConfirm
          product={product}
          onComplete={() => setStep({ kind: 'manual', initial: manualFromProduct(product) })}
          footer={(choice) => (
            <>
              <Button variant="secondary" onClick={() => setStep(null)}>
                Zurück
              </Button>
              <Button
                block
                icon="plus"
                disabled={!choice}
                onClick={() =>
                  choice &&
                  done(`${product.name} erfasst`, () =>
                    logProduct(target.date, activeSlot, product, choice.amount, { id: choice.id, foodId: choice.foodId, fromPantry: choice.fromPantry }),
                  )
                }
              >
                Hinzufügen
              </Button>
            </>
          )}
        />
      </Sheet>
    );
  }
  if (step?.kind === 'manual') {
    return (
      <Sheet open onClose={close} title="Manuell erfassen" subtitle={subtitle}>
        <ManualForm initial={step.initial} onBack={() => setStep(null)} onSubmit={(entry, id) => done(`${entry.name} erfasst`, () => logEntry(target.date, activeSlot, entry, { id }))} />
      </Sheet>
    );
  }

  const slots = state.nutritionProfile?.slots ?? (['breakfast', 'snack', 'lunch', 'dinner'] as MealSlot[]);
  return (
    <Sheet open onClose={close} title="Lebensmittel hinzufügen" subtitle={relativeDay(target.date)}>
      <div className={styles.logHeader}>
        <Segmented label="Mahlzeit" value={activeSlot} onChange={setSlot} options={slots.map((s) => ({ value: s, label: SLOT_LABEL[s].replace('essen', '') }))} />
        <Segmented label="Erfassungsart" value={activeMode} onChange={setMode} options={modes} />
      </div>

      {activeMode === 'suggest' && <SuggestPanel date={target.date} slot={activeSlot} onDone={done} />}
      {activeMode === 'search' && <SearchPanel onFood={(food) => setStep({ kind: 'food', food })} onProduct={(product) => setStep({ kind: 'product', product })} onManual={(name) => setStep({ kind: 'manual', initial: { ...EMPTY_MANUAL, name } })} />}
      {activeMode === 'barcode' && (
        <BarcodeLookup onFound={(product) => setStep({ kind: 'product', product })} onManual={(barcode) => setStep({ kind: 'manual', initial: { ...EMPTY_MANUAL, barcode } })} />
      )}
      {activeMode === 'manual' && <ManualForm initial={EMPTY_MANUAL} onSubmit={(entry, id) => done(`${entry.name} erfasst`, () => logEntry(target.date, activeSlot, entry, { id }))} />}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

type Done = (message: string, action: () => boolean | void) => void;

/**
 * "Passend zu deinem Plan": the planned meal first (one tap), then options the
 * planner ranks for what is still open today – never random.
 */
function SuggestPanel({ date, slot, onDone }: { date: ISODate; slot: MealSlot; onDone: Done }) {
  const state = useAppState();
  const t = today();
  const planned = state.plannedMeals.find((m) => m.date === date && m.slot === slot && m.status === 'planned');
  const { options, open } = useMemo(() => slotSuggestions(state, date, slot, t, 3, planned ? [planned.recipeId] : []), [state, date, slot, t, planned]);
  const plannedRecipe = planned ? getRecipe(planned.recipeId) : undefined;

  return (
    <>
      {dayTargetFor(state, date) && (
        <p className={styles.openLine}>
          Heute noch offen: <strong>{fmt.kcal(open.kcal)}</strong> · <strong>{fmt.g(open.protein)} Protein</strong>
        </p>
      )}
      {planned && plannedRecipe && (
        <div className={`${styles.suggestion} ${styles.suggestionPlanned}`}>
          <span className={styles.mealEmoji} aria-hidden>
            {plannedRecipe.emoji}
          </span>
          <span className={styles.mealText}>
            <span className={styles.mealLabel}>Dein Plan</span>
            <span className={styles.mealTitle}>{plannedRecipe.title}</span>
            <span className={styles.mealMeta}>
              {fmt.kcal(recipeMacros(plannedRecipe, planned.servings).kcal)} · {fmt.g(recipeMacros(plannedRecipe, planned.servings).protein)} Protein
            </span>
          </span>
          <Button size="sm" icon="check" onClick={() => onDone(`${plannedRecipe.title} erfasst`, () => markEaten(planned.id))}>
            Gegessen
          </Button>
        </div>
      )}
      <p className={styles.listCaption}>{planned ? 'Oder passend zu deinem Plan' : 'Passend zu deinem Plan'}</p>
      {options.length === 0 ? (
        <p className={styles.searchHint}>Für diese Mahlzeit gibt es mit deinen Filtern keine Vorschläge.</p>
      ) : (
        <div>
          {options.map((o) => {
            const reasons = explainMeal(state, suggestionMeal(date, slot, o.recipe.id, o.servings), t).filter(isSpecific).slice(0, 2);
            return (
              <div key={o.recipe.id} className={styles.suggestion}>
                <span className={styles.mealEmoji} aria-hidden>
                  {o.recipe.emoji}
                </span>
                <span className={styles.mealText}>
                  <span className={styles.mealTitle}>{o.recipe.title}</span>
                  <span className={styles.mealMeta}>
                    {fmt.kcal(o.macros.kcal)} · {fmt.g(o.macros.protein)} Protein · {o.recipe.prepMin} min
                  </span>
                  {reasons.map((r) => (
                    <span key={r} className={styles.reason}>
                      ✓ {r}
                    </span>
                  ))}
                </span>
                <Button size="sm" variant="secondary" onClick={() => onDone(`${o.recipe.title} erfasst`, () => eatSuggestion(date, slot, o.recipe.id, o.servings, planned?.id))}>
                  Gegessen
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

const suggestionMeal = (date: ISODate, slot: MealSlot, recipeId: string, servings: number): PlannedMeal => ({ id: 'suggestion', date, slot, recipeId, servings, status: 'planned', source: 'suggest' });

/** The generic lines ("25 Min. Zubereitung", "x % deines Tagesziels") are shown as numbers already. */
const isSpecific = (reason: string) => !/^\d+ Min\. Zubereitung$/.test(reason) && !reason.includes('% deines Tagesziels');

/** Catalog foods and products scanned before (offline, no request). */
function SearchPanel({ onFood, onProduct, onManual }: { onFood: (f: Food) => void; onProduct: (p: Product) => void; onManual: (name: string) => void }) {
  const state = useAppState();
  const [query, setQuery] = useState('');

  const recent = useMemo(() => {
    const items: ({ kind: 'food'; food: Food } | { kind: 'product'; product: Product })[] = [];
    const seen = new Set<string>();
    for (const e of [...state.logEntries].reverse()) {
      const key = e.barcode ?? e.foodId;
      if (!key || seen.has(key)) continue;
      if (e.barcode && state.products[e.barcode]) items.push({ kind: 'product', product: state.products[e.barcode]! });
      else if (e.foodId && e.method === 'food' && getFood(e.foodId)) items.push({ kind: 'food', food: getFood(e.foodId)! });
      else continue;
      seen.add(key);
      if (items.length >= 8) break;
    }
    return items;
  }, [state.logEntries, state.products]);

  const q = query.trim().toLowerCase();
  const products = q ? Object.values(state.products ?? {}).filter((p) => `${p.name} ${p.brand ?? ''}`.toLowerCase().includes(q)) : [];
  const foods = q
    ? FOODS.filter((f) => f.name.toLowerCase().includes(q)).sort((a, b) => Number(foodAllowed(b, state.nutritionProfile)) - Number(foodAllowed(a, state.nutritionProfile)))
    : [];
  const list = q ? [...products.map((product) => ({ kind: 'product' as const, product })), ...foods.map((food) => ({ kind: 'food' as const, food }))] : recent;

  return (
    <>
      <label className={styles.search}>
        <Icon name="search" size={18} />
        <span className="visually-hidden">Lebensmittel suchen</span>
        <input type="search" autoFocus placeholder="z. B. Banane, Skyr, Proteinriegel" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {list.length === 0 ? (
        q ? (
          <EmptyState
            compact
            emoji="🔍"
            title={`„${query}“ nicht gefunden`}
            text="Erfasse es mit den Werten der Verpackung oder scanne den Barcode."
            action={
              <Button variant="secondary" onClick={() => onManual(query)}>
                Manuell erfassen
              </Button>
            }
          />
        ) : (
          <p className={styles.searchHint}>Suche nach einem Lebensmittel. Zuletzt verwendete und gescannte erscheinen hier.</p>
        )
      ) : (
        <>
          {!q && <p className={styles.listCaption}>Zuletzt verwendet</p>}
          <ul className={styles.optionList}>
            {list.map((item) =>
              item.kind === 'food' ? (
                <li key={`f-${item.food.id}`}>
                  <button type="button" className={styles.optionRow} onClick={() => onFood(item.food)}>
                    <span className={styles.mealText}>
                      <span className={styles.mealTitle}>{item.food.name}</span>
                      <span className={styles.mealMeta}>
                        {fmt.int(item.food.per100.kcal)} kcal · {fmt.dec(item.food.per100.protein)} g Protein pro 100 g
                        {!foodAllowed(item.food, state.nutritionProfile) && ' · passt nicht zu deinen Vorlieben'}
                      </span>
                    </span>
                    <Icon name="plus" size={18} className={styles.muted} />
                  </button>
                </li>
              ) : (
                <li key={`p-${item.product.barcode}`}>
                  <button type="button" className={styles.optionRow} onClick={() => onProduct(item.product)}>
                    <span className={styles.mealText}>
                      <span className={styles.mealTitle}>{item.product.name}</span>
                      <span className={styles.mealMeta}>
                        <span className={styles.sourceBadge}>
                          <Icon name="barcode" size={12} /> Produkt
                        </span>{' '}
                        {item.product.brand ? `${item.product.brand} · ` : ''}
                        {item.product.per100.kcal !== undefined ? `${fmt.int(item.product.per100.kcal)} kcal pro 100 ${item.product.unit}` : 'Kalorien unbekannt'}
                      </span>
                    </span>
                    <Icon name="plus" size={18} className={styles.muted} />
                  </button>
                </li>
              ),
            )}
          </ul>
        </>
      )}
    </>
  );
}

/** Amount of a catalog food (pieces or grams). */
function FoodAmount({ food, subtitle, onBack, onClose, onAdd }: { food: Food; subtitle: string; onBack: () => void; onClose: () => void; onAdd: (grams: number, id: string) => void }) {
  const state = useAppState();
  const usesPieces = !!food.pieceG;
  const [amount, setAmount] = useState(usesPieces ? 1 : 100);
  const [id] = useState(newId);
  const grams = usesPieces ? amount * food.pieceG! : amount;
  const stock = pantryEstimate(state)[food.id];
  return (
    <Sheet
      open
      onClose={onClose}
      title={food.name}
      subtitle={subtitle}
      footer={
        <>
          <Button variant="secondary" onClick={onBack}>
            Zurück
          </Button>
          <Button block icon="plus" onClick={() => onAdd(grams, id)}>
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
      <NutrientGrid macros={foodMacros(food, grams)} />
      <MicroLine micros={food.micros?.fiber !== undefined ? { fiber: Math.round(((food.micros.fiber * grams) / 100) * 10) / 10 } : undefined} />
      {stock !== undefined && stock > 0 && <p className={styles.sourceNote}>Wird von deinem Vorrat abgezogen (ca. {formatGrams(stock)} da).</p>}
    </Sheet>
  );
}
