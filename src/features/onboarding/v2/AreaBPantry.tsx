import { useEffect, useRef, useState } from 'react';
import { getFood } from '../../../data/foods';
import { today } from '../../../domain/dates';
import { normalizeBarcode } from '../../../services/productLookup';
import type { PantryLevel, Product } from '../../../domain/types';
import { checklistFor, levelGrams, PICKABLE_FOODS, productViolates, suggestFoodForProduct } from '../../../domain/week/pantryOnboarding';
import { formatGrams } from '../../../lib/format';
import { showToast } from '../../../lib/toast';
import { applyWithUndo } from '../../../lib/undo';
import { cameraAvailable } from '../../../services/barcodeScanner';
import { lookupProduct } from '../../../services/productLookup';
import { addPendingScan, applyChange, removePendingScan, scanToPantry } from '../../../store/actions';
import { getState, useAppState } from '../../../store/store';
import { Button } from '../../../components/ui/Button';
import { Chip, Field, Segmented } from '../../../components/ui/Controls';
import { CameraScanner } from '../../nutrition/CameraScanner';
import styles from './onboardingV2.module.css';

/**
 * "Was hast du schon zu Hause?" (Prompt 6): the basics checklist first (fast),
 * then the serial barcode scan. Open Food Facts is asked only for a scan the
 * user makes; the pantry stays an estimate and is never filled from meals.
 */
export function PantryStep() {
  return (
    <div className={styles.stack}>
      <Checklist />
      <SerialScan />
    </div>
  );
}

// ---------- 1. Grundvorrat-Checkliste ----------

type LevelChoice = PantryLevel | 'empty';
const LEVELS: { value: LevelChoice; label: string }[] = [
  { value: 'full', label: 'voll' },
  { value: 'half', label: 'halb' },
  { value: 'rest', label: 'Rest' },
  { value: 'empty', label: 'leer' },
];

