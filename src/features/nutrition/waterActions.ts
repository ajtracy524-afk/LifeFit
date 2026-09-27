import type { ISODate } from '../../domain/types';
import { formatLitres, waterOn } from '../../domain/water';
import { celebrate } from '../../lib/celebrate';
import { withUndo } from '../../lib/undo';
import { addWaterMl } from '../../store/actions';
import { getState } from '../../store/store';

/** Share of the own water goal that counts as "fast geschafft". */
const ALMOST = 0.75;

/**
 * The one way the UI changes water (the widget on Heute/Ernährung and the
 * report's quick button): with undo, and with the boost system –
 *   + water          → "Hydration-Boost · +250 ml" (level 1, small)
 *   ¾ of the goal    → "Tagesziel fast geschafft" (level 2)
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
  // A real milestone on the way: three quarters of the own goal.
  else if (goal && before < goal * ALMOST && next >= goal * ALMOST)
    celebrate({ kind: 'water', icon: '💧', title: 'Tagesziel fast geschafft', detail: `noch ${formatLitres(goal - next)} · Hydration-Boost +${deltaMl} ml`, level: 2 });
  else
    celebrate({
      kind: 'water',
      icon: '💧',
      title: `Hydration-Boost · +${deltaMl} ml`,
      detail: goal ? (next >= goal ? `${formatLitres(next)} heute` : `noch ${formatLitres(goal - next)} bis zum Ziel`) : `${formatLitres(next)} heute`,
      level: 1,
    });
  return true;
}
