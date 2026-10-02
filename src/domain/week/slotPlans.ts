import { EATING_OUT } from '../constants';
import { slotShare } from '../planner';
import { excludedSlots, slotPlanOf, templateDay, type TemplateDay } from '../timeBudget';
import type { AppState, DayContext, EatingOutPlace, EatingOutSize, ISODate, Macros, MealSlot, SlotPlan, Weekday, WeekTemplate } from '../types';

/**
 * "Deine typische Woche" (Prompt 5) – pure rules on top of the one slot model
 * (timeBudget.slotPlanOf): the template recurs, a single week deviates in
 * dayContexts without touching it.
 *
 *   home / togo → planned and bought (to go: portable recipes only)
 *   out         → no recipe, no purchase, a reserved budget (assumed low in protein)
 *   skip        → no meal; its share goes to the other meals of the day (E12)
 *   removed     → "Entfernt" spontaneously in the plan: the share stays reserved (E12)
 */

type SlotState = Pick<AppState, 'dayContexts' | 'nutritionProfile'>;

const contextOf = (state: SlotState, date: ISODate): DayContext | undefined => state.dayContexts?.[date];

export function templateOn(state: SlotState, date: ISODate): TemplateDay | undefined {
  return templateDay(state.nutritionProfile?.weekTemplate, date);
}

export function slotPlanOn(state: SlotState, date: ISODate, slot: MealSlot): SlotPlan {
  return slotPlanOf(contextOf(state, date), templateOn(state, date), slot);
}

/** Slots the plan leaves out on a date: out, skip and removed. */
export function excludedSlotsOn(state: SlotState, date: ISODate): MealSlot[] {
  return excludedSlots(contextOf(state, date), templateOn(state, date));
}

export interface ReservedMeal {
  slot: MealSlot;
  kcal: number;
  protein: number;
  reason: 'out' | 'removed';
  plan?: Extract<SlotPlan, { kind: 'out' }>;
}

export interface PlanTarget {
  /** What the planned meals of the day should reach together. */
  target: Macros;
  reserved: ReservedMeal[];
  /** The day's slots without the skipped ones. */
  active: MealSlot[];
}

/** Budget of an out meal: the slot's share × size × place, protein by the low-protein assumption. */
export function outBudget(dayKcal: number, share: number, plan: Extract<SlotPlan, { kind: 'out' }>): { kcal: number; protein: number } {
  const kcal = dayKcal * share * EATING_OUT.size[plan.size ?? 'normal'] * (plan.place ? EATING_OUT.place[plan.place] : 1);
  return { kcal, protein: (kcal * EATING_OUT.proteinShare) / 4 };
}

/**
 * The target for the planned meals of a day. Out meals reserve their budget
 * and – as low-protein meals – leave MORE protein to the meals at home
 * (protein compensation); skipped meals hand their share to the others.
 * `alsoRemoved` = slots handled otherwise today ("Anders gegessen").
 */
export function planTargetOf(target: Macros, slots: MealSlot[], context: DayContext | undefined, template: TemplateDay | undefined, alsoRemoved: MealSlot[] = []): PlanTarget {
  const active = slots.filter((s) => slotPlanOf(context, template, s).kind !== 'skip');
  const reserved: ReservedMeal[] = [];
  for (const slot of active) {
    const plan = slotPlanOf(context, template, slot);
    const share = slotShare([slot], active);
    if (plan.kind === 'out') reserved.push({ slot, reason: 'out', plan, ...outBudget(target.kcal, share, plan) });
    else if (context?.removedSlots?.includes(slot) || alsoRemoved.includes(slot)) reserved.push({ slot, reason: 'removed', kcal: target.kcal * share, protein: target.protein * share });
  }
  const kcal = Math.max(0, target.kcal - reserved.reduce((s, r) => s + r.kcal, 0));
  const ratio = target.kcal > 0 ? kcal / target.kcal : 0;
  return {
    target: { kcal, protein: Math.max(0, target.protein - reserved.reduce((s, r) => s + r.protein, 0)), carbs: target.carbs * ratio, fat: target.fat * ratio },
    reserved,
    active,
  };
}

