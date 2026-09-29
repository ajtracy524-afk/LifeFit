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
 *
 * Recognition quality:
 *   - every camera read must pass the GTIN check digit – a misread (one wrong
 *     digit) is dropped and the next frame is tried, instead of a wrong lookup
 *   - ZXing looks at the scan frame first (the centre, full resolution), then
 *     at the whole picture – small or distant codes are found more often
 *   - native detector without a hit for ~3 s → ZXing joins on every other
 *     frame (some native detectors miss damaged or glossy codes)
 */

/** GTIN check digit (EAN-8/13, UPC-A as 12, GTIN-14): weights 3/1 from the right. */
export function isValidGtin(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/** A camera read that is a real retail code, or nothing. UPC-E (8 digits) is expanded by the reader. */
const valid = (raw: string) => {
  const code = normalizeBarcode(raw);
  return code && isValidGtin(code) ? code : undefined;
};

/** Native detector misses in a row before ZXing is also tried (~3 s at 4 frames/s). */
export const FALLBACK_AFTER_MISSES = 12;

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
        return found.map((f) => valid(f.rawValue)).find(Boolean);
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
  const read = async (video: HTMLVideoElement, sx: number, sy: number, sw: number, sh: number, max: number) => {
    if (!ctx) return undefined;
    // Enough resolution for an EAN, small enough to stay fast on phones.
    const scale = Math.min(1, max / sw);
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const results = await zxing.readBarcodes(ctx.getImageData(0, 0, canvas.width, canvas.height), {
      formats: ['EAN13', 'EAN8', 'UPCA', 'UPCE'],
      tryHarder: true,
      maxNumberOfSymbols: 1,
    });
    return results.map((r) => valid(r.text)).find(Boolean);
  };
  return {
    async decode(video) {
      if (!ctx || !video.videoWidth) return undefined;
      const w = video.videoWidth;
      const h = video.videoHeight;
      // 1. The scan frame (centre band) at full detail, 2. the whole picture.
      return (await read(video, w * 0.1, h * 0.3, w * 0.8, h * 0.4, 1280)) ?? (await read(video, 0, 0, w, h, 1280));
    },
  };
}

/** Native first (fast, no download); after a few seconds without a hit ZXing also tries every other frame. */
async function hybridDecoder(): Promise<FrameDecoder> {
  const native = await nativeDecoder();
  if (!native) return zxingDecoder();
  let misses = 0;
  let fallback: Promise<FrameDecoder | undefined> | undefined;
  return {
    async decode(video) {
      const code = await native.decode(video).catch(() => undefined);
      if (code) return code;
      misses += 1;
      if (misses < FALLBACK_AFTER_MISSES || misses % 2) return undefined;
      fallback ??= zxingDecoder().catch(() => undefined);
      const zx = await fallback;
      return zx ? zx.decode(video) : undefined;
    },
  };
}

const defaultFactory: DecoderFactory = hybridDecoder;
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
