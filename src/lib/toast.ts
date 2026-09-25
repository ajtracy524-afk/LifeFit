import { useSyncExternalStore } from 'react';

export interface ToastData {
  id: number;
  message: string;
  action?: { label: string; onClick: () => void };
  tone?: 'default' | 'error';
}

let toasts: ToastData[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function showToast(message: string, options: Omit<ToastData, 'id' | 'message'> & { duration?: number } = {}): void {
  const id = nextId++;
  // One toast at a time keeps the UI calm; the newest wins.
  toasts = [{ id, message, action: options.action, tone: options.tone }];
  emit();
  window.setTimeout(() => dismissToast(id), options.duration ?? 5000);
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function useToasts(): ToastData[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
  );
}
