import { useState } from 'react';
import { getFood } from '../../data/foods';
import { formatChf } from '../../domain/costs';
import { productAmountOptions, productNutrients, suggestCatalogFoods } from '../../domain/foodEntry';
import type { Macros, MacroKey, Micros, Product } from '../../domain/types';
import { pantryEstimate } from '../../domain/week';
import { fmt, formatGrams } from '../../lib/format';
import { newId } from '../../lib/id';
import { useAppState } from '../../store/store';
import { Chip, Field, Stepper, parseNumber } from '../../components/ui/Controls';
import { Icon } from '../../components/ui/Icon';
import { isKnownProduct, productMeta } from './Products';
import { Button } from '../../components/ui/Button';
import styles from './nutrition.module.css';

export interface ProductChoice {
  /** Fixed when the screen opened – a double tap logs once. */
  id: string;
  amount: number;
  foodId: string | null;
  fromPantry: boolean;
  /** Entered price: CHF for `amount` (the package if its size is known, otherwise the chosen amount). */
  price?: { chf: number; amount: number };
}

interface Props {
  product: Product;
  /** Renders the confirm button – the caller decides what happens (eat or buy). */
  footer: (choice: ProductChoice | null) => React.ReactNode;
  /** Calories missing → the user completes the product by hand. */
  onComplete: () => void;
  /** "purchase": amount defaults to the package, pantry toggle is not shown. */
  purpose?: 'eat' | 'purchase';
  /** Opens the own-data editor (name, pack, CHF price) – shown for products already in "Meine Produkte". */
  onEdit?: () => void;
}

/**
 * Check & confirm a scanned product: amount (100 g, portion, package or
 * free), nutrients recalculated for that amount, and – optionally – which
 * LifeFit food it is, so pantry, shopping and learning can use it.
 */
