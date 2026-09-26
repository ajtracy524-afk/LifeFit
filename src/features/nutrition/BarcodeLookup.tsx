import { useEffect, useRef, useState } from 'react';
import type { Product } from '../../domain/types';
import { lookupProduct, normalizeBarcode, productSourceName } from '../../services/productLookup';
import { useAppState } from '../../store/store';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Controls';
import { Icon } from '../../components/ui/Icon';
import styles from './nutrition.module.css';

/** The browser's built-in detector (Chrome/Edge on Android, macOS, ChromeOS …) – no library needed. */
interface DetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type DetectorCtor = new (options?: { formats?: string[] }) => DetectorLike;
const Detector = (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;

export function cameraScanSupported(): boolean {
  return !!Detector && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

type LookupState = { kind: 'idle' } | { kind: 'loading'; code: string } | { kind: 'not_found'; code: string } | { kind: 'error'; message: string; code?: string };

interface Props {
  onFound: (product: Product) => void;
  /** "Manuell erfassen" – with the barcode if one was entered. */
  onManual: (barcode?: string) => void;
}

/**
 * Barcode → product. Camera scan where the browser supports it, the number
 * under the barcode always works. Not found / offline / API error never
 * block anything – the manual entry is always one tap away.
 */
export function BarcodeLookup({ onFound, onManual }: Props) {
  const state = useAppState();
  const [code, setCode] = useState('');
  const [lookup, setLookup] = useState<LookupState>({ kind: 'idle' });
  const [camera, setCamera] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const search = async (input: string) => {
    const barcode = normalizeBarcode(input);
    if (!barcode) {
      setLookup({ kind: 'error', message: 'Das ist keine gültige Barcode-Nummer (8 oder 12–14 Ziffern).' });
      return;
    }
    setCode(barcode);
    setLookup({ kind: 'loading', code: barcode });
    const result = await lookupProduct(barcode, state.products);
    if (!alive.current) return;
    if (result.status === 'found') {
      setLookup({ kind: 'idle' });
      onFound(result.product);
    } else if (result.status === 'not_found') setLookup({ kind: 'not_found', code: barcode });
    else setLookup({ kind: 'error', message: result.message, code: barcode });
  };

  return (
    <div className={styles.scanBox}>
      {camera ? (
        <CameraScanner
          onDetected={(value) => {
            setCamera(false);
            void search(value);
          }}
          onCancel={() => setCamera(false)}
        />
      ) : (
        cameraScanSupported() && (
          <Button variant="secondary" icon="barcode" block onClick={() => setCamera(true)}>
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
          hint={cameraScanSupported() ? undefined : 'Die Ziffern stehen unter dem Strichcode.'}
          onChange={(e) => {
            setCode(e.target.value);
            if (lookup.kind !== 'loading') setLookup({ kind: 'idle' });
          }}
        />
        <Button type="submit" block icon="search" disabled={lookup.kind === 'loading' || !code.trim()}>
          {lookup.kind === 'loading' ? 'Suche Produkt …' : 'Produkt suchen'}
        </Button>
      </form>

      {lookup.kind === 'loading' && (
        <p className={styles.searchHint} role="status">
          Suche in {productSourceName()} …
        </p>
      )}
      {lookup.kind === 'not_found' && (
        <div className={styles.lookupState} role="status">
          <strong>Produkt nicht gefunden</strong>
          <p>Zu {lookup.code} gibt es keine Daten. Du kannst es mit den Angaben der Verpackung erfassen.</p>
          <Button variant="secondary" onClick={() => onManual(lookup.code)}>
            Manuell erfassen
          </Button>
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

/** Live camera preview; reports the first code found and stops the camera right away. */
function CameraScanner({ onDetected, onCancel }: { onDetected: (code: string) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  // The parent re-renders on every store change – the camera must not restart then.
  const report = useRef(onDetected);
  report.current = onDetected;

  useEffect(() => {
    let stream: MediaStream | undefined;
    let timer: number | undefined;
    let done = false;
    const stop = () => {
      done = true;
      window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (done || !video.current) return stop();
        video.current.srcObject = stream;
        await video.current.play();
        const detector = new Detector!({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
        timer = window.setInterval(async () => {
          if (done || !video.current) return;
          try {
            const found = await detector.detect(video.current);
            const value = found.map((f) => normalizeBarcode(f.rawValue)).find(Boolean);
            // One detection = one lookup: the camera stops before anything else happens.
            if (value && !done) {
              stop();
              report.current(value);
            }
          } catch {
            /* frame not ready – try the next one */
          }
        }, 300);
      } catch {
        if (!done) setError('Kein Kamerazugriff. Gib die Nummer unter dem Barcode ein.');
      }
    })();
    return stop;
  }, []);

  return (
    <div className={styles.scanBox}>
      {error ? <p className={styles.notice}>{error}</p> : <video ref={video} className={styles.video} playsInline muted aria-label="Kamerabild zum Scannen" />}
      <Button variant="ghost" onClick={onCancel}>
        <Icon name="close" size={16} /> Kamera schließen
      </Button>
    </div>
  );
}
