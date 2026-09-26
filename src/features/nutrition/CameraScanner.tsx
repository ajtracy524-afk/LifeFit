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

interface Props {
  /** Called exactly once with the first valid barcode – the camera is already stopped then. */
  onDetected: (code: string) => void;
  onCancel: () => void;
  /** Camera not possible → type the number instead. */
  onManualEntry: () => void;
}

/**
 * Live camera preview with a scan frame. Asks for permission when opened,
 * decodes frames (native detector or ZXing, see services/barcodeScanner),
 * and on the first hit stops the camera BEFORE reporting – so a code seen in
 * several frames is taken once. Closing or leaving always stops the stream.
 */
export function CameraScanner({ onDetected, onCancel, onManualEntry }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<'starting' | 'scanning' | CameraProblem>('starting');
  // The parent re-renders on every store change – the camera must not restart then.
  const report = useRef(onDetected);
  report.current = onDetected;

  useEffect(() => {
    let stream: MediaStream | undefined;
    let timer: number | undefined;
    let done = false;
    const stop = () => {
      done = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      if (video.current) video.current.srcObject = null;
    };
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
        if (done || !video.current) return stop();
        video.current.srcObject = stream;
        await video.current.play();
        const decoder = await createDecoder();
        if (done) return;
        setStatus('scanning');
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
        {status === 'starting' ? 'Kamera wird gestartet …' : 'Halte den Strichcode in den Rahmen – er wird automatisch erkannt.'}
      </p>
      <Button variant="secondary" block onClick={onCancel}>
        Abbrechen
      </Button>
    </div>
  );
}
