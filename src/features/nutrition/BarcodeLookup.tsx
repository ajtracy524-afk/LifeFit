import { useEffect, useRef, useState } from 'react';
import type { Product } from '../../domain/types';
import { cameraAvailable } from '../../services/barcodeScanner';
import { lookupProduct, normalizeBarcode, productSourceName } from '../../services/productLookup';
import { useAppState } from '../../store/store';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Controls';
import { CameraScanner } from './CameraScanner';
import styles from './nutrition.module.css';

type LookupState = { kind: 'idle' } | { kind: 'loading'; code: string } | { kind: 'not_found'; code: string } | { kind: 'error'; message: string; code?: string };

interface Props {
  onFound: (product: Product) => void;
  /** "Manuell erfassen" – with the barcode if one was entered. */
  onManual: (barcode?: string) => void;
  /** No code found by the camera → search by name instead. */
  onSearch?: () => void;
}

/**
 * Barcode → product. Camera scan on every browser with a camera (optional on
 * desktop), the number under the barcode always works. Not found / offline /
 * API error never block anything – the manual entry is always one tap away.
 */
export function BarcodeLookup({ onFound, onManual, onSearch }: Props) {
  const state = useAppState();
  const [code, setCode] = useState('');
  const [lookup, setLookup] = useState<LookupState>({ kind: 'idle' });
  const [camera, setCamera] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const busy = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const typeInstead = () => {
    setCamera(false);
    window.setTimeout(() => box.current?.querySelector<HTMLInputElement>('input')?.focus(), 0);
  };

  const search = async (input: string) => {
    // One lookup at a time – a second scan or tap while searching is ignored.
    if (busy.current) return;
    const barcode = normalizeBarcode(input);
    if (!barcode) {
      setLookup({ kind: 'error', message: 'Das ist keine gültige Barcode-Nummer (8 oder 12–14 Ziffern).' });
      return;
    }
    setCode(barcode);
    setLookup({ kind: 'loading', code: barcode });
    busy.current = true;
    const result = await lookupProduct(barcode, state.products);
    busy.current = false;
    if (!alive.current) return;
    if (result.status === 'found') {
      setLookup({ kind: 'idle' });
      onFound(result.product);
    } else if (result.status === 'not_found') setLookup({ kind: 'not_found', code: barcode });
    else setLookup({ kind: 'error', message: result.message, code: barcode });
  };

  return (
    <div className={styles.scanBox} ref={box}>
      {camera ? (
        <CameraScanner
          onDetected={(value) => {
            setCamera(false);
            void search(value);
          }}
          onCancel={() => setCamera(false)}
          onManualEntry={typeInstead}
          onSearch={onSearch}
        />
      ) : (
        cameraAvailable() && (
          <Button icon="barcode" block onClick={() => setCamera(true)} disabled={lookup.kind === 'loading'}>
            Mit Kamera scannen
          </Button>
        )
      )}

      <form
        className={styles.quickForm}
        onSubmit={(e) => {
          e.preventDefault();
          void search(code);
        }}
      >
        <Field
          label="Barcode-Nummer"
          inputMode="numeric"
          placeholder="z. B. 4012345678901"
          value={code}
          hint="Oder die Ziffern unter dem Strichcode eintippen."
          onChange={(e) => {
            setCode(e.target.value);
            if (lookup.kind !== 'loading') setLookup({ kind: 'idle' });
          }}
        />
        <Button type="submit" block icon="search" disabled={lookup.kind === 'loading' || !code.trim()}>
          {lookup.kind === 'loading' ? 'Produkt wird gesucht …' : 'Produkt suchen'}
        </Button>
      </form>

      {lookup.kind === 'loading' && (
        <p className={styles.searchHint} role="status">
          Produkt wird gesucht ({productSourceName()}) …
        </p>
      )}
      {lookup.kind === 'not_found' && (
        <div className={styles.lookupState} role="status">
          <strong>Produkt nicht gefunden</strong>
          <p>
            Zu {lookup.code} gibt es keine Daten. Du kannst den Barcode erneut scannen oder das Lebensmittel mit den Angaben der Verpackung manuell erfassen.
          </p>
          <div className={styles.chipRow}>
            {cameraAvailable() && (
              <Button
                variant="ghost"
                icon="barcode"
                onClick={() => {
                  setLookup({ kind: 'idle' });
                  setCamera(true);
                }}
              >
                Erneut scannen
              </Button>
            )}
            <Button variant="secondary" onClick={() => onManual(lookup.code)}>
              Manuell erfassen
            </Button>
          </div>
        </div>
      )}
      {lookup.kind === 'error' && (
        <div className={styles.lookupState} role="alert">
          <strong>{lookup.message}</strong>
          <p>Du kannst es manuell erfassen.</p>
          <div className={styles.chipRow}>
            {lookup.code && (
              <Button variant="ghost" onClick={() => void search(lookup.code!)}>
                Erneut versuchen
              </Button>
            )}
            <Button variant="secondary" onClick={() => onManual(lookup.code)}>
              Manuell erfassen
            </Button>
          </div>
        </div>
      )}
      <p className={styles.sourceNote}>
        Produktdaten: {productSourceName()} (offene Datenbank). Gesendet wird nur die Barcode-Nummer – deine Einträge bleiben auf diesem Gerät.
      </p>
    </div>
  );
}
