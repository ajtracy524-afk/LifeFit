import { useMemo, useState } from 'react';
import type { DbFood } from '../../data/foodDb';
import { formatCostRange, priceLookup } from '../../domain/costs';
import { dishCostRange, dishNutrition, dishPortionNutrition, ingredientFromDb, ingredientFromFood, ingredientFromProduct, validateDish, type DishErrors } from '../../domain/dishes';
import type { CustomDish, DishIngredient, Food, MealSlot, Product } from '../../domain/types';
import type { DishDraft } from '../../domain/dishes';
import { fmt, SLOT_LABEL } from '../../lib/format';
import { newId } from '../../lib/id';
import { withUndo } from '../../lib/undo';
import { celebrate } from '../../lib/celebrate';
import { deleteDish, saveDish } from '../../store/actions';
import { useAppState } from '../../store/store';
import { Button, IconButton } from '../../components/ui/Button';
import { Chip, Field, Stepper } from '../../components/ui/Controls';
import { Icon } from '../../components/ui/Icon';
import { Sheet } from '../../components/ui/Sheet';
import { MicroLine, NutrientGrid } from './ProductConfirm';
import { matchesQuery } from '../../services/foodDatabase';
import { useFoodSearch } from './useFoodSearch';
import { useEnergyText } from './useEnergyText';
import styles from './nutrition.module.css';

/** The dish saved last – its row enters "Meine Gerichte" with a short highlight (a few seconds only). */
let lastSaved: { id: string; at: number } | undefined;
const isFresh = (id: string) => !!lastSaved && lastSaved.id === id && Date.now() - lastSaved.at < 8000;

const PLAN_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

const SOURCE_LABEL: Record<DishIngredient['source'], string> = { catalog: 'Katalog', database: 'Datenbank', product: 'Produkt', manual: 'Eigene Angabe' };
const perPortionLine = (dish: CustomDish, kcal: (n: number) => string) => {
  const m = dishPortionNutrition(dish, 1).macros;
  return `${kcal(m.kcal)} · ${fmt.int(m.protein)} g P · ${fmt.int(m.carbs)} g KH · ${fmt.int(m.fat)} g F pro Portion`;
};

