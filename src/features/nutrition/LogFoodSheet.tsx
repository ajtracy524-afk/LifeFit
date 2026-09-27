import { useMemo, useState } from 'react';
import type { DbFood } from '../../data/foodDb';
import { getFood } from '../../data/foods';
import { getRecipe } from '../../data/recipes';
import { addDays, today } from '../../domain/dates';
import { slotRepeat } from '../../domain/repeatMeal';
import { formatCostRange, priceLookup, recipeCostRange, type PriceLookup } from '../../domain/costs';
import { explainMeal } from '../../domain/explain';
import { dbFoodEntry, dbFoodMicros, dishEntry, dishPortionNutrition } from '../../domain/dishes';
import { EMPTY_MANUAL, manualFromProduct, productEntry, type EntryContent, type ManualInput } from '../../domain/foodEntry';
import { foodAllowed, foodMacros, logFromMeal, recipeMacros, scaleMacros, scaleMicros } from '../../domain/nutrition';
import type { CustomDish, Food, ISODate, MealSlot, PlannedMeal, Product, Recipe } from '../../domain/types';
import { dayTargetFor, pantryEstimate, slotSuggestions } from '../../domain/week';
import { fmt, formatGrams, relativeDay, SLOT_LABEL } from '../../lib/format';
import { newId } from '../../lib/id';
import { eatSuggestion, logDbFood, logDish, logEntry, logFood, logProduct, markEaten, repeatSlot } from '../../store/actions';
import { searchProducts } from '../../services/foodDatabase';
import { getState, useAppState } from '../../store/store';
import { Button } from '../../components/ui/Button';
import { Segmented, Stepper } from '../../components/ui/Controls';
import { EmptyState } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/Icon';
import { Sheet } from '../../components/ui/Sheet';
import { BarcodeLookup } from './BarcodeLookup';
import { ManualForm } from './ManualForm';
import { DishEditorSheet, DishList, DishPortionSheet } from './Dishes';
import { ProductEditSheet, ProductList } from './Products';
import { runLog, type CelebrationInput } from './logFeedback';
import { useFoodSearch } from './useFoodSearch';
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
type Step =
  | { kind: 'food'; food: Food }
  | { kind: 'db'; food: DbFood }
  | { kind: 'product'; product: Product }
  | { kind: 'manual'; initial: ManualInput }
  | { kind: 'dish'; dish: CustomDish }
  | { kind: 'dishEdit'; dish?: CustomDish; back: Step }
  | { kind: 'productEdit'; product?: Product; back: Step }
  | null;

