import { useEffect, useRef, useState } from 'react';
import { cameraProblem, createDecoder, type CameraProblem } from '../../services/barcodeScanner';
import { Button } from '../../components/ui/Button';
import styles from './nutrition.module.css';

const PROBLEM_TEXT: Record<CameraProblem, string> = {
  denied: 'Kamerazugriff wurde nicht erlaubt.',
  unavailable: 'Keine Kamera verfügbar.',
  failed: 'Die Kamera konnte nicht gestartet werden.',
};

/** Pause between two decode attempts – enough for a phone to keep the preview smooth. */
const SCAN_INTERVAL_MS = 250;
/** After this long without a code, help appears (closer, light, type or search instead). */
export const SCAN_HELP_AFTER_MS = 8000;

interface Props {
  /** Called exactly once with the first valid barcode – the camera is already stopped then. */
  onDetected: (code: string) => void;
  onCancel: () => void;
  /** Camera not possible → type the number instead. */
  onManualEntry: () => void;
  /** No code found → search the food by name instead. */
  onSearch?: () => void;
}

/**
 * Live camera preview with a scan frame. Asks for permission when opened,
 * decodes frames (native detector or ZXing, see services/barcodeScanner),
 * and on the first hit stops the camera BEFORE reporting – so a code seen in
 * several frames is taken once. Closing or leaving always stops the stream.
 */
export function CameraScanner({ onDetected, onCancel, onManualEntry, onSearch }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<'starting' | 'scanning' | CameraProblem>('starting');
  const [help, setHelp] = useState(false);
  // Light: only where the camera offers it (many phones). Focus: continuous where supported.
  const track = useRef<MediaStreamTrack | undefined>(undefined);
  const [torch, setTorch] = useState<boolean | undefined>(undefined);
  // The parent re-renders on every store change – the camera must not restart then.
  const report = useRef(onDetected);
  report.current = onDetected;

  useEffect(() => {
    let stream: MediaStream | undefined;
    let timer: number | undefined;
    let helpTimer: number | undefined;
    let done = false;
    const stop = () => {
      done = true;
      window.clearTimeout(timer);
      window.clearTimeout(helpTimer);
      stream?.getTracks().forEach((t) => t.stop());
      if (video.current) video.current.srcObject = null;
    };
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
        if (done || !video.current) return stop();
        video.current.srcObject = stream;
        await video.current.play();
        const t = stream.getVideoTracks?.()[0];
        track.current = t;
        const caps = (t?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] };
        if (caps.focusMode?.includes('continuous')) void t?.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => undefined);
        if (caps.torch) setTorch(false);
        const decoder = await createDecoder();
        if (done) return;
        setStatus('scanning');
        helpTimer = window.setTimeout(() => !done && setHelp(true), SCAN_HELP_AFTER_MS);
        const tick = async () => {
          if (done || !video.current) return;
          let code: string | undefined;
          try {
            code = await decoder.decode(video.current);
          } catch {
            /* frame not ready – try the next one */
          }
          if (done) return;
          if (code) {
            // One detection = one lookup: stop first, then report.
            stop();
            report.current(code);
            return;
          }
          timer = window.setTimeout(tick, SCAN_INTERVAL_MS);
        };
        void tick();
      } catch (error) {
        stop();
        setStatus(cameraProblem(error));
      }
    })();
    return stop;
  }, []);

  if (status !== 'starting' && status !== 'scanning') {
    return (
      <div className={styles.scanner} role="alert">
        <p className={styles.notice}>
          <strong>{PROBLEM_TEXT[status]}</strong>
          <br />
          {status === 'denied' ? 'Du kannst den Zugriff in den Browser-Einstellungen erlauben – oder die Nummer eintippen.' : 'Die Nummer unter dem Strichcode funktioniert immer.'}
        </p>
        <Button block onClick={onManualEntry}>
          Barcode manuell eingeben
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.scanner}>
      <div className={styles.viewfinder}>
        <video ref={video} className={styles.video} playsInline muted aria-label="Kamerabild zum Scannen" />
        <span className={styles.scanFrame} aria-hidden />
      </div>
      <p className={styles.scanHint} role="status">
        {status === 'starting'
          ? 'Kamera wird gestartet …'
          : help
            ? 'Noch nichts erkannt: etwas näher ran, Strichcode gerade halten und Spiegelungen vermeiden.'
            : 'Halte den Strichcode in den Rahmen – er wird automatisch erkannt.'}
      </p>
      {torch !== undefined && (
        <Button
          variant="secondary"
          block
          icon="sparkle"
          aria-pressed={torch}
          onClick={() => {
            const next = !torch;
            void track.current?.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] }).then(
              () => setTorch(next),
              () => setTorch(undefined),
            );
          }}
        >
          {torch ? 'Licht aus' : 'Licht an'}
        </Button>
      )}
      {help && (
        <div className={styles.scanFallback}>
          <Button variant="secondary" block onClick={onManualEntry}>
            Nummer eintippen
          </Button>
          {onSearch && (
            <Button variant="secondary" block icon="search" onClick={onSearch}>
              Stattdessen suchen
            </Button>
          )}
        </div>
      )}
      <Button variant="ghost" block onClick={onCancel}>
        Abbrechen
      </Button>
    </div>
  );
}
