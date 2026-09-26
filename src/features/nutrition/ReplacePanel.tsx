import { useMemo, useState } from 'react';
import { getRecipe } from '../../data/recipes';
import { formatCostRange, priceLookup, recipeCostRange } from '../../domain/costs';
import { today as todayIso } from '../../domain/dates';
import { explainMeal } from '../../domain/explain';
import { EMPTY_MANUAL, manualFromProduct, type EntryContent, type ManualInput } from '../../domain/foodEntry';
import { recipeMacros } from '../../domain/nutrition';
import { replacementHistory, type Replacement } from '../../domain/replacements';
import { minutesOf } from '../../domain/schedule';
import type { PlannedMeal, Product, Recipe } from '../../domain/types';
import { mealAlternatives } from '../../domain/week';
import { fmt } from '../../lib/format';
import { newId } from '../../lib/id';
import { withUndo } from '../../lib/undo';
import { replaceWithEntry, replaceWithProduct, replaceWithRecipe } from '../../store/actions';
import { useAppState } from '../../store/store';
import { Button } from '../../components/ui/Button';
import { Segmented } from '../../components/ui/Controls';
import { Icon } from '../../components/ui/Icon';
import { BarcodeLookup } from './BarcodeLookup';
import { ManualForm } from './ManualForm';
import { ProductConfirm } from './ProductConfirm';
import styles from './nutrition.module.css';

type Mode = 'suggest' | 'barcode' | 'manual';

/** A meal counts as "now or earlier" 30 min before its time – replacing it means "I eat/ate this instead". */
const DUE_BEFORE_MIN = 30;

/**
 * "Ersetzen": what replaces a planned meal. Suggestions come from the planner
 * (same ranking as everywhere) plus what the user used as replacement before;
 * barcode and manual reuse the existing flows. Every path ends in ONE action
 * that keeps the day balance exact (see replaceWith* in store/actions).
 */
