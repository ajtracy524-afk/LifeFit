import zxingWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { normalizeBarcode } from './productLookup';

/**
 * Camera barcode decoding – loaded only when the user opens the camera.
 *
 *   native BarcodeDetector (Chrome/Edge on Android, macOS, ChromeOS)
 *   → otherwise ZXing (WebAssembly, served by LifeFit itself – no CDN)
 *
 * Only retail codes (EAN-13/8, UPC-A/E) are read. Frames never leave the
 * device; only a found number goes to the product lookup.
 */
export interface FrameDecoder {
  /** The first valid retail barcode in the current video frame, if any. */
  decode(video: HTMLVideoElement): Promise<string | undefined>;
}
export type DecoderFactory = () => Promise<FrameDecoder>;

interface NativeDetector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type NativeDetectorCtor = (new (options?: { formats?: string[] }) => NativeDetector) & { getSupportedFormats?: () => Promise<string[]> };

const RETAIL_NATIVE = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

async function nativeDecoder(): Promise<FrameDecoder | undefined> {
  const Ctor = (globalThis as { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector;
  if (!Ctor) return undefined;
  try {
    const supported = (await Ctor.getSupportedFormats?.()) ?? RETAIL_NATIVE;
    const formats = RETAIL_NATIVE.filter((f) => supported.includes(f));
    if (!formats.length) return undefined;
    const detector = new Ctor({ formats });
    return {
      async decode(video) {
        const found = await detector.detect(video);
        return found.map((f) => normalizeBarcode(f.rawValue)).find(Boolean);
      },
    };
  } catch {
    return undefined;
  }
}

async function zxingDecoder(): Promise<FrameDecoder> {
  const zxing = await import('zxing-wasm/reader');
  // Load the WebAssembly now – a failure surfaces here, not in the first frame.
  await zxing.prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? zxingWasmUrl : prefix + path) },
    fireImmediately: true,
  });
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return {
    async decode(video) {
      if (!ctx || !video.videoWidth) return undefined;
      // Enough resolution for an EAN, small enough to stay fast on phones.
      const scale = Math.min(1, 1280 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const results = await zxing.readBarcodes(ctx.getImageData(0, 0, canvas.width, canvas.height), {
        formats: ['EAN13', 'EAN8', 'UPCA', 'UPCE'],
        tryHarder: true,
        maxNumberOfSymbols: 1,
      });
      return results.map((r) => normalizeBarcode(r.text)).find(Boolean);
    },
  };
}

const defaultFactory: DecoderFactory = async () => (await nativeDecoder()) ?? zxingDecoder();
let factory: DecoderFactory = defaultFactory;

export function createDecoder(): Promise<FrameDecoder> {
  return factory();
}

/** Swaps the decoder (tests, or another engine later). */
export function setDecoderFactory(next: DecoderFactory | undefined): void {
  factory = next ?? defaultFactory;
}

/** A camera can be requested at all (secure context + mediaDevices). */
export function cameraAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

export type CameraProblem = 'denied' | 'unavailable' | 'failed';

/** getUserMedia errors → what the user needs to know. */
export function cameraProblem(error: unknown): CameraProblem {
  const name = (error as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError' || name === 'DevicesNotFoundError') return 'unavailable';
  return 'failed';
}