function Checklist() {
  const state = useAppState();
  const groups = checklistFor(state.nutritionProfile);
  const set = (foodId: string, choice: LevelChoice | null) => {
    const food = getFood(foodId)!;
    if (choice === null) applyChange({ type: 'setPantry', foodId, quantityG: null });
    else if (choice === 'empty') applyChange({ type: 'setPantry', foodId, quantityG: 0 });
    else applyChange({ type: 'setPantry', foodId, quantityG: levelGrams(food, choice), level: choice });
  };
  return (
    <section className={styles.stack} aria-label="Grundvorrat-Checkliste">
      <h2 className={styles.groupTitle}>Grundvorrat abhaken</h2>
      <p className={styles.hint}>Abhaken = vorhanden. Der Füllstand ist optional. Was du nicht verträgst oder nicht isst, steht hier gar nicht.</p>
      {groups.map((g) => (
        <div key={g.id} className={styles.stack} role="group" aria-label={g.label}>
          <p className={styles.label}>{g.label}</p>
          {g.items.map((item) => {
            const entry = state.pantry[item.foodId];
            const choice: LevelChoice | undefined = !entry ? undefined : entry.quantityG <= 0 ? 'empty' : (entry.level ?? 'full');
            return (
              <div key={item.foodId} className={styles.pantryRow}>
                <Chip selected={!!entry} onClick={() => set(item.foodId, entry ? null : 'full')}>
                  {item.name}
                </Chip>
                {entry && <Segmented label={`${item.name}: Füllstand`} options={LEVELS} value={choice ?? 'full'} onChange={(v) => set(item.foodId, v)} />}
                {item.staple && <span className={styles.hint}>Grundvorrat – auf der Einkaufsliste nur, wenn „leer“</span>}
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}

// ---------- 2. Barcode-Scan im Serienmodus ----------

type Scan =
  | { code: string; status: 'loading' }
  | { code: string; status: 'found'; product: Product; foodId?: string; candidates: string[]; bestBefore: string; result?: 'added' | 'flagged' }
  | { code: string; status: 'missing' | 'offline'; foodId?: string; grams: string; bestBefore: string; result?: 'added' | 'pending' };

function SerialScan() {
  const state = useAppState();
  const [camera, setCamera] = useState(false);
  const [sound, setSound] = useState(false);
  const [code, setCode] = useState('');
  const [scans, setScans] = useState<Scan[]>([]);
  const alive = useRef(true);
  // Set on every mount (StrictMode mounts twice) – a late lookup after leaving is dropped.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const patch = (c: string, next: Partial<Scan>) => setScans((list) => list.map((s) => (s.code === c ? ({ ...s, ...next } as Scan) : s)));

  /** Only here – on the user's scan – is Open Food Facts asked. */
  const look = async (raw: string, bestBefore = '') => {
    const c = normalizeBarcode(raw);
    if (!c) return showToast('Das ist keine gültige Barcode-Nummer (8 oder 12–14 Ziffern).');
    if (scans.some((s) => s.code === c && s.status === 'loading')) return;
    setScans((list) => [{ code: c, status: 'loading' }, ...list.filter((s) => s.code !== c)]);
    const r = await lookupProduct(c, getState().products);
    if (!alive.current) return;
    if (r.status === 'found') {
      const s = suggestFoodForProduct(r.product);
      patch(c, { status: 'found', product: r.product, ...(s.foodId ? { foodId: s.foodId } : {}), candidates: s.candidates, bestBefore } as Partial<Scan>);
    } else patch(c, { status: r.status === 'not_found' ? 'missing' : 'offline', grams: '', bestBefore } as Partial<Scan>);
  };

  const pending = state.pendingScans ?? [];
  const resolveLater = async () => {
    for (const p of pending) {
      removePendingScan(p.barcode);
      await look(p.barcode, p.bestBefore ?? '');
    }
  };

  return (
    <section className={styles.stack} aria-label="Produkte scannen">
      <h2 className={styles.groupTitle}>Produkte scannen</h2>
      <p className={styles.hint}>Mehrere Produkte nacheinander – die Kamera bleibt offen. Gesendet wird nur die Barcode-Nummer an Open Food Facts; die Packungsgröße wird übernommen, Preise nie.</p>
      {camera ? (
        <CameraScanner continuous sound={sound} onDetected={(c) => void look(c)} onCancel={() => setCamera(false)} onManualEntry={() => setCamera(false)} />
      ) : cameraAvailable() ? (
        <Button icon="barcode" block onClick={() => setCamera(true)}>
          Scannen starten (Serienmodus)
        </Button>
      ) : (
        <p className={styles.tip}>Kein Kamerazugriff in diesem Browser (z. B. ohne sichere Verbindung oder auf älteren iPhones). Die Nummer unter dem Strichcode funktioniert immer.</p>
      )}
      <div className={styles.chips}>
        <Chip selected={sound} onClick={() => setSound(!sound)}>
          Ton bei Treffer
        </Chip>
      </div>
      <form
        className={styles.addRow}
        onSubmit={(e) => {
          e.preventDefault();
          void look(code);
          setCode('');
        }}
      >
        <Field label="Barcode-Nummer" inputMode="numeric" placeholder="z. B. 4012345678901" value={code} onChange={(e) => setCode(e.currentTarget.value)} />
        <Button type="submit" variant="secondary" disabled={!code.trim()}>
          Nachschlagen
        </Button>
      </form>

      {pending.length > 0 && (
        <div className={styles.tip} role="status">
          {pending.length === 1 ? '1 Barcode wartet' : `${pending.length} Barcodes warten`} auf das Nachschlagen.
          <div className={styles.tipAction}>
            <Button size="sm" variant="secondary" onClick={() => void resolveLater()}>
              Jetzt nachschlagen
            </Button>
          </div>
        </div>
      )}

      {scans.length > 0 && (
        <ul className={styles.scanList} aria-label="Gescannte Produkte">
          {scans.map((s) => (
            <li key={s.code} className={styles.scanItem}>
              <ScanRow scan={s} onChange={(next) => patch(s.code, next)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ScanRow({ scan, onChange }: { scan: Scan; onChange: (next: Partial<Scan>) => void }) {
  const state = useAppState();
  if (scan.status === 'loading') return <p className={styles.hint}>{scan.code}: wird nachgeschlagen …</p>;

  const mhd = (
    <Field label="Mindestens haltbar bis (optional)" type="date" min={today()} value={scan.bestBefore} onChange={(e) => onChange({ bestBefore: e.currentTarget.value })} />
  );

  if (scan.status === 'found') {
    const p = scan.product;
    const flagged = scan.foodId ? productViolates({ ...p, foodId: scan.foodId }, state.nutritionProfile) : productViolates(p, state.nutritionProfile);
    if (scan.result) {
      return (
        <p className={styles.hint}>
          <strong>{p.name}</strong> – {scan.result === 'added' ? `im Vorrat als ${getFood(scan.foodId!)?.name}` : 'gespeichert, aber nicht für den Plan (passt nicht zu deinen Ausschlüssen)'}
        </p>
      );
    }
    return (
      <div className={styles.stack}>
        <p>
          <strong>{p.name}</strong>
          {p.brand ? ` (${p.brand})` : ''}
          {p.packageSize ? ` · ${formatGrams(p.packageSize)}` : ''}
        </p>
        {flagged && (
          <p className={styles.tip} role="alert">
            Passt nicht zu deinen Ausschlüssen – wird gespeichert und markiert, aber nie für den Plan verwendet.
          </p>
        )}
        <p className={styles.label}>Welches LifeFit-Lebensmittel ist das?</p>
        <div className={styles.chips} role="group" aria-label={`${p.name}: Lebensmittel`}>
          {scan.candidates.map((id) => (
            <Chip key={id} selected={scan.foodId === id} onClick={() => onChange({ foodId: id })}>
              {getFood(id)?.name ?? id}
            </Chip>
          ))}
        </div>
        <FoodSelect value={scan.foodId} onChange={(foodId) => onChange({ foodId, candidates: scan.candidates.includes(foodId) ? scan.candidates : [foodId, ...scan.candidates] })} />
        {mhd}
        <Button
          block
          disabled={!scan.foodId}
          onClick={() => {
            const result = scanToPantry(p, scan.foodId!, scan.bestBefore ? { bestBefore: scan.bestBefore } : {});
            if (result !== 'failed') onChange({ result });
          }}
        >
          {scan.foodId ? `In den Vorrat: ${getFood(scan.foodId)?.name}` : 'Lebensmittel wählen'}
        </Button>
      </div>
    );
  }

  // Not found or offline: keep the barcode for later, or enter it by hand.
  if (scan.result) return <p className={styles.hint}>{scan.code}: {scan.result === 'pending' ? 'gemerkt – später nachschlagen' : `im Vorrat als ${getFood(scan.foodId!)?.name}`}</p>;
  const grams = Number(scan.grams.replace(',', '.'));
  return (
    <div className={styles.stack}>
      <p>
        <strong>{scan.code}</strong> – {scan.status === 'offline' ? 'gerade keine Verbindung.' : 'nicht in der Produktdatenbank.'}
      </p>
      <div className={styles.chips}>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            addPendingScan(scan.code, scan.bestBefore || undefined);
            onChange({ result: 'pending' });
          }}
        >
          Später auflösen
        </Button>
      </div>
      <p className={styles.label}>Oder manuell erfassen</p>
      <FoodSelect value={scan.foodId} onChange={(foodId) => onChange({ foodId })} />
      <Field label="Menge in g (optional)" inputMode="decimal" value={scan.grams} onChange={(e) => onChange({ grams: e.currentTarget.value })} />
      {mhd}
      <Button
        block
        variant="secondary"
        disabled={!scan.foodId}
        onClick={() => {
          const food = getFood(scan.foodId!)!;
          const amount = grams > 0 ? grams : levelGrams(food, 'full');
          if (applyWithUndo({ type: 'addPantry', foodId: food.id, grams: amount, ...(scan.bestBefore ? { bestBefore: scan.bestBefore } : {}) })) onChange({ result: 'added' });
        }}
      >
        In den Vorrat
      </Button>
    </div>
  );
}

/** Every catalog food, as a native select – compact and accessible. */
function FoodSelect({ value, onChange }: { value?: string; onChange: (foodId: string) => void }) {
  return (
    <label className={styles.selectRow}>
      <span className={styles.label}>Anderes Lebensmittel</span>
      <select aria-label="Lebensmittel wählen" value={value ?? ''} onChange={(e) => e.currentTarget.value && onChange(e.currentTarget.value)}>
        <option value="">– wählen –</option>
        {PICKABLE_FOODS.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
    </label>
  );
}
