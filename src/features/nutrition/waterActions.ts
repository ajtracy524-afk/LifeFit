import type { ISODate } from '../../domain/types';
import { formatLitres, waterOn } from '../../domain/water';
import { celebrate } from '../../lib/celebrate';
import { withUndo } from '../../lib/undo';
import { addWaterMl } from '../../store/actions';
import { getState } from '../../store/store';

/**
 * The one way the UI changes water (the widget on Heute/Ernährung and the
 * report's quick button): with undo, and with the boost system –
 *   + water          → "Wasser-Boost · +250 ml" (level 1, small)
 *   goal reached now → "Wasserziel erreicht" (level 3)
 *   less water       → nothing celebrated, never a "negative" message.
 */
export function changeWater(date: ISODate, deltaMl: number): boolean {
  if (!deltaMl) return false;
  const before = waterOn(getState(), date);
  const goal = getState().nutritionProfile?.waterGoalMl;
  const next = Math.max(0, before + deltaMl);
  const done = withUndo(`Wasser ${deltaMl > 0 ? '+' : '−'}${Math.abs(deltaMl)} ml · ${formatLitres(next)}`, () => addWaterMl(date, deltaMl));
  if (!done || deltaMl < 0) return done;
  if (goal && before < goal && next >= goal) celebrate({ kind: 'water', icon: '💧', title: 'Wasserziel erreicht', detail: `${formatLitres(next)} heute`, level: 3 });
  else
    celebrate({
      kind: 'water',
      icon: '💧',
      title: `Wasser-Boost · +${deltaMl} ml`,
      detail: goal ? (next >= goal ? `${formatLitres(next)} heute` : `noch ${formatLitres(goal - next)} bis zum Ziel`) : `${formatLitres(next)} heute`,
      level: 1,
    });
  return true;
}
