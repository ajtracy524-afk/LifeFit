import { useMemo, useState } from 'react';
import { formatChf, PRICE_RANGE_TEXT } from '../../domain/costs';
import { today, weekStart } from '../../domain/dates';
import { productFoodId } from '../../domain/dishes';
import type { Allergen, Product } from '../../domain/types';
import { celebrate } from '../../lib/celebrate';
import { fmt, formatGrams } from '../../lib/format';
import { applyWithUndo, withUndo } from '../../lib/undo';
import { matchesQuery } from '../../services/foodDatabase';
import { createProduct, deleteProduct, updateProduct } from '../../store/actions';
import { getState, useAppState } from '../../store/store';
import { Button, IconButton } from '../../components/ui/Button';
import { Chip, Field, Segmented, parseNumber } from '../../components/ui/Controls';
import { Icon } from '../../components/ui/Icon';
import { Sheet } from '../../components/ui/Sheet';
import { useEnergyText } from './useEnergyText';
import styles from './nutrition.module.css';

/** "500 g · CHF 1.19" – pack and the user's own price (never a price from the product source). */
export function productMeta(p: Product): string {
  const u = p.unit;
  const pack = p.packageSize ? `${p.packageSize >= 1000 ? formatGrams(p.packageSize).replace(' kg', u === 'ml' ? ' L' : ' kg') : `${fmt.int(p.packageSize)} ${u}`}` : undefined;
  const price = p.price ? `${formatChf(p.price.chf)}${p.packageSize && p.price.amount === p.packageSize ? '' : ` / ${fmt.int(p.price.amount)} ${u}`}` : 'ohne Preis';
  return [p.brand, pack, price].filter(Boolean).join(' · ');
}

/**
 * "Meine Produkte": the products the user scanned or created – the local
 * product cache, shown as a library. Tap = eat it (the usual product flow),
 * pencil = own data (name, pack, CHF price). One product model, no copy.
 */
