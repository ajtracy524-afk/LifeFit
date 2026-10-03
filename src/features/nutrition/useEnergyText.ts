import { today } from '../../domain/dates';
import { dayPortions, isNumberFree, portionKcal, portionText, withoutKcal, type PORTION_FACTOR } from '../../domain/numberFree';
import type { ISODate } from '../../domain/types';
import { dayTargetFor } from '../../domain/week';
import { fmt } from '../../lib/format';
import { useAppState } from '../../store/store';

/**
 * kcal as the user wants to see it: as a number, or – in the number-free mode
 * (E14) – as a meal portion ("Portion: normal") relative to the day's target.
 * One place for Heute and Ernährung.
 */
export function useEnergyText(date: ISODate = today()) {
  const state = useAppState();
  const on = isNumberFree(state);
  const target = dayTargetFor(state, date)?.kcal ?? 0;
  const meals = state.nutritionProfile?.slots.length ?? 3;
  return {
    numberFree: on,
    /** "632 kcal" or "Portion: normal". */
    kcal: (n: number) => (on ? portionText(n, target, meals) : fmt.kcal(n)),
    /** The day in meals: "ca. 1½ von 4 Mahlzeiten". */
    day: (eatenKcal: number) => dayPortions(eatenKcal, target, meals),
    /** "pro 100 g": the kcal part only with numbers (undefined in the number-free mode). */
    per100: (n: number | undefined, unit = 'g') => (on || n === undefined ? undefined : `${fmt.int(n)} kcal pro 100 ${unit}`),
    /** Engine / coach / change texts: kcal parts left out in the number-free mode (undefined = not shown). */
    text: (t: string) => (on ? withoutKcal(t) : t),
    texts: (list: string[]) => (on ? list.map(withoutKcal).filter((t): t is string => !!t) : list),
    /** "klein / normal / groß" as calories in the background. */
    portionKcal: (size: keyof typeof PORTION_FACTOR) => portionKcal(size, target, meals),
  };
}
