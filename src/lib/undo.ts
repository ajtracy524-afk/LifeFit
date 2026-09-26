import type { WeekChange } from '../domain/week';
import { applyChange } from '../store/actions';
import type { AppState } from '../domain/types';
import { restore, snapshot } from '../store/store';
import { showToast } from './toast';

/**
 * Undo restores the snapshot taken before the action – but only while the state
 * is still exactly the one the action produced. Anything done in between would
 * otherwise be lost silently, so undo is refused with a short explanation.
 */
export function undoTo(before: AppState, after: AppState): boolean {
  if (snapshot() !== after) {
    showToast('Rückgängig ist nicht mehr möglich – inzwischen gab es weitere Änderungen.', { tone: 'error' });
    return false;
  }
  restore(before);
  return true;
}

/**
 * Runs an action and offers "Rückgängig" in a toast – instead of confirmation
 * dialogs. An action that returns false (or changes nothing) shows no toast.
 */
export function withUndo(message: string, action: () => boolean | void): boolean {
  const before = snapshot();
  const result = action();
  const after = snapshot();
  if (result === false || after === before) return false;
  showToast(message, { action: { label: 'Rückgängig', onClick: () => undoTo(before, after) } });
  return true;
}

/**
 * Applies a week change through the cascade and shows what else changed:
 * "Push auf Freitag verschoben · Tagesziele: Do −150 kcal, Fr +150 kcal · Einkauf: 1 geändert"
 * Undo restores the complete previous state (one snapshot, no history).
 */
export function applyWithUndo(change: WeekChange): boolean {
  const before = snapshot();
  const result = applyChange(change);
  if (!result.ok) {
    showToast(result.reason, { tone: 'error' });
    return false;
  }
  const after = snapshot();
  const message = [result.summary.title, ...result.summary.details].join(' · ');
  showToast(message, { action: { label: 'Rückgängig', onClick: () => undoTo(before, after) }, duration: 7000 });
  return true;
}