export function ProductList({ onPick, onEdit, onCreate }: { onPick: (p: Product) => void; onEdit: (p: Product) => void; onCreate: () => void }) {
  const state = useAppState();
  const [filter, setFilter] = useState('');
  const all = useMemo(() => Object.values(state.products ?? {}).sort((a, b) => a.name.localeCompare(b.name, 'de')), [state.products]);
  const shown = filter.trim() ? all.filter((p) => matchesQuery(`${p.name} ${p.brand ?? ''}`, filter)) : all;
  return (
    <section className={styles.dishSection} aria-label="Meine Produkte">
      <div className={styles.dishHead}>
        <h3 className={styles.listCaption}>Meine Produkte{all.length ? ` · ${all.length}` : ''}</h3>
        <Button size="sm" variant="secondary" icon="plus" onClick={onCreate} className={styles.tapTarget}>
          Produkt anlegen
        </Button>
      </div>
      {all.length === 0 ? (
        <p className={styles.searchHint}>Gescannte Produkte landen hier – mit deinem Preis in CHF und der Packungsgrösse für Einkauf, Budget und eigene Gerichte.</p>
      ) : (
        <>
          {all.length > 6 && (
            <label className={styles.search}>
              <Icon name="search" size={18} />
              <span className="visually-hidden">Meine Produkte filtern</span>
              <input type="search" placeholder="Produkt suchen" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </label>
          )}
          <ul className={styles.optionList}>
            {shown.map((p) => (
              <li key={p.barcode} className={styles.productRow}>
                <button type="button" className={styles.optionRow} onClick={() => onPick(p)} aria-label={`${p.name} erfassen`}>
                  <span className={styles.mealText}>
                    <span className={styles.mealTitle}>{p.name}</span>
                    <span className={styles.mealMeta}>{productMeta(p)}</span>
                  </span>
                </button>
                <IconButton icon="edit" label={`${p.name} bearbeiten`} onClick={() => onEdit(p)} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

const num = (text: string) => (text.trim() ? parseNumber(text) : undefined);

const ALLERGENS: { id: Allergen; label: string }[] = [
  { id: 'lactose', label: 'Laktose' },
  { id: 'gluten', label: 'Gluten' },
  { id: 'nuts', label: 'Nüsse' },
  { id: 'fish', label: 'Fisch' },
];
type DietChoice = 'unknown' | 'vegan' | 'vegetarian' | 'meat';
const DIET_OPTIONS: { value: DietChoice; label: string }[] = [
  { value: 'unknown', label: 'Unbekannt' },
  { value: 'vegan', label: 'Vegan' },
  { value: 'vegetarian', label: 'Vegetarisch' },
  { value: 'meat', label: 'Fleisch/Fisch' },
];
/** What the choice states – "Unbekannt" states nothing (no guessing from the name). */
const DIET: Record<DietChoice, NonNullable<Product['diet']>> = {
  unknown: {},
  vegan: { vegan: true, vegetarian: true },
  vegetarian: { vegan: false, vegetarian: true },
  meat: { vegan: false, vegetarian: false },
};
function currentDiet(p: Product | undefined): DietChoice {
  if (p?.diet?.vegan) return 'vegan';
  if (p?.diet?.vegetarian) return 'vegetarian';
  if (p?.diet?.vegetarian === false) return 'meat';
  return 'unknown';
}
/** Where the values come from – the origin stays visible after a correction. */
function origin(p: Product): string {
  const src = p.source === 'openfoodfacts' ? 'Nährwerte: Open Food Facts' : 'Eigenes Produkt';
  return p.nutrientsEdited ? `${src} · von dir korrigiert` : `${src} · Preis: deine Angabe`;
}
const validPrice = (v: number | undefined) => v === undefined || (Number.isFinite(v) && v >= 0.05 && v <= 1000);

/**
 * Own data of a product: name, brand, pack size, pack price in CHF – plus
 * "in den Vorrat" (one pack, via the existing purchase path) and delete.
 * Without `product` it creates an own product (values per 100 g/ml from the
 * pack – kcal required, the rest optional and otherwise unknown, never 0).
 */
export function ProductEditSheet({
  product,
  onDone,
  onCancel,
  onClose,
}: {
  product?: Product;
  onDone: (barcode: string | undefined) => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const isNew = !product;
  const numberFree = useEnergyText().numberFree;
  const [name, setName] = useState(product?.name ?? '');
  const [brand, setBrand] = useState(product?.brand ?? '');
  const [unit, setUnit] = useState<Product['unit']>(product?.unit ?? 'g');
  const [pack, setPack] = useState(product?.packageSize ? String(product.packageSize) : '');
  const [price, setPrice] = useState(product?.price && product.price.amount === product.packageSize ? String(product.price.chf) : '');
  // Nutrients per 100 g/ml as text – prefilled with what is known; an empty field is "unknown", never 0.
  const initialValues = useMemo(() => {
    const t = (v: number | undefined) => (v === undefined ? '' : String(v));
    return {
      kcal: t(product?.per100.kcal),
      protein: t(product?.per100.protein),
      carbs: t(product?.per100.carbs),
      fat: t(product?.per100.fat),
      fiber: t(product?.micros100.fiber),
      sugar: t(product?.micros100.sugar),
      salt: t(product?.micros100.salt),
    };
  }, [product]);
  const [values, setValues] = useState(initialValues);
  const [allergens, setAllergens] = useState<Allergen[]>(product?.allergens ?? []);
  const [diet, setDiet] = useState<DietChoice | undefined>(undefined);
  const [error, setError] = useState<string | undefined>();
  const u = product?.unit ?? unit;

  const save = () => {
    const packSize = num(pack);
    const packPrice = num(price);
    if (!name.trim()) return setError('Bitte einen Namen angeben.');
    if (packSize !== undefined && !(packSize > 0 && packSize <= 100000)) return setError('Bitte eine gültige Packungsgrösse angeben.');
    if (!validPrice(packPrice)) return setError(`Bitte einen Preis ${PRICE_RANGE_TEXT} angeben.`);
    if (packPrice !== undefined && packSize === undefined) return setError('Für einen Packungspreis braucht es die Packungsgrösse.');
    const kcal = num(values.kcal);
    if (kcal === undefined || !(kcal >= 0 && kcal <= 900)) return setError('Kalorien pro 100 ' + u + ' sind nötig (0–900).');
    const opt = (k: keyof typeof values) => {
      const v = num(values[k]);
      return v !== undefined && Number.isFinite(v) && v >= 0 ? v : undefined;
    };
    if ((['protein', 'carbs', 'fat', 'fiber', 'sugar', 'salt'] as const).some((k) => values[k].trim() && opt(k) === undefined))
      return setError('Bitte nur Zahlen ab 0 eingeben – oder das Feld leer lassen (= unbekannt).');
    const per100: Product['per100'] = { kcal: Math.round(kcal) };
    for (const k of ['protein', 'carbs', 'fat'] as const) if (opt(k) !== undefined) per100[k] = opt(k);
    // Vitamins/minerals of the source stay; only fiber, sugar and salt are edited here.
    const { fiber: _f, sugar: _s, salt: _t, ...otherMicros } = product?.micros100 ?? {};
    const micros100: Product['micros100'] = { ...otherMicros };
    for (const k of ['fiber', 'sugar', 'salt'] as const) if (opt(k) !== undefined) micros100[k] = opt(k);
    const nutrientsTouched = (Object.keys(values) as (keyof typeof values)[]).some((k) => values[k].trim() !== initialValues[k]);
    if (isNew) {
      let key: string | undefined;
      withUndo(`${name.trim()} angelegt`, () => {
        key = createProduct({
          name: name.trim(),
          ...(brand.trim() ? { brand: brand.trim() } : {}),
          per100,
          micros100,
          unit,
          ...(packSize ? { packageSize: packSize } : {}),
          ...(packSize && packPrice ? { price: { chf: Math.round(packPrice * 100) / 100, amount: packSize, at: new Date().toISOString() } } : {}),
          ...(allergens.length ? { allergens } : {}),
          ...(diet && diet !== 'unknown' ? { diet: DIET[diet] } : {}),
        });
        return true;
      });
      celebrate({ kind: 'check', icon: '✓', title: 'Produkt gespeichert', detail: 'Für Einkauf, Budget und eigene Gerichte', level: 1 });
      return onDone(key);
    }
    const patch = {
      name,
      brand,
      packageSize: packSize ?? null,
      ...(packPrice !== undefined ? { packPriceChf: packPrice } : {}),
      ...(nutrientsTouched ? { per100, micros100 } : {}),
      allergens,
      ...(diet ? { diet: DIET[diet] } : {}),
    };
    if (withUndo(`${name.trim()} gespeichert`, () => updateProduct(product.barcode, patch))) {
      celebrate({ kind: 'check', icon: '✓', title: 'Produkt gespeichert', detail: packPrice ? `${formatChf(packPrice)} pro Packung` : undefined, level: 1 });
    }
    onDone(product.barcode);
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={isNew ? 'Produkt anlegen' : 'Produkt bearbeiten'}
      subtitle={isNew ? 'Werte von der Verpackung, pro 100 ' + unit : origin(product)}
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
        <Field label="Name" value={name} onChange={(e) => (setName(e.target.value), setError(undefined))} />
        <Field label="Marke (optional)" value={brand} onChange={(e) => setBrand(e.target.value)} />
        {isNew && (
          <Segmented<Product['unit']>
            label="Einheit"
            value={unit}
            onChange={setUnit}
            options={[
              { value: 'g', label: 'Gramm' },
              { value: 'ml', label: 'Milliliter' },
            ]}
          />
        )}
        <div className={styles.formRow}>
          <Field label="Packungsgrösse" inputMode="decimal" suffix={u} value={pack} onChange={(e) => (setPack(e.target.value), setError(undefined))} />
          <Field label="Packungspreis" inputMode="decimal" suffix="CHF" value={price} onChange={(e) => (setPrice(e.target.value), setError(undefined))} />
        </div>
        <p className={styles.fieldLabel}>Nährwerte pro 100 {u} – leer = unbekannt</p>
        {/* Number-free mode (E14): label data is still needed to count – it is not shown back as numbers. */}
        {numberFree && <p className={styles.sourceNote}>Die Werte von der Verpackung braucht LifeFit zum Rechnen – angezeigt bekommst du danach Portionen, keine Kalorienzahlen.</p>}
        {
          <div className={styles.formGrid}>
            {(['kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'salt'] as const).map((k) => (
              <Field
                key={k}
                label={{ kcal: 'Kalorien', protein: 'Protein', carbs: 'Kohlenhydrate', fat: 'Fett', fiber: 'Ballaststoffe', sugar: 'Zucker', salt: 'Salz' }[k]}
                inputMode="decimal"
                suffix={k === 'kcal' ? 'kcal' : 'g'}
                value={values[k]}
                onChange={(e) => (setValues((v) => ({ ...v, [k]: e.target.value })), setError(undefined))}
              />
            ))}
          </div>
        }
        <div>
          <p className={styles.fieldLabel}>Enthält (für deine Ausschlüsse)</p>
          <div className={styles.chipRow} role="group" aria-label="Enthält">
            {ALLERGENS.map((a) => (
              <Chip key={a.id} selected={allergens.includes(a.id)} onClick={() => setAllergens((list) => (list.includes(a.id) ? list.filter((x) => x !== a.id) : [...list, a.id]))}>
                {a.label}
              </Chip>
            ))}
          </div>
        </div>
        <Segmented<DietChoice> label="Ernährungsform" value={diet ?? currentDiet(product)} onChange={setDiet} options={DIET_OPTIONS} />
        {error && (
          <p className={styles.fieldError} role="alert">
            {error}
          </p>
        )}
        <p className={styles.sourceNote}>Preise sind deine eigenen Angaben in CHF – Open Food Facts liefert keine Preise. Eingekauft wird immer ganze Packungen.</p>

        {!isNew && (
          <div className={styles.productActions}>
            {product.packageSize && (
              <Button
                size="sm"
                variant="secondary"
                icon="cart"
                className={styles.tapTarget}
                onClick={() => {
                  const foodId = product.foodId ?? productFoodId(product.barcode);
                  if (applyWithUndo({ type: 'purchase', week: weekStart(today()), foodId, grams: Math.round(product.packageSize!) })) onDone(product.barcode);
                }}
              >
                1 Packung in den Vorrat
              </Button>
            )}
            {product.price && (
              <Button
                size="sm"
                variant="ghost"
                className={styles.tapTarget}
                onClick={() => withUndo('Preis entfernt', () => updateProduct(product.barcode, { packPriceChf: null })) && setPrice('')}
              >
                Preis entfernen
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              icon="trash"
              className={styles.tapTarget}
              onClick={() => {
                withUndo(`${product.name} entfernt – erfasste Mahlzeiten und Gerichte bleiben`, () => deleteProduct(product.barcode));
                onDone(undefined);
              }}
            >
              Produkt löschen
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** Is this barcode already in "Meine Produkte"? (for the "Bekanntes Produkt" hint) */
export const isKnownProduct = (barcode: string) => !!getState().products?.[barcode];