/**
 * "Lebensmittel hinzufügen" – one sheet for everything eaten:
 *   Vorschlag (planner, one tap) · Suchen (own dishes, scanned products,
 *   catalog, extended database, online) · Barcode · Manuell (with "Meine Gerichte"). (Replacing a planned meal lives in MealSheet → Ersetzen.)
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
  // `content`: what is about to be logged – adds the small feedback line (computed before the action).
  const done = (message: string, action: () => boolean | void, content?: Pick<EntryContent, 'macros' | 'micros' | 'unknown'>, fallback?: () => CelebrationInput | undefined) => {
    runLog(target.date, message, content, action, fallback);
    close();
  };

  // ----- Steps after choosing something -----
  if (step?.kind === 'food') {
    return <FoodAmount food={step.food} subtitle={subtitle} onBack={() => setStep(null)} onClose={close} onAdd={(grams, id) => done(`${step.food.name} erfasst`, () => logFood(target.date, activeSlot, step.food.id, grams, { id }), { macros: foodMacros(step.food, grams), micros: scaleMicros(step.food.micros, grams / 100) })} />;
  }
  if (step?.kind === 'db') {
    const food = step.food;
    return <FoodAmount food={food} subtitle={subtitle} onBack={() => setStep(null)} onClose={close} onAdd={(grams, id) => done(`${food.name} erfasst`, () => logDbFood(target.date, activeSlot, food, grams, { id }), dbFoodEntry(food, grams))} />;
  }
  if (step?.kind === 'dish') {
    const dish = step.dish;
    return (
      <DishPortionSheet
        dish={dish}
        subtitle={subtitle}
        onBack={() => setStep(null)}
        onClose={close}
        onEdit={() => setStep({ kind: 'dishEdit', dish, back: step })}
        onAdd={(portions, id) => {
          // Known dish used again – "the app knows your routine" (from the real log count).
          const before = state.logEntries.filter((e) => e.dishId === dish.id).length;
          done(`${dish.name} erfasst`, () => logDish(target.date, activeSlot, dish.id, portions, { id }), dishEntry(dish, portions), () =>
            before > 0 ? { kind: 'dish', icon: '🍽️', title: 'Wieder verwendet', detail: `${dish.name} · ${before + 1}. Mal erfasst`, level: 2 } : undefined,
          );
        }}
      />
    );
  }
  if (step?.kind === 'dishEdit') {
    const back = step.back;
    return (
      <DishEditorSheet
        dish={step.dish}
        onClose={close}
        onCancel={() => setStep(back)}
        onSaved={(id) => setStep(id && getState().customDishes?.[id] ? { kind: 'dish', dish: getState().customDishes[id]! } : null)}
      />
    );
  }
  if (step?.kind === 'productEdit') {
    const back = step.back;
    return (
      <ProductEditSheet
        product={step.product}
        onClose={close}
        onCancel={() => setStep(back)}
        // Back to where the user came from – with the saved product data (or the list after deleting).
        onDone={(barcode) => {
          const saved = barcode ? getState().products?.[barcode] : undefined;
          setStep(back?.kind === 'product' && saved ? { kind: 'product', product: saved } : null);
        }}
      />
    );
  }
  if (step?.kind === 'product') {
    const product = step.product;
    return (
      <Sheet open onClose={close} title="Produkt prüfen" subtitle={subtitle}>
        <ProductConfirm
          product={product}
          onEdit={() => setStep({ kind: 'productEdit', product, back: step })}
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
                  done(
                    `${product.name} erfasst`,
                    () => logProduct(target.date, activeSlot, product, choice.amount, { id: choice.id, foodId: choice.foodId, fromPantry: choice.fromPantry, price: choice.price }),
                    productEntry(product, choice.amount),
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
        <ManualForm initial={step.initial} onBack={() => setStep(null)} onSubmit={(entry, id) => done(`${entry.name} erfasst`, () => logEntry(target.date, activeSlot, entry, { id }), entry)} />
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
      {activeMode === 'search' && (
        <SearchPanel
          onFood={(food) => setStep({ kind: 'food', food })}
          onDb={(food) => setStep({ kind: 'db', food })}
          onDish={(dish) => setStep({ kind: 'dish', dish })}
          onProduct={(product) => setStep({ kind: 'product', product })}
          onManual={(name) => setStep({ kind: 'manual', initial: { ...EMPTY_MANUAL, name } })}
        />
      )}
      {activeMode === 'barcode' && (
        <BarcodeLookup onFound={(product) => setStep({ kind: 'product', product })} onManual={(barcode) => setStep({ kind: 'manual', initial: { ...EMPTY_MANUAL, barcode } })} />
      )}
      {activeMode === 'manual' && (
        <>
          <DishList onPick={(dish) => setStep({ kind: 'dish', dish })} onCreate={() => setStep({ kind: 'dishEdit', back: null })} />
          <ProductList onPick={(product) => setStep({ kind: 'product', product })} onEdit={(product) => setStep({ kind: 'productEdit', product, back: null })} onCreate={() => setStep({ kind: 'productEdit', back: null })} />
          <p className={styles.listCaption}>Einzelnes Lebensmittel mit Verpackungswerten</p>
          <ManualForm initial={EMPTY_MANUAL} onSubmit={(entry, id) => done(`${entry.name} erfasst`, () => logEntry(target.date, activeSlot, entry, { id }), entry)} />
        </>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

type Done = (message: string, action: () => boolean | void, content?: Pick<EntryContent, 'macros' | 'micros' | 'unknown'>) => void;

/**
 * "Passend zu deinem Plan": the planned meal first (one tap), then options the
 * planner ranks for what is still open today – never random.
 */
