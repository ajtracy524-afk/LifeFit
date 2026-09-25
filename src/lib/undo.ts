import type { WeekChange } from '../domain/week';
import { applyChange } from '../store/actions';
import { restore, snapshot } from '../store/store';
import { showToast } from './toast';

/** Runs an action and offers "Rückgängig" in a toast – instead of confirmation dialogs. */
export function withUndo(message: string, action: () => void): void {
  const before = snapshot();
  action();
  showToast(message, { action: { label: 'Rückgängig', onClick: () => restore(before) } });
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
  const message = [result.summary.title, ...result.summary.details].join(' · ');
  showToast(message, { action: { label: 'Rückgängig', onClick: () => restore(before) }, duration: 7000 });
  return true;
}