export function planTargetOn(state: SlotState, date: ISODate, target: Macros, alsoRemoved: MealSlot[] = []): PlanTarget {
  return planTargetOf(target, state.nutritionProfile?.slots ?? [], contextOf(state, date), templateOn(state, date), alsoRemoved);
}

// ---------- Editing the template (pure, for the step's quick actions) ----------

export const WEEKDAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];
export const WORKDAYS: Weekday[] = [0, 1, 2, 3, 4];

/** Next state when a slot is tapped: Zuhause → Mitnehmen → Auswärts → Auslassen → Zuhause. */
export function nextPlan(plan: SlotPlan): SlotPlan {
  switch (plan.kind) {
    case 'home':
      return { kind: 'togo' };
    case 'togo':
      return { kind: 'out' };
    case 'out':
      return { kind: 'skip' };
    default:
      return { kind: 'home' };
  }
}

/** Sets one slot; "Zuhause" is the default and is not stored. */
export function setSlot(template: WeekTemplate, day: Weekday, slot: MealSlot, plan: SlotPlan): WeekTemplate {
  const next: WeekTemplate = { ...template, [day]: { ...template[day] } };
  if (plan.kind === 'home') delete next[day]![slot];
  else next[day]![slot] = plan;
  if (!Object.keys(next[day]!).length) delete next[day];
  return next;
}

/** "Mo–Fr Mittag auswärts" and friends: one slot on several days. */
export function setSlotOn(template: WeekTemplate, days: Weekday[], slot: MealSlot, plan: SlotPlan): WeekTemplate {
  return days.reduce((t, d) => setSlot(t, d, slot, plan), template);
}

/** Row: a day's plan onto other days. */
export function copyDay(template: WeekTemplate, from: Weekday, to: Weekday[], slots: MealSlot[]): WeekTemplate {
  return to.reduce((t, day) => slots.reduce((tt, slot) => setSlot(tt, day, slot, template[from]?.[slot] ?? { kind: 'home' }), t), template);
}

/** Column: one slot of a day onto the same slot of other days. */
export function copySlot(template: WeekTemplate, slot: MealSlot, from: Weekday, to: Weekday[]): WeekTemplate {
  return setSlotOn(template, to, slot, template[from]?.[slot] ?? { kind: 'home' });
}

export const PLACE_LABEL: Record<EatingOutPlace, string> = { canteen: 'Kantine', restaurant: 'Restaurant', friends: 'bei Freunden' };
export const SIZE_LABEL: Record<EatingOutSize, string> = { small: 'klein', normal: 'normal', large: 'groß' };

/**
 * "Wie geplant gegessen" (Prompt 5): the reserved budget as one quick entry –
 * protein as assumed for out meals, the rest split into carbs and fat.
 */
export function outMealEntry(plan: Extract<SlotPlan, { kind: 'out' }> | undefined, reserved: { kcal: number; protein: number }): { name: string; method: 'quick'; macros: Macros } {
  const kcal = Math.round(reserved.kcal);
  const protein = Math.round(reserved.protein);
  const rest = Math.max(0, kcal - protein * 4);
  const carbs = Math.round((rest * EATING_OUT.carbShareOfRest) / 4);
  const fat = Math.round((rest * (1 - EATING_OUT.carbShareOfRest)) / 9);
  const where = plan?.place ? ` (${PLACE_LABEL[plan.place]})` : '';
  return { name: `Auswärts${where}`, method: 'quick', macros: { kcal, protein, carbs, fat } };
}

/**
 * A deviation for this week only (Prompt 5): stored in the day context, the
 * template stays untouched. Choosing what the day would be anyway removes the
 * deviation again, so nothing is stored without a reason.
 */
export function weekSlotOverride(context: DayContext | undefined, template: TemplateDay | undefined, slot: MealSlot, plan: SlotPlan): Partial<Record<MealSlot, SlotPlan>> {
  const { [slot]: _own, ...others } = context?.slots ?? {};
  const without = slotPlanOf({ ...(context ?? { timeBudget: 'normal', mode: 'normal' }), slots: others }, template, slot);
  return without.kind === plan.kind && (plan.kind !== 'out' || (without.kind === 'out' && without.place === plan.place && without.size === plan.size)) ? others : { ...others, [slot]: plan };
}