function SuggestPanel({ date, slot, onDone }: { date: ISODate; slot: MealSlot; onDone: Done }) {
  const state = useAppState();
  const t = today();
  const planned = state.plannedMeals.find((m) => m.date === date && m.slot === slot && m.status === 'planned');
  const { options, open } = useMemo(() => slotSuggestions(state, date, slot, t, 3, planned ? [planned.recipeId] : []), [state, date, slot, t, planned]);
  const price = useMemo(() => priceLookup(state.products), [state.products]);
  const plannedRecipe = planned ? getRecipe(planned.recipeId) : undefined;
  // One id for this sheet: a double tap on a suggestion adds the meal once.
  const [mealId] = useState(newId);
  // "Wie gestern": the same slot yesterday, as it was really eaten – one tap.
  const yesterday = addDays(date, -1);
  const again = useMemo(() => slotRepeat(state, yesterday, slot), [state.plannedMeals, state.logEntries, yesterday, slot]);

  return (
    <>
      {dayTargetFor(state, date) && (
        <p className={styles.openLine}>
          Heute noch offen: <strong>{fmt.kcal(open.kcal)}</strong> · <strong>{fmt.g(open.protein)} Protein</strong>
        </p>
      )}
      {again.items.length > 0 && (
        <div className={`${styles.suggestion} ${styles.suggestionRepeat}`}>
          <span className={styles.mealEmoji} aria-hidden>
            ↺
          </span>
          <span className={styles.mealText}>
            <span className={styles.mealLabel}>Wie gestern</span>
            <span className={styles.mealTitle}>{again.items.map((i) => i.name).join(', ')}</span>
            <span className={styles.mealMeta}>
              {fmt.kcal(again.macros.kcal)} · {fmt.g(again.macros.protein)} Protein
            </span>
          </span>
          <Button size="sm" icon="check" onClick={() => onDone('Wie gestern erfasst', () => repeatSlot(yesterday, date, slot), { macros: again.macros })}>
            Übernehmen
          </Button>
        </div>
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
          <Button size="sm" icon="check" onClick={() => onDone(`${plannedRecipe.title} erfasst`, () => markEaten(planned.id), logFromMeal(planned))}>
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
                    {[fmt.kcal(o.macros.kcal), `${fmt.int(o.macros.protein)} g Protein`, `${o.recipe.prepMin} min`, costText(o.recipe, o.servings, price)].filter(Boolean).join(' · ')}
                  </span>
                  {reasons.map((r) => (
                    <span key={r} className={styles.reason}>
                      ✓ {r}
                    </span>
                  ))}
                </span>
                <Button size="sm" variant="secondary" onClick={() => onDone(`${o.recipe.title} erfasst`, () => eatSuggestion(date, slot, o.recipe.id, o.servings, planned?.id, mealId), logFromMeal(suggestionMeal(date, slot, o.recipe.id, o.servings)))}>
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

/** "ca. 2–3 CHF" – only with reliable prices, otherwise nothing. */
const costText = (recipe: Recipe, servings: number, price: PriceLookup) => {
  const r = recipeCostRange(recipe, servings, price);
  return r ? formatCostRange(r) : undefined;
};

const suggestionMeal = (date: ISODate, slot: MealSlot, recipeId: string, servings: number): PlannedMeal => ({ id: 'suggestion', date, slot, recipeId, servings, status: 'planned', source: 'suggest' });

/** The generic lines ("25 Min. Zubereitung", "x % deines Tagesziels") are shown as numbers already. */
const isSpecific = (reason: string) => !/^\d+ Min\. Zubereitung$/.test(reason) && !reason.includes('% deines Tagesziels');

type SearchItem =
  | { kind: 'dish'; dish: CustomDish }
  | { kind: 'product'; product: Product }
  | { kind: 'food'; food: Food }
  | { kind: 'db'; food: DbFood };

type Online = { status: 'idle' } | { status: 'loading'; query: string } | { status: 'done'; query: string; products: Product[] } | { status: 'error'; query: string; message: string };

/**
 * "Suchen": own dishes, products scanned before, the catalog and the extended
 * database – all local (the database loads once, on the first query). Branded
 * products online only on an explicit tap (Open Food Facts).
 */
function SearchPanel({
  onFood,
  onDb,
  onDish,
  onProduct,
  onManual,
}: {
  onFood: (f: Food) => void;
  onDb: (f: DbFood) => void;
  onDish: (d: CustomDish) => void;
  onProduct: (p: Product) => void;
  onManual: (name: string) => void;
}) {
  const state = useAppState();
  const [query, setQuery] = useState('');
  const [online, setOnline] = useState<Online>({ status: 'idle' });
  const found = useFoodSearch(query);

  const recent = useMemo(() => {
    const items: SearchItem[] = [];
    const seen = new Set<string>();
    for (const e of [...state.logEntries].reverse()) {
      const key = e.dishId ?? e.barcode ?? e.foodId;
      if (!key || seen.has(key)) continue;
      if (e.dishId && state.customDishes?.[e.dishId] && !state.customDishes[e.dishId]!.archived) items.push({ kind: 'dish', dish: state.customDishes[e.dishId]! });
      else if (e.barcode && state.products[e.barcode]) items.push({ kind: 'product', product: state.products[e.barcode]! });
      else if (e.foodId && e.method === 'food' && getFood(e.foodId)) items.push({ kind: 'food', food: getFood(e.foodId)! });
      else continue;
      seen.add(key);
      if (items.length >= 8) break;
    }
    return items;
  }, [state.logEntries, state.products, state.customDishes]);

  const q = query.trim();
  const list: SearchItem[] = q
    ? [
        ...found.dishes.map((dish) => ({ kind: 'dish' as const, dish })),
        ...found.products.map((product) => ({ kind: 'product' as const, product })),
        ...found.catalog.map((food) => ({ kind: 'food' as const, food })),
        ...found.database.map((food) => ({ kind: 'db' as const, food })),
      ]
    : recent;
  const onlineHere = online.status !== 'idle' && online.query === q ? online : undefined;
  const known = new Set(found.products.map((p) => p.barcode));
  const onlineProducts = onlineHere?.status === 'done' ? onlineHere.products.filter((p) => !known.has(p.barcode)) : [];

  const searchOnline = async () => {
    setOnline({ status: 'loading', query: q });
    const result = await searchProducts(q);
    setOnline(result.status === 'ok' ? { status: 'done', query: q, products: result.products } : { status: 'error', query: q, message: result.message });
  };

  return (
    <>
      <label className={styles.search}>
        <Icon name="search" size={18} />
        <span className="visually-hidden">Lebensmittel suchen</span>
        <input type="search" autoFocus placeholder="z. B. Birne, Emmentaler, Skyr" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {!q && list.length === 0 && <p className={styles.searchHint}>Suche nach einem Lebensmittel, einem eigenen Gericht oder einem Produkt. Zuletzt verwendete erscheinen hier.</p>}
      {!q && list.length > 0 && <p className={styles.listCaption}>Zuletzt verwendet</p>}
      {list.length > 0 && (
        <ul className={styles.optionList}>
          {list.map((item) => (
            <SearchRow key={searchKey(item)} item={item} disallowed={item.kind === 'food' && !foodAllowed(item.food, state.nutritionProfile)} onPick={() => pick(item, { onFood, onDb, onDish, onProduct })} />
          ))}
        </ul>
      )}
      {found.loading && <p className={styles.searchHint}>Erweiterte Datenbank wird geladen …</p>}
      {found.failed && <p className={styles.searchHint}>Die erweiterte Datenbank konnte nicht geladen werden (offline?). Deine Gerichte, Produkte und der Katalog funktionieren weiterhin.</p>}

      {q.length >= 2 && (
        <div className={styles.onlineSearch}>
          {onlineHere?.status === 'done' ? (
            onlineProducts.length ? (
              <>
                <p className={styles.listCaption}>Online · Open Food Facts</p>
                <ul className={styles.optionList}>
                  {onlineProducts.map((product) => (
                    <SearchRow key={`o-${product.barcode}`} item={{ kind: 'product', product }} online onPick={() => onProduct(product)} />
                  ))}
                </ul>
              </>
            ) : (
              <p className={styles.searchHint}>Online nichts Passendes gefunden.</p>
            )
          ) : onlineHere?.status === 'error' ? (
            <p className={styles.searchHint} role="alert">
              {onlineHere.message}
            </p>
          ) : (
            <Button variant="secondary" size="sm" icon="search" disabled={onlineHere?.status === 'loading'} onClick={searchOnline} className={styles.tapTarget}>
              {onlineHere?.status === 'loading' ? 'Suche online …' : 'Markenprodukte online suchen'}
            </Button>
          )}
          <p className={styles.sourceNote}>Online-Suche über Open Food Facts – es wird nur der Suchbegriff gesendet.</p>
        </div>
      )}

      {q && list.length === 0 && !found.loading && onlineProducts.length === 0 && (
        <EmptyState
          compact
          emoji="🔍"
          title={`„${query}“ nicht gefunden`}
          text="Erfasse es mit den Werten der Verpackung, scanne den Barcode oder speichere es als eigenes Gericht."
          action={
            <Button variant="secondary" onClick={() => onManual(query)}>
              Manuell erfassen
            </Button>
          }
        />
      )}
    </>
  );
}

const searchKey = (item: SearchItem) => (item.kind === 'dish' ? `d-${item.dish.id}` : item.kind === 'product' ? `p-${item.product.barcode}` : item.kind === 'food' ? `f-${item.food.id}` : item.food.id);

function pick(item: SearchItem, on: { onFood: (f: Food) => void; onDb: (f: DbFood) => void; onDish: (d: CustomDish) => void; onProduct: (p: Product) => void }) {
  if (item.kind === 'dish') on.onDish(item.dish);
  else if (item.kind === 'product') on.onProduct(item.product);
  else if (item.kind === 'food') on.onFood(item.food);
  else on.onDb(item.food);
}

/** One result with its source – values of different sources are never mixed. */
function SearchRow({ item, onPick, disallowed, online }: { item: SearchItem; onPick: () => void; disallowed?: boolean; online?: boolean }) {
  let title: string;
  let badge: string;
  let meta: string;
  if (item.kind === 'dish') {
    const m = dishPortionNutrition(item.dish, 1).macros;
    title = `🍽️ ${item.dish.name}`;
    badge = 'Mein Gericht';
    meta = `${fmt.kcal(m.kcal)} · ${fmt.int(m.protein)} g Protein pro Portion`;
  } else if (item.kind === 'product') {
    const p = item.product;
    title = p.name;
    badge = online ? 'Online' : 'Produkt';
    meta = `${p.brand ? `${p.brand} · ` : ''}${p.per100.kcal !== undefined ? `${fmt.int(p.per100.kcal)} kcal pro 100 ${p.unit}` : 'Kalorien unbekannt'}`;
  } else {
    const f = item.food;
    title = f.name;
    badge = item.kind === 'food' ? 'Katalog' : 'Datenbank';
    meta = `${fmt.int(f.per100.kcal)} kcal · ${fmt.dec(f.per100.protein)} g Protein pro 100 g${disallowed ? ' · passt nicht zu deinen Vorlieben' : ''}`;
  }
  return (
    <li>
      <button type="button" className={styles.optionRow} onClick={onPick}>
        <span className={styles.mealText}>
          <span className={styles.mealTitle}>{title}</span>
          <span className={styles.mealMeta}>
            <span className={styles.sourceBadge}>
              {item.kind === 'product' && <Icon name="barcode" size={12} />} {badge}
            </span>{' '}
            {meta}
          </span>
        </span>
        <Icon name="plus" size={18} className={styles.muted} />
      </button>
    </li>
  );
}

type AmountFood = Food | DbFood;
const isDb = (f: AmountFood): f is DbFood => 'fdc' in f;

/** Amount of a catalog or database food (pieces or grams) – nutrients shown for exactly that amount. */
function FoodAmount({ food, subtitle, onBack, onClose, onAdd }: { food: AmountFood; subtitle: string; onBack: () => void; onClose: () => void; onAdd: (grams: number, id: string) => void }) {
  const state = useAppState();
  const pieceG = isDb(food) ? undefined : food.pieceG;
  const usesPieces = !!pieceG;
  const [amount, setAmount] = useState(usesPieces ? 1 : 100);
  const [id] = useState(newId);
  const grams = usesPieces ? amount * pieceG! : amount;
  const stock = isDb(food) ? undefined : pantryEstimate(state)[food.id];
  const micros = scaleMicros(isDb(food) ? dbFoodMicros(food) : food.micros, grams / 100);
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
          format={(v) => (usesPieces ? `${v} ${isDb(food) ? '' : food.pieceLabel}` : `${v} g`)}
        />
        {usesPieces && <p className={styles.muted}>≈ {fmt.g(grams)}</p>}
      </div>
      <NutrientGrid macros={macrosFor(food, grams)} />
      <MicroLine micros={micros} />
      {isDb(food) && <p className={styles.sourceNote}>Nährwerte: USDA FoodData Central (Standardlebensmittel, Eintrag {food.fdc}) – kein Vorrat, kein Preis.</p>}
      {stock !== undefined && stock > 0 && <p className={styles.sourceNote}>Wird von deinem Vorrat abgezogen (ca. {formatGrams(stock)} da).</p>}
    </Sheet>
  );
}

const macrosFor = (food: AmountFood, grams: number) => (isDb(food) ? scaleMacros(food.per100, grams / 100) : foodMacros(food, grams));
