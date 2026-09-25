import { useSyncExternalStore } from 'react';
import type { AppState } from '../domain/types';
import { clearState, emptyState, loadState, saveState } from './persistence';

type Listener = () => void;

const initial = loadState();
let state: AppState = initial.state;
const listeners = new Set<Listener>();

/** Status of local persistence, shown as a banner if saving fails. */
let storageOk = initial.notice !== 'unavailable';
let storageNotice = initial.notice;
const storageListeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

function persist() {
  const ok = saveState(state);
  if (ok !== storageOk) {
    storageOk = ok;
    storageListeners.forEach((l) => l());
  }
}

export function getState(): AppState {
  return state;
}

/**
 * The single write path. `recipe` receives a deep copy it may mutate freely,
 * which keeps action code short while React still sees a new immutable object.
 */
export function update(recipe: (draft: AppState) => void): void {
  const draft = structuredClone(state);
  recipe(draft);
  state = draft;
  persist();
  emit();
}

/** Replaces the whole state with one computed elsewhere (e.g. by the week cascade). */
export function commit(next: AppState): void {
  state = next;
  persist();
  emit();
}

/** Undo support: capture before an action, restore from the toast. */
export function snapshot(): AppState {
  return state;
}

export function restore(previous: AppState): void {
  commit(previous);
}

/**
 * Full reset: removes everything from storage and shows onboarding again.
 * The empty state is NOT written back – storage stays empty until onboarding
 * completes, exactly like for a first-time user.
 */
export function resetAll(): void {
  clearState();
  state = emptyState();
  // The recovery copy is gone, so the "data was corrupted" banner no longer applies.
  if (storageNotice === 'recovered') {
    storageNotice = undefined;
    storageListeners.forEach((l) => l());
  }
  emit();
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getState);
}

export function useStorageStatus(): { ok: boolean; notice?: 'recovered' | 'unavailable' } {
  const ok = useSyncExternalStore(
    (l) => {
      storageListeners.add(l);
      return () => storageListeners.delete(l);
    },
    () => storageOk,
  );
  return { ok, notice: storageNotice };
}