/** "Meine Gerichte" – own dishes, one tap to log; with a filter once there are many. */
export function DishList({ onPick, onCreate }: { onPick: (dish: CustomDish) => void; onCreate: () => void }) {
  const state = useAppState();
  const energy = useEnergyText();
  const [filter, setFilter] = useState('');
  const all = useMemo(() => Object.values(state.customDishes ?? {}).filter((d) => !d.archived).sort((a, b) => a.name.localeCompare(b.name, 'de')), [state.customDishes]);
  const shown = filter.trim() ? all.filter((d) => matchesQuery(d.name, filter)) : all;
  return (
    <section className={styles.dishSection} aria-label="Meine Gerichte">
      <div className={styles.dishHead}>
        <h3 className={styles.listCaption}>Meine Gerichte{all.length ? ` · ${all.length}` : ''}</h3>
        <Button size="sm" variant="secondary" icon="plus" onClick={onCreate} className={styles.tapTarget}>
          Eigenes Gericht erstellen
        </Button>
      </div>
      {all.length === 0 ? (
        <p className={styles.searchHint}>Speichere ein Gericht einmal mit seinen Zutaten – LifeFit rechnet die Nährwerte aus, danach erfasst du es mit einem Tipp.</p>
      ) : (
        <>
          {all.length > 6 && (
            <label className={styles.search}>
              <Icon name="search" size={18} />
              <span className="visually-hidden">Meine Gerichte filtern</span>
              <input type="search" placeholder="Gericht suchen" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </label>
          )}
          <ul className={styles.optionList}>
            {shown.map((dish) => (
              <li key={dish.id} className={isFresh(dish.id) ? styles.rowNew : undefined}>
                <button type="button" className={styles.optionRow} onClick={() => onPick(dish)}>
                  <span className={styles.mealText}>
                    <span className={styles.mealTitle}>🍽️ {dish.name}</span>
                    <span className={styles.mealMeta}>{perPortionLine(dish, energy.kcal)}</span>
                  </span>
                  <Icon name="plus" size={18} className={styles.muted} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Choose the portion of an own dish, see what it brings, add it (or edit the dish). */
export function DishPortionSheet({
  dish,
  subtitle,
  onBack,
  onClose,
  onEdit,
  onAdd,
}: {
  dish: CustomDish;
  subtitle: string;
  onBack: () => void;
  onClose: () => void;
  onEdit: () => void;
  onAdd: (portions: number, id: string) => void;
}) {
  const state = useAppState();
  const [portions, setPortions] = useState(1);
  const [id] = useState(newId);
  const n = dishPortionNutrition(dish, portions);
  const cost = dishCostRange(dish, portions, priceLookup(state.products));
  return (
    <Sheet
      open
      onClose={onClose}
      title={dish.name}
      subtitle={subtitle}
      footer={
        <>
          <Button variant="secondary" onClick={onBack}>
            Zurück
          </Button>
          <Button block icon="plus" onClick={() => onAdd(portions, id)}>
            Hinzufügen
          </Button>
        </>
      }
    >
      <div className={styles.amountBlock}>
        <Stepper label="Portionen" value={portions} onChange={setPortions} step={0.5} min={0.5} max={6} format={(v) => fmt.servings(v)} />
        <p className={styles.muted}>Das Gericht ergibt {fmt.servings(dish.portions)}.</p>
      </div>
      <NutrientGrid macros={n.macros} unknown={n.unknown} />
      <MicroLine micros={n.micros} />
      {cost && <p className={styles.sourceNote}>Kosten {formatCostRange(cost)} (aus deinen Preisen und Durchschnittspreisen)</p>}
      <p className={styles.dishIngredients}>{dish.ingredients.map((i) => `${i.name} ${fmt.g(i.grams)}`).join(' · ')}</p>
      <Button variant="ghost" size="sm" icon="edit" onClick={onEdit}>
        Gericht bearbeiten
      </Button>
    </Sheet>
  );
}

/**
 * Create or edit an own dish: name, portions, ingredients with amounts. All
 * nutrients are computed live from the ingredients (domain/dishes.ts).
 * Saving never touches entries that were already logged.
 */
export function DishEditorSheet({
  dish,
  initial,
  skipped = [],
  onSaved,
  onCancel,
  onClose,
}: {
  dish?: CustomDish;
  /** Prefilled new dish (e.g. "Als Gericht speichern" from an eaten meal). */
  initial?: DishDraft;
  /** Parts of an eaten meal that could not become ingredients (no amount) – named, never guessed. */
  skipped?: string[];
  onSaved: (dishId: string | undefined) => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const start = dish ?? initial;
  const energy = useEnergyText();
  const [name, setName] = useState(start?.name ?? '');
  const [portions, setPortions] = useState(start?.portions ?? 1);
  const [ingredients, setIngredients] = useState<DishIngredient[]>(start?.ingredients.map((i) => ({ ...i })) ?? []);
  const [slots, setSlots] = useState<MealSlot[]>(start?.slots ?? []);
  const [prepMin, setPrepMin] = useState(start?.prepMin ?? 15);
  const [picking, setPicking] = useState(!start?.ingredients.length);
  const [errors, setErrors] = useState<DishErrors>({});

  const whole = dishNutrition(ingredients);
  const portion = dishNutrition(ingredients, portions > 0 ? 1 / portions : 0);
  const microCount = Object.keys(portion.micros).filter((k) => !['fiber', 'sugar', 'salt'].includes(k)).length;
  const someWithoutMicros = ingredients.some((i) => !i.micros100 || Object.keys(i.micros100).length === 0);

  const add = (ing: DishIngredient | undefined) => {
    if (!ing) return;
    setIngredients((list) => [...list, ing]);
    setPicking(false);
    setErrors({});
  };
  const setGrams = (id: string, grams: number) => setIngredients((list) => list.map((i) => (i.id === id ? { ...i, grams } : i)));

  const save = () => {
    const draft: DishDraft = { name, portions, ingredients, ...(slots.length ? { slots, prepMin } : {}) };
    const e = validateDish(draft);
    if (Object.keys(e).length) return setErrors(e);
    let saved: string | undefined;
    const ok = withUndo(dish ? `${name.trim()} gespeichert – bereits erfasste Mahlzeiten bleiben unverändert` : `${name.trim()} gespeichert`, () => {
      saved = saveDish(draft, dish?.id);
      return !!saved;
    });
    if (ok && saved) {
      lastSaved = { id: saved, at: Date.now() };
      celebrate({ kind: 'dish', icon: '🍽️', title: dish ? 'Gericht aktualisiert' : 'Gericht gespeichert', detail: 'Ab jetzt mit einem Tipp erfassbar', level: 2 });
    }
    onSaved(saved);
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={dish ? 'Gericht bearbeiten' : 'Eigenes Gericht'}
      subtitle="Nährwerte werden aus den Zutaten berechnet"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Abbrechen
          </Button>
          <Button block icon="check" onClick={save}>
            Speichern
          </Button>
        </>
      }
    >
      <div className={styles.quickForm}>
        {skipped.length > 0 && (
          <p className={styles.sourceNote} role="status">
            Nicht übernommen (ohne Mengenangabe): {skipped.join(', ')} – bei Bedarf unten als Zutat hinzufügen.
          </p>
        )}
        <Field label="Name" placeholder="z. B. Melonen-Sandwich" value={name} error={errors.name} onChange={(e) => (setName(e.target.value), setErrors({}))} />
        <Stepper label="Ergibt" value={portions} onChange={setPortions} step={0.5} min={0.5} max={12} format={(v) => fmt.servings(v)} />

        <div>
          <p className={styles.fieldLabel}>Zutaten</p>
          {ingredients.length > 0 && (
            <ul className={styles.ingredientList} aria-label="Zutaten">
              {ingredients.map((i) => (
                <li key={i.id} className={styles.ingredientRow}>
                  <span className={styles.mealText}>
                    <span className={styles.mealTitle}>{i.name}</span>
                    <span className={styles.mealMeta}>
                      {SOURCE_LABEL[i.source]}{energy.numberFree ? '' : ` · ${fmt.kcal(((i.per100.kcal ?? 0) * i.grams) / 100)}`}
                    </span>
                  </span>
                  <label className={styles.gramsInput}>
                    <span className="visually-hidden">{i.name}: Menge in g</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={1}
                      step={5}
                      value={Number.isFinite(i.grams) ? i.grams : ''}
                      onChange={(e) => setGrams(i.id, Number(e.target.value.replace(',', '.')))}
                    />
                    <span aria-hidden>g</span>
                  </label>
                  <IconButton icon="trash" label={`${i.name} entfernen`} onClick={() => setIngredients((list) => list.filter((x) => x.id !== i.id))} />
                </li>
              ))}
            </ul>
          )}
          {errors.ingredients && <p className={styles.fieldError}>{errors.ingredients}</p>}
          {picking ? (
            <IngredientPicker onFood={(f) => add(ingredientFromFood(f, f.pieceG ?? 100, newId()))} onDb={(f) => add(ingredientFromDb(f, 100, newId()))} onProduct={(p) => add(ingredientFromProduct(p, p.servingSize ?? 100, newId()))} onClose={ingredients.length ? () => setPicking(false) : undefined} />
          ) : (
            <Button variant="secondary" size="sm" icon="plus" onClick={() => setPicking(true)} className={styles.tapTarget}>
              Zutat hinzufügen
            </Button>
          )}
        </div>

        {ingredients.length > 0 && (
          <div className={styles.dishTotals} aria-label="Nährwerte des Gerichts">
            <p className={styles.fieldLabel}>Pro Portion</p>
            <NutrientGrid macros={portion.macros} unknown={portion.unknown} />
            <MicroLine micros={portion.micros} />
            <p className={styles.sourceNote}>
              Ganzes Gericht: {energy.numberFree ? '' : `${fmt.kcal(whole.macros.kcal)} · `}{fmt.int(whole.macros.protein)} g P · {fmt.int(whole.macros.carbs)} g KH · {fmt.int(whole.macros.fat)} g F
              {microCount > 0 ? ` · ${microCount} Vitamine/Mineralstoffe vollständig` : ''}
            </p>
            {someWithoutMicros && <p className={styles.sourceNote}>Nicht jede Zutat hat Mikronährstoff-Daten – diese Werte bleiben offen statt 0.</p>}
          </div>
        )}

        <div className={styles.dishPlan}>
          <p className={styles.fieldLabel}>Im Wochenplan vorschlagen (optional)</p>
          <div className={styles.chipRow} role="group" aria-label="Im Wochenplan vorschlagen für">
            {PLAN_SLOTS.map((slot) => (
              <Chip key={slot} selected={slots.includes(slot)} onClick={() => setSlots((list) => (list.includes(slot) ? list.filter((x) => x !== slot) : [...list, slot]))}>
                {SLOT_LABEL[slot]}
              </Chip>
            ))}
          </div>
          {slots.length > 0 && <Stepper label="Zubereitung" value={prepMin} onChange={setPrepMin} step={5} min={5} max={120} format={(v) => `${v} min`} />}
          <p className={styles.sourceNote}>
            {slots.length === 0
              ? 'Ohne Auswahl erfasst du das Gericht nur selbst – der Planer schlägt es nicht vor.'
              : portion.unknown.length
                ? 'Für den Wochenplan braucht jede Zutat Kalorien und Makros – ergänze sie oder wähle andere Zutaten.'
                : 'Der Planer schlägt es für diese Mahlzeiten vor – bewertet wie jedes Rezept (Ziele, Zeit, Budget, Vorrat, Vorlieben).'}
          </p>
        </div>

        {dish && (
          <Button
            variant="ghost"
            size="sm"
            icon="trash"
            onClick={() => {
              withUndo(`${dish.name} gelöscht – erfasste Mahlzeiten bleiben`, () => deleteDish(dish.id));
              onSaved(undefined);
            }}
          >
            Gericht löschen
          </Button>
        )}
      </div>
    </Sheet>
  );
}

/** Search for an ingredient – same sources as "Suchen", without own dishes and only with calories. */
function IngredientPicker({ onFood, onDb, onProduct, onClose }: { onFood: (f: Food) => void; onDb: (f: DbFood) => void; onProduct: (p: Product) => void; onClose?: () => void }) {
  const [query, setQuery] = useState('');
  const energy = useEnergyText();
  const kcal100 = (n: number, unit = 'g') => (energy.numberFree ? '' : ` · ${fmt.int(n)} kcal / 100 ${unit}`);
  const found = useFoodSearch(query, { dishes: false });
  const products = found.products.filter((p) => p.per100.kcal !== undefined);
  const nothing = query.trim().length >= 2 && !found.loading && !products.length && !found.catalog.length && !found.database.length;
  return (
    <div className={styles.picker}>
      <div className={styles.pickerHead}>
        <label className={styles.search}>
          <Icon name="search" size={18} />
          <span className="visually-hidden">Zutat suchen</span>
          <input type="search" autoFocus placeholder="Zutat suchen, z. B. Melone" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {onClose && <IconButton icon="close" label="Zutatensuche schliessen" onClick={onClose} />}
      </div>
      {found.loading && <p className={styles.searchHint}>Datenbank wird geladen …</p>}
      {found.failed && <p className={styles.searchHint}>Die erweiterte Datenbank konnte nicht geladen werden – Katalog und deine Produkte funktionieren weiterhin.</p>}
      {nothing && <p className={styles.searchHint}>Nichts gefunden. Scanne das Produkt einmal (Barcode) – danach steht es hier als Zutat zur Verfügung.</p>}
      <ul className={styles.optionList}>
        {products.map((p) => (
          <PickRow key={`p-${p.barcode}`} title={p.name} meta={`Produkt${p.brand ? ` · ${p.brand}` : ''}${kcal100(p.per100.kcal!, p.unit)}`} onClick={() => onProduct(p)} />
        ))}
        {found.catalog.map((f) => (
          <PickRow key={`f-${f.id}`} title={f.name} meta={`Katalog${kcal100(f.per100.kcal)}`} onClick={() => onFood(f)} />
        ))}
        {found.database.map((f) => (
          <PickRow key={f.id} title={f.name} meta={`Datenbank${kcal100(f.per100.kcal)}`} onClick={() => onDb(f)} />
        ))}
      </ul>
    </div>
  );
}

function PickRow({ title, meta, onClick }: { title: string; meta: string; onClick: () => void }) {
  return (
    <li>
      <button type="button" className={styles.optionRow} onClick={onClick} aria-label={`${title} als Zutat hinzufügen`}>
        <span className={styles.mealText}>
          <span className={styles.mealTitle}>{title}</span>
          <span className={styles.mealMeta}>{meta}</span>
        </span>
        <Icon name="plus" size={18} className={styles.muted} />
      </button>
    </li>
  );
}
