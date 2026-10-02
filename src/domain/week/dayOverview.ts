import { getRecipe } from '../../data/recipes';
import { calorieTolerance } from '../calorieStatus';
import { ingredientCostRange, type CostRange, type PriceLookup } from '../costs';
import { rate, type Tone } from '../nutrientReport';
import { slotShare } from '../planner';
import { excludedSlots } from '../timeBudget';
import type { ISODate, MealSlot } from '../types';
import type { PlanDay } from './weekPlan';

/**
 * One day of the nutrition week plan at a glance – read from the central
 * WeekPlan (buildWeekPlan), rated with the same calorie zone and the same
 * rating as the Nährstoff-Auswertung. No planning happens here.
 *
 * - kcal / protein: planned + eaten meals of the day against the day target
 *   (on an eating-out day only the share of the planned slots).
 * - status: a finished day says how it went, an open day whether the plan
 *   fits, an empty future day that it is not planned yet.
 */
export interface DayOverview {
  date: ISODate;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  kcalRef?: number;
  proteinRef?: number;
  carbsRef?: number;
  fatRef?: number;
  kcalTone: Tone;
  proteinTone: Tone;
  meals: number;
  eaten: number;
  cost?: CostRange;
  status: { tone: Tone; text: string };
}

export function dayOverview(day: PlanDay, today: ISODate, slots: MealSlot[], price: PriceLookup): DayOverview {
  const active = day.meals.filter((m) => m.status !== 'skipped');
  const eaten = active.filter((m) => m.status === 'eaten').length;
  // The planned meals' part of the day: out meals keep their budget, skipped ones hand it on (Prompt 5).
  const out = excludedSlots(day.context).filter((s) => slots.includes(s));
  const share = out.length ? 1 - slotShare(out, slots) : 1;
  const kcalRef = day.planTarget ? Math.round(day.planTarget.kcal) : day.target ? Math.round(day.target.kcal * share) : undefined;
  const proteinRef = day.planTarget ? Math.round(day.planTarget.protein) : day.target ? Math.round(day.target.protein * share) : undefined;
  const past = day.date < today;
  // What the day really is: eaten values for a past day, plan (eaten + still planned) otherwise.
  const kcal = past ? day.eaten.kcal : day.planned.kcal;
  const protein = past ? day.eaten.protein : day.planned.protein;
  const carbs = past ? day.eaten.carbs : day.planned.carbs;
  const fat = past ? day.eaten.fat : day.planned.fat;
  const kcalRating = kcalRef ? rate(kcal, { kind: 'range', amount: kcalRef, unit: 'kcal', tolerance: calorieTolerance(kcalRef), personalized: true, basis: '', role: 'Zielbereich' }, { finished: past }) : undefined;
  const proteinRating = proteinRef ? rate(protein, { kind: 'min', amount: proteinRef, unit: 'g', personalized: true, basis: '', role: 'Tagesziel' }, { finished: past }) : undefined;
  const cost = active.length
    ? ingredientCostRange(
        active.flatMap((m) => (getRecipe(m.recipeId)?.ingredients ?? []).map((i) => ({ foodId: i.foodId, grams: i.grams * m.servings }))),
        price,
      )
    : undefined;

  let status: DayOverview['status'];
  if (!active.length && !kcal) status = { tone: 'none', text: past ? 'Nichts erfasst' : 'Noch nicht geplant' };
  else if (past && !kcal) status = { tone: 'none', text: 'Nichts erfasst' };
  else if (past || (day.date === today && eaten === active.length && active.length > 0))
    // A finished day is described by what it was ("1.820 von 2.100 kcal"), not by what is "still open".
    status = kcalRating?.tone === 'green' ? { tone: 'green', text: '✓ Im Ziel' } : { tone: 'orange', text: kcalRef ? `${Math.round(kcal).toLocaleString('de-DE')} von ${kcalRef.toLocaleString('de-DE')} kcal` : `${eaten} / ${active.length} gegessen` };
  else if (!kcalRating) status = { tone: 'none', text: `${active.length} Mahlzeiten geplant` };
  else status = kcalRating.tone === 'green' ? { tone: 'green', text: 'Plan passt' } : { tone: 'orange', text: `Plan: ${kcalRating.message.replace(/^Noch /, '− ').replace(/ über dem Ziel$/, ' zu viel')}` };

  return { date: day.date, kcal, protein, carbs, fat, kcalRef, proteinRef, carbsRef: day.target ? Math.round(day.target.carbs * share) : undefined, fatRef: day.target ? Math.round(day.target.fat * share) : undefined, kcalTone: kcalRating?.tone ?? 'none', proteinTone: proteinRating?.tone ?? 'none', meals: active.length, eaten, cost, status };
}