export function ReplacePanel({ meal, onDone, onBack }: { meal: PlannedMeal; onDone: () => void; onBack: () => void }) {
  const state = useAppState();
  const [mode, setMode] = useState<Mode>('suggest');
  const [product, setProduct] = useState<Product | null>(null);
  const [manual, setManual] = useState<ManualInput | null>(null);
  const [showAll, setShowAll] = useState(false);
  const t = todayIso();
  const now = new Date();
  const eaten = meal.status === 'eaten';
  // Due (or over) → the replacement is what is eaten; later today / future → only the plan changes.
  const due = eaten || meal.date < t || (meal.date === t && now.getHours() * 60 + now.getMinutes() >= minutesOf(state.plannerSettings.mealTimes[meal.slot]) - DUE_BEFORE_MIN);

  const options = useMemo(() => mealAlternatives(state, meal, t, { limit: Number.POSITIVE_INFINITY }), [state, meal, t]);
  const history = useMemo(() => replacementHistory(state, meal), [state, meal]);
  const price = useMemo(() => priceLookup(state.products), [state.products]);

  const finish = (message: string, action: () => boolean) => {
    if (withUndo(message, action)) navigator.vibrate?.(10);
    onDone();
  };
  const useRecipe = (recipe: Recipe, servings: number) =>
    finish(due ? `${recipe.title} statt ${getRecipe(meal.recipeId)?.title ?? 'Mahlzeit'} erfasst` : `Ersetzt durch ${recipe.title}`, () => replaceWithRecipe(meal.id, recipe.id, servings, due));
  const useEntry = (content: EntryContent, id = newId()) => finish(`${content.name} statt ${getRecipe(meal.recipeId)?.title ?? 'Mahlzeit'} erfasst`, () => replaceWithEntry(meal.id, content, { id }));

  if (product) {
    return (
      <ProductConfirm
        product={product}
        onComplete={() => {
          setManual(manualFromProduct(product));
          setProduct(null);
          setMode('manual');
        }}
        footer={(choice) => (
          <>
            <Button variant="secondary" onClick={() => setProduct(null)}>
              Zurück
            </Button>
            <Button
              block
              icon="check"
              disabled={!choice}
              onClick={() =>
                choice &&
                finish(`${product.name} statt ${getRecipe(meal.recipeId)?.title ?? 'Mahlzeit'} erfasst`, () =>
                  replaceWithProduct(meal.id, product, choice.amount, { id: choice.id, foodId: choice.foodId, fromPantry: choice.fromPantry, price: choice.price }),
                )
              }
            >
              Ersetzen
            </Button>
          </>
        )}
      />
    );
  }

  const shown = showAll ? options : options.slice(0, 3);
  return (
    <div className={styles.replace}>
      <Segmented
        label="Ersetzen durch"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'suggest', label: 'Vorschläge' },
          { value: 'barcode', label: 'Barcode' },
          { value: 'manual', label: 'Manuell' },
        ]}
      />

      {mode === 'suggest' && (
        <>
          <p className={styles.openLine}>{due ? 'Was hast du stattdessen gegessen? Ein Tap genügt.' : 'Plan ändern – gleiche Kalorien, Einkauf passt sich an.'}</p>
          {history.length > 0 && (
            <>
              <p className={styles.listCaption}>Zuletzt als Ersatz</p>
              <div>
                {history.map((h) => (
                  <HistoryRow key={h.kind === 'recipe' ? h.recipeId : h.entry.id} item={h} meal={meal} due={due} onRecipe={useRecipe} onEntry={(e) => useEntry(e)} />
                ))}
              </div>
            </>
          )}
          <p className={styles.listCaption}>Passend zu deinem Plan</p>
          {options.length === 0 ? (
            <p className={styles.searchHint}>Mit deinen Filtern gibt es keine Alternative für diese Mahlzeit.</p>
          ) : (
            <div>
              {shown.map((o) => {
                const reason = explainMeal(state, { ...meal, recipeId: o.recipe.id, servings: o.servings, source: 'suggest' }, t).find(isSpecific);
                const cost = recipeCostRange(o.recipe, o.servings, price);
                return (
                  <div key={o.recipe.id} className={styles.suggestion}>
                    <span className={styles.mealEmoji} aria-hidden>
                      {o.recipe.emoji}
                    </span>
                    <span className={styles.mealText}>
                      <span className={styles.mealTitle}>{o.recipe.title}</span>
                      <span className={styles.mealMeta}>
                        {[fmt.kcal(o.macros.kcal), `${fmt.int(o.macros.protein)} g P`, `${o.recipe.prepMin} min`, cost && formatCostRange(cost)].filter(Boolean).join(' · ')}
                      </span>
                      {reason && <span className={styles.reason}>✓ {reason}</span>}
                    </span>
                    <Button size="sm" variant={due ? 'primary' : 'secondary'} onClick={() => useRecipe(o.recipe, o.servings)} aria-label={`${o.recipe.title} ${due ? 'gegessen' : 'übernehmen'}`}>
                      {due ? 'Gegessen' : 'Übernehmen'}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
          {options.length > 3 && (
            <button type="button" className={styles.moreToggle} onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Weniger anzeigen' : `Alle ${options.length} Gerichte anzeigen`}
            </button>
          )}
        </>
      )}

      {mode === 'barcode' && <BarcodeLookup onFound={setProduct} onManual={(barcode) => {
            setManual({ ...EMPTY_MANUAL, barcode });
            setMode('manual');
          }} />}
      {mode === 'manual' && <ManualForm key={manual?.barcode ?? manual?.name ?? 'new'} initial={manual ?? EMPTY_MANUAL} onSubmit={(entry, id) => useEntry(entry, id)} />}

      <Button variant="ghost" block onClick={onBack}>
        <Icon name="chevronLeft" size={16} /> Zurück zur Mahlzeit
      </Button>
    </div>
  );
}

/** Generic lines (prep time, % of the target) are already visible as numbers. */
const isSpecific = (reason: string) => !/^\d+ Min\. Zubereitung$/.test(reason) && !reason.includes('% deines Tagesziels') && !reason.startsWith('Von dir gewählt');

function HistoryRow({ item, meal, due, onRecipe, onEntry }: { item: Replacement; meal: PlannedMeal; due: boolean; onRecipe: (r: Recipe, servings: number) => void; onEntry: (e: EntryContent) => void }) {
  if (item.kind === 'recipe') {
    const recipe = getRecipe(item.recipeId)!;
    // Same calories as the meal it replaces.
    const current = getRecipe(meal.recipeId);
    const kcal = current ? recipeMacros(current, meal.servings).kcal : recipeMacros(recipe).kcal;
    const servings = Math.min(3, Math.max(0.5, Math.round((kcal / (recipeMacros(recipe).kcal || 1)) * 10) / 10));
    return (
      <div className={styles.suggestion}>
        <span className={styles.mealEmoji} aria-hidden>
          {recipe.emoji}
        </span>
        <span className={styles.mealText}>
          <span className={styles.mealTitle}>{recipe.title}</span>
          <span className={styles.mealMeta}>
            {fmt.kcal(recipeMacros(recipe, servings).kcal)} · {item.count}× als Ersatz
          </span>
        </span>
        <Button size="sm" variant={due ? 'primary' : 'secondary'} onClick={() => onRecipe(recipe, servings)} aria-label={`${recipe.title} ${due ? 'gegessen' : 'übernehmen'}`}>
          {due ? 'Gegessen' : 'Übernehmen'}
        </Button>
      </div>
    );
  }
  const e = item.entry;
  const content: EntryContent = {
    name: e.name,
    method: e.method === 'plan' ? 'manual' : e.method,
    macros: e.macros,
    ...(e.micros ? { micros: e.micros } : {}),
    ...(e.unknown ? { unknown: e.unknown } : {}),
    ...(e.amount !== undefined ? { amount: e.amount, unit: e.unit } : {}),
    ...(e.grams !== undefined ? { grams: e.grams } : {}),
    ...(e.barcode ? { barcode: e.barcode } : {}),
    ...(e.brand ? { brand: e.brand } : {}),
    ...(e.foodId ? { foodId: e.foodId } : {}),
  };
  return (
    <div className={styles.suggestion}>
      <span className={styles.mealEmoji} aria-hidden>
        {e.method === 'barcode' ? <Icon name="barcode" size={20} /> : '🍽️'}
      </span>
      <span className={styles.mealText}>
        <span className={styles.mealTitle}>{e.name}</span>
        <span className={styles.mealMeta}>
          {fmt.kcal(e.macros.kcal)} · {item.count}× als Ersatz
        </span>
      </span>
      {/* Food is only ever eaten, never planned – so it is always logged. */}
      <Button size="sm" onClick={() => onEntry(content)} aria-label={`${e.name} gegessen`}>
        Gegessen
      </Button>
    </div>
  );
}
