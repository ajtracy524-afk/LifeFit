// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cameraAvailable, cameraProblem, setDecoderFactory } from '../../services/barcodeScanner';
import { setProductSource, openFoodFacts, type ProductSource } from '../../services/productLookup';

/**
 * Camera scanning without real hardware: getUserMedia and the frame decoder
 * are simulated, everything else (start, stop, one detection, errors,
 * product lookup) is the real code.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | undefined;
const stopTrack = vi.fn();
const settle = (ms = 0) => act(() => new Promise((r) => setTimeout(r, ms)));

function fakeCamera(fail?: string) {
  const getUserMedia = vi.fn(async () => {
    if (fail) throw Object.assign(new Error(fail), { name: fail });
    return { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
  });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  return getUserMedia;
}

beforeEach(() => {
  localStorage.clear();
  stopTrack.mockReset();
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container.remove();
  setDecoderFactory(undefined);
  setProductSource(openFoodFacts);
  vi.restoreAllMocks();
});

async function renderScanner(props: Partial<Parameters<typeof import('./CameraScanner').CameraScanner>[0]> = {}) {
  const { CameraScanner } = await import('./CameraScanner');
  const onDetected = vi.fn();
  const onCancel = vi.fn();
  const onManualEntry = vi.fn();
  root = createRoot(container);
  await act(async () => root!.render(<CameraScanner onDetected={onDetected} onCancel={onCancel} onManualEntry={onManualEntry} {...props} />));
  await settle();
  return { onDetected, onCancel, onManualEntry };
}
const text = () => container.textContent ?? '';
const button = (label: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(label))!;

describe('camera scanner', () => {
  it('asks for the camera, shows the scan frame and a cancel button; cancel stops the stream', async () => {
    const getUserMedia = fakeCamera();
    setDecoderFactory(async () => ({ decode: async () => undefined }));
    const { onCancel } = await renderScanner();
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false }));
    expect(text()).toMatch(/Halte den Strichcode in den Rahmen/);
    expect(container.querySelector('video')).not.toBeNull();
    await act(async () => button('Abbrechen').click());
    expect(onCancel).toHaveBeenCalledTimes(1);
    await act(async () => root!.unmount());
    root = undefined;
    expect(stopTrack).toHaveBeenCalled();
  });

  it('reports the first barcode exactly once and stops the camera before reporting', async () => {
    fakeCamera();
    const decode = vi.fn(async () => '4012345678901');
    setDecoderFactory(async () => ({ decode }));
    const order: string[] = [];
    stopTrack.mockImplementation(() => order.push('stop'));
    const onDetected = vi.fn(() => order.push('report'));
    await renderScanner({ onDetected });
    await settle(600); // several scan intervals – the same code would be "seen" again and again
    expect(onDetected).toHaveBeenCalledTimes(1);
    expect(onDetected).toHaveBeenCalledWith('4012345678901');
    expect(order).toEqual(['stop', 'report']);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it('frames that fail to decode are skipped until a code is found', async () => {
    fakeCamera();
    let n = 0;
    setDecoderFactory(async () => ({
      decode: async () => {
        n++;
        if (n === 1) throw new Error('not ready');
        return n >= 3 ? '76123456' : undefined;
      },
    }));
    const onDetected = vi.fn();
    await renderScanner({ onDetected });
    await settle(900);
    expect(onDetected).toHaveBeenCalledTimes(1);
    expect(onDetected).toHaveBeenCalledWith('76123456');
  });

  it('permission denied → clear message and "Barcode manuell eingeben"', async () => {
    fakeCamera('NotAllowedError');
    const { onManualEntry } = await renderScanner();
    expect(text()).toContain('Kamerazugriff wurde nicht erlaubt.');
    await act(async () => button('Barcode manuell eingeben').click());
    expect(onManualEntry).toHaveBeenCalledTimes(1);
  });

  it('no camera → manual entry offered', async () => {
    fakeCamera('NotFoundError');
    await renderScanner();
    expect(text()).toContain('Keine Kamera verfügbar.');
    expect(button('Barcode manuell eingeben')).toBeTruthy();
  });

  it('maps camera errors and detects availability', () => {
    expect(cameraProblem({ name: 'NotAllowedError' })).toBe('denied');
    expect(cameraProblem({ name: 'NotReadableError' })).toBe('unavailable');
    expect(cameraProblem(new Error('x'))).toBe('failed');
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    expect(cameraAvailable()).toBe(false);
    fakeCamera();
    expect(cameraAvailable()).toBe(true);
  });
});

describe('camera → product lookup (BarcodeLookup)', () => {
  const source = (found: boolean): ProductSource => ({
    name: 'Fake',
    lookup: vi.fn(async (barcode: string) =>
      found
        ? { status: 'found' as const, product: { barcode, name: 'Poulet', per100: { kcal: 110, protein: 23, carbs: 0, fat: 1.5 }, micros100: {}, unit: 'g' as const, packageSize: 400, source: 'openfoodfacts' as const, fetchedAt: '2026-09-21T08:00:00Z' } }
        : { status: 'not_found' as const },
    ),
  });

  async function renderLookup(found: boolean) {
    fakeCamera();
    const src = source(found);
    setProductSource(src);
    setDecoderFactory(async () => ({ decode: async () => '4012345678901' }));
    const { BarcodeLookup } = await import('./BarcodeLookup');
    const onFound = vi.fn();
    const onManual = vi.fn();
    root = createRoot(container);
    await act(async () => root!.render(<BarcodeLookup onFound={onFound} onManual={onManual} />));
    await act(async () => button('Mit Kamera scannen').click());
    await settle(50);
    return { onFound, onManual, src };
  }

  it('a scanned barcode is looked up once and handed to the product flow', async () => {
    const { onFound, src } = await renderLookup(true);
    expect(src.lookup).toHaveBeenCalledTimes(1);
    expect(onFound).toHaveBeenCalledTimes(1);
    expect(onFound.mock.calls[0]![0]).toMatchObject({ barcode: '4012345678901', name: 'Poulet' });
    expect(stopTrack).toHaveBeenCalled();
  });

  it('an unknown scanned barcode offers the manual entry with the number', async () => {
    const { onManual } = await renderLookup(false);
    expect(text()).toContain('Produkt nicht gefunden');
    await act(async () => button('Manuell erfassen').click());
    expect(onManual).toHaveBeenCalledWith('4012345678901');
  });
});