export function ProductConfirm({ product, footer, onComplete, purpose = 'eat', onEdit }: Props) {
  // Scanned before: it came from the local cache (no request) – say so, with the user's own pack and price.
  const known = isKnownProduct(product.barcode);
  const state = useAppState();
  const options = productAmountOptions(product);
  const initial = purpose === 'purchase' ? (product.packageSize ?? 100) : (product.servingSize ?? 100);
  const [amountText, setAmountText] = useState(String(initial));
  const [id] = useState(newId);
  const suggestions = suggestCatalogFoods(`${product.name} ${product.brand ?? ''}`);
  const linked = product.foodId ? getFood(product.foodId) : undefined;
  const candidates = linked && !suggestions.some((f) => f.id === linked.id) ? [linked, ...suggestions] : suggestions;
  const [foodId, setFoodId] = useState<string | null>(product.foodId ?? null);
  const stock = foodId ? (pantryEstimate(state)[foodId] ?? 0) : 0;
  const [fromPantry, setFromPantry] = useState(true);

  const amount = parseNumber(amountText);
  const validAmount = Number.isFinite(amount) && amount > 0 && amount <= 5000;
  const nutrients = validAmount ? productNutrients(product, amount) : undefined;
  const u = product.unit;
  // Optional real price – for the package if its size is known, otherwise for the chosen amount.
  const priceBase = product.packageSize ?? (validAmount ? amount : undefined);
  const [priceText, setPriceText] = useState(product.price && product.price.amount === product.packageSize ? String(product.price.chf) : '');
  const priceValue = parseNumber(priceText);
  const priceValid = priceText.trim() === '' || (Number.isFinite(priceValue) && priceValue >= 0.05 && priceValue <= 1000);
  const typed = priceText.trim() && priceValid && priceBase ? { chf: Math.round(priceValue * 100) / 100, amount: priceBase } : undefined;
  // Only a new or corrected price is saved – an unchanged remembered price stays as it was.
  const price = typed && !(product.price && product.price.chf === typed.chf && product.price.amount === typed.amount) ? typed : undefined;
  const choice: ProductChoice | null =
    validAmount && priceValid && (nutrients || purpose === 'purchase') ? { id, amount, foodId, fromPantry: stock > 0 ? fromPantry : true, ...(price ? { price } : {}) } : null;

  return (
    <>
      {known && (
        <div className={styles.knownProduct}>
          <span>✓ Bekanntes Produkt · {productMeta(product)}</span>
          {onEdit && (
            <Button size="sm" variant="ghost" icon="edit" onClick={onEdit}>
              Preis & Packung
            </Button>
          )}
        </div>
      )}
      <div className={styles.productHead}>
        {product.imageUrl ? (
          <img className={styles.productImage} src={product.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <span className={styles.productPlaceholder} aria-hidden>
            <Icon name="barcode" size={24} />
          </span>
        )}
        <div className={styles.mealText}>
          <strong className={styles.mealTitle}>{product.name}</strong>
          <span className={styles.mealMeta}>
            {[product.brand, `Barcode ${product.barcode}`].filter(Boolean).join(' · ')}
          </span>
        </div>
      </div>

      {product.per100.kcal === undefined && purpose === 'eat' && (
        <div className={styles.notice}>
          Für dieses Produkt fehlen die Kalorien in der Datenbank. LifeFit rechnet keine Werte aus –{' '}
          <button type="button" className={styles.moreToggle} onClick={onComplete}>
            von der Verpackung ergänzen
          </button>
        </div>
      )}

      <p className={styles.fieldLabel}>Menge</p>
      <div className={styles.chipRow}>
        {options.map((o) => (
          <Chip key={o.label} selected={validAmount && amount === o.amount} onClick={() => setAmountText(String(o.amount))}>
            {o.label}
          </Chip>
        ))}
      </div>
      {product.servingSize && purpose === 'eat' && (
        // Counting portions (e.g. 2 Becher) – only when the product states its portion size.
        <div className={styles.portionRow}>
          <span>Portionen à {fmt.dec(product.servingSize)} {u}</span>
          <Stepper
            label="Portionen"
            value={validAmount ? Math.round((amount / product.servingSize) * 2) / 2 : 1}
            onChange={(n) => setAmountText(String(Math.round(n * product.servingSize! * 10) / 10))}
            step={0.5}
            min={0.5}
            max={20}
            format={(n) => (n === 1 ? '1 Portion' : `${fmt.dec(n)} Portionen`)}
          />
        </div>
      )}
      <Field label={`Menge in ${u}`} inputMode="decimal" suffix={u} value={amountText} error={amountText && !validAmount ? 'Bitte eine Menge zwischen 1 und 5000 angeben.' : undefined} onChange={(e) => setAmountText(e.target.value)} className={styles.amountField} />

      {purpose === 'eat' && (
        <>
          <NutrientGrid macros={nutrients?.macros} unknown={nutrients?.unknown ?? []} />
          <MicroLine micros={nutrients?.micros} />
        </>
      )}
      <p className={styles.sourceNote}>
        Nährwerte pro 100 {u} laut Open Food Facts{Object.keys(product.per100).length < 4 ? ' – nicht alle Werte angegeben' : ''}. Preise liefert die Datenbank nicht – deinen Kaufpreis kannst du unten eintragen.
      </p>

      <p className={styles.fieldLabel}>{purpose === 'purchase' ? 'Welches LifeFit-Lebensmittel ist das?' : 'Entspricht in LifeFit (optional)'}</p>
      {candidates.length > 0 ? (
        <div className={styles.chipRow}>
          {candidates.map((f) => (
            <Chip key={f.id} selected={foodId === f.id} onClick={() => setFoodId(foodId === f.id ? null : f.id)}>
              {f.name}
            </Chip>
          ))}
        </div>
      ) : (
        <p className={styles.muted}>Kein passendes Lebensmittel im LifeFit-Katalog.</p>
      )}
      <p className={styles.sourceNote}>
        {purpose === 'purchase'
          ? 'Nur so kann der Planer das Produkt aus deinem Vorrat verwenden.'
          : 'Damit zählt es für Vorrat, Einkauf und deine Vorlieben. Ohne Zuordnung wird nur gezählt, was du isst.'}
      </p>

      <Field
        label={product.packageSize ? `Packungspreis (${formatGrams(product.packageSize)}) – optional` : `Preis für ${validAmount ? fmt.int(amount) : '…'} ${u} – optional`}
        inputMode="decimal"
        suffix="CHF"
        placeholder="z. B. 4.95"
        value={priceText}
        error={priceValid ? undefined : 'Bitte einen Preis zwischen 0.05 und 1000 CHF angeben.'}
        hint={
          typed && validAmount && purpose === 'eat' && typed.amount !== amount
            ? `Deine Menge (${fmt.int(amount)} ${u}) ≈ ${formatChf((typed.chf / typed.amount) * amount)}`
            : product.price && !priceText
              ? `Zuletzt: ${formatChf(product.price.chf)} für ${fmt.int(product.price.amount)} ${u}`
              : 'Fließt in dein Budget ein – ohne Angabe nutzt LifeFit nur Schätzpreise.'
        }
        onChange={(e) => setPriceText(e.target.value)}
        className={styles.amountField}
      />

      {purpose === 'eat' && stock > 0 && (
        <label className={styles.checkRow}>
          <input type="checkbox" checked={fromPantry} onChange={(e) => setFromPantry(e.target.checked)} />
          Aus dem Vorrat genommen (ca. {formatGrams(stock)} da)
        </label>
      )}

      <div className={styles.confirmFooter}>{footer(choice)}</div>
    </>
  );
}

/** kcal and macros of an entry – unknown values show as "–", never as 0. */
export function NutrientGrid({ macros, unknown = [] }: { macros?: Macros; unknown?: MacroKey[] }) {
  const cell = (key: MacroKey) => (!macros || unknown.includes(key) ? '–' : `${fmt.dec(macros[key])} g`);
  return (
    <div className={styles.macroGrid}>
      <div className={styles.macroCellStrong}>
        <strong>{macros ? fmt.int(macros.kcal) : '–'}</strong>
        <span>kcal</span>
      </div>
      <div className={styles.macroCell}>
        <strong>{cell('protein')}</strong>
        <span>Protein</span>
      </div>
      <div className={styles.macroCell}>
        <strong>{cell('carbs')}</strong>
        <span>Kohlenh.</span>
      </div>
      <div className={styles.macroCell}>
        <strong>{cell('fat')}</strong>
        <span>Fett</span>
      </div>
    </div>
  );
}

const MICRO_LABEL = { fiber: 'Ballaststoffe', sugar: 'Zucker', salt: 'Salz' } as const;

/** Optional nutrients – only the ones that are known. */
export function MicroLine({ micros }: { micros?: Micros }) {
  const known = (['fiber', 'sugar', 'salt'] as const).filter((k) => micros?.[k] !== undefined);
  if (!known.length) return null;
  return (
    <p className={styles.microLine}>
      {known.map((k) => (
        <span key={k}>
          {MICRO_LABEL[k]} <strong>{fmt.micro(k, micros![k]!)}</strong>
        </span>
      ))}
    </p>
  );
}
