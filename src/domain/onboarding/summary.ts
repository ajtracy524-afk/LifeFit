import { fmt } from '../../lib/format';
import { getFood } from '../../data/foods';
import { ageFromBirthYear, bmi, bmiClass, energyEstimate, ffmi, whtr, whtrClass } from '../body';
import { ALLERGEN_LABEL } from '../catalogTags';
import { addDays, daysBetween } from '../dates';
import { forecast, GOAL_LABEL, goalCalories } from '../goal';
import { targetForDate } from '../nutrition';
import { recommendPlan, type PlanInput } from '../training/recommendPlan';
import type { AppState, ISODate, Macros, MealSlot, SlotPlan, WeekTemplate } from '../types';
import { defaultCoreSetup, isSetupComplete } from './migrate';
import type { Field, OnboardingProfile, OnboardingStepId, PlanDraft } from './types';

/**
 * "Dein Plan" (Prompt 9) – what the onboarding has made of the answers, as
 * pure data for the summary cards. Every card names the step that changes it,
 * and which of its values are only estimated or defaults.
 */

export interface SummaryCard {
  id: 'body' | 'goal' | 'energy' | 'food' | 'training';
  title: string;
  lines: string[];
  /** The step "Ändern" opens. */
  step: OnboardingStepId;
  /** Values that are estimated or defaults ("geschätzt – ergänzen?"). */
  estimated: string[];
  /** Number-free mode: kcal lines are replaced by portions. */
  numberFree?: boolean;
}

const r1 = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const r2 = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const soft = (f: Field<unknown> | undefined) => !f || f.source === 'estimated' || f.source === 'default';

/** The plan input of "Dein Trainingsplan": the answers of area C, the setup as fallback. */
export function planInputOf(state: AppState): PlanInput {
  const t = state.onboarding?.training ?? {};
  const setup = state.training;
  return {
    weekdays: t.weekdays?.value ?? setup?.weekdays ?? [0, 2, 4],
    level: t.level?.value ?? state.profile?.experience ?? 'beginner',
    sessionMinutes: t.sessionMinutes?.value ?? setup?.sessionMinutes ?? 60,
    ...(setup?.equipmentItems ? { equipmentItems: setup.equipmentItems } : {}),
    ...(setup?.limitations ? { limitations: setup.limitations } : {}),
    ...(setup?.musclePriorities?.length ? { focus: setup.musclePriorities } : {}),
    ...(setup?.cardio ? { cardio: setup.cardio } : {}),
    ...(setup?.dislikedExercises?.length ? { dislikedExercises: setup.dislikedExercises } : {}),
  };
}

export const planKeyOf = (i: PlanInput) => JSON.stringify(i);

/** The plan as the user sees it: the edited draft if it fits the answers, otherwise freshly generated. */
export function currentPlanDraft(state: AppState): PlanDraft {
  const input = planInputOf(state);
  const key = planKeyOf(input);
  const stored = state.onboarding?.training.planDraft?.value;
  if (stored && stored.key === key) return stored;
  const p = recommendPlan(input);
  return { key, split: p.split.id, sessions: p.sessions, week: p.week };
}

const SLOT_SHORT: Record<MealSlot, string> = { breakfast: 'Frühstück', snack: 'Snack', lunch: 'Mittag', snack2: 'Snack 2', dinner: 'Abend' };
const KIND_TEXT: Record<SlotPlan['kind'], string> = { home: 'zuhause', togo: 'mitnehmen', out: 'auswärts', skip: 'ausgelassen' };
const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** "Mittag: Mo–Fr auswärts · Abend: Fr auswärts" – the typical week in one line, home left out. */
export function compactWeekTemplate(template: WeekTemplate | undefined, slots: MealSlot[]): string {
  if (!template) return 'jeden Tag zuhause';
  const parts: string[] = [];
  for (const slot of slots) {
    const byKind = new Map<SlotPlan['kind'], number[]>();
    for (let d = 0; d < 7; d++) {
      const kind = template[d as 0]?.[slot]?.kind ?? 'home';
      if (kind !== 'home') byKind.set(kind, [...(byKind.get(kind) ?? []), d]);
    }
    for (const [kind, days] of byKind) parts.push(`${SLOT_SHORT[slot]}: ${dayRange(days)} ${KIND_TEXT[kind]}`);
  }
  return parts.length ? parts.join(' · ') : 'jeden Tag zuhause';
}

function dayRange(days: number[]): string {
  const runs: string[] = [];
  let start = days[0]!;
  for (let i = 1; i <= days.length; i++) {
    if (days[i] !== days[i - 1]! + 1) {
      const end = days[i - 1]!;
      runs.push(end - start >= 2 ? `${WD[start]}–${WD[end]}` : end === start ? WD[start]! : `${WD[start]}, ${WD[end]}`);
      start = days[i]!;
    }
  }
  return runs.join(', ');
}

export function summaryOf(state: AppState, today: ISODate): SummaryCard[] {
  const p: OnboardingProfile = state.onboarding ?? { version: 1, progress: { completed: {}, skipped: [] }, body: {}, health: {}, goal: {}, food: {}, training: {} };
  const b = p.body;
  const setup = defaultCoreSetup(p, today, new Date(`${today}T08:00:00Z`).toISOString());
  const complete = isSetupComplete(state);
  const weight = b.weightKg?.value ?? setup.weightKg;
  const height = b.heightCm?.value ?? setup.profile.heightCm;
  const age = b.birthYear ? ageFromBirthYear(b.birthYear.value, today) : setup.profile.age;
  const sex = b.sex?.value ?? setup.profile.sex;
  const fat = b.bodyFat?.value;
  const cards: SummaryCard[] = [];

  // Körper
  const bmiValue = bmi(weight, height)!;
  const body: string[] = [`BMI ca. ${r1(bmiValue - 0.5)}–${r1(bmiValue + 0.5)} · ${bmiClass(bmiValue).label}`];
  const w = whtr(b.waistCm?.value, height);
  if (w !== undefined) body.push(`WHtR ca. ${r2(w - 0.01)}–${r2(w + 0.01)} · ${whtrClass(w).label}`);
  if (fat) {
    body.push(`Körperfett ca. ${fat.range[0]}–${fat.range[1]} %`);
    const lo = ffmi(weight, height, fat.range[1]).normalized;
    const hi = ffmi(weight, height, fat.range[0]).normalized;
    body.push(`FFMI ca. ${r1(lo)}–${r1(hi)}`);
  } else body.push('Körperfett: keine Angabe – mit einer Schätzung wird die Empfehlung genauer');
  cards.push({ id: 'body', title: 'Körper', lines: body, step: fat ? 'analysis' : 'bodyFat', estimated: [soft(b.weightKg) && 'Gewicht', soft(b.heightCm) && 'Größe', soft(b.birthYear) && 'Alter', !fat && 'Körperfett'].filter((x): x is string => !!x) });

  // Ziel und Tempo mit Prognose
  const goalType = complete && state.goal ? state.goal.type : setup.goal.type;
  const pace = p.goal.pace?.value ?? 'normal';
  const energy = energyEstimate({
    sex,
    age,
    heightCm: height,
    weightKg: weight,
    activity: b.activity?.value ?? setup.profile.activity,
    sessionsPerWeek: (p.training.weekdays?.value ?? setup.training.weekdays).length,
    ...(p.training.sessionMinutes ? { sessionMinutes: p.training.sessionMinutes.value } : {}),
    ...(fat ? { bodyFat: { method: fat.method, percent: fat.percent, range: fat.range } } : {}),
  });
  const calories = goalCalories({ goal: goalType, pace, tdee: energy.tdee, bmr: energy.bmr, sex, weightKg: weight, experience: setup.profile.experience });
  const target = p.goal.targetWeightKg?.value ?? state.goal?.targetWeightKg;
  const fc = forecast({ weightKg: weight, weeklyChangeKg: calories.weeklyChangeKg, today, ...(target ? { targetWeightKg: target } : {}), ...(p.goal.targetBodyFat ? { targetBodyFat: p.goal.targetBodyFat.value } : {}), ...(fat ? { bodyFatPct: fat.percent } : {}) });
  const PACE_TEXT = { gentle: 'sanft', normal: 'normal', brisk: 'zügig' } as const;
  const goalLines = [`${GOAL_LABEL[goalType]}${goalType === 'fat_loss' || goalType === 'muscle_gain' ? ` · Tempo ${PACE_TEXT[pace]}` : ''}`];
  if (fc) goalLines.push(`Prognose für ${r1(fc.targetWeightKg)} kg: ${fc.label}`);
  cards.push({ id: 'goal', title: 'Ziel & Tempo', lines: goalLines, step: 'goal', estimated: soft(p.goal.type) ? ['Ziel (Empfehlung)'] : [] });

  // Kalorien und Makros
  const macros: Macros = complete ? (targetForDate(state.targets, today) ?? setup.target) : setup.target;
  const numberFree = p.health.numberFree?.value === true;
  const meals = state.nutritionProfile?.slots.length ?? setup.nutritionProfile.slots.length;
  cards.push({
    id: 'energy',
    title: numberFree ? 'Portionen' : 'Kalorien & Makros',
    lines: numberFree
      ? [`${meals} Mahlzeiten am Tag – Portionen statt Zahlen`, `Protein ca. ${macros.protein} g`]
      : [`ca. ${fmt.int(macros.kcal)} kcal pro Tag`, `Protein ${macros.protein} g · Kohlenhydrate ${macros.carbs} g · Fett ${macros.fat} g`],
    step: 'goal',
    estimated: soft(b.activity) ? ['Alltagsaktivität'] : [],
    numberFree,
  });

  // Essensrahmen
  const np = state.nutritionProfile ?? setup.nutritionProfile;
  const DIET_TEXT = { omnivore: 'Alles', pescatarian: 'Pescetarisch', vegetarian: 'Vegetarisch', vegan: 'Vegan' } as const;
  const excl = [
    ...(np.allergens ?? []).map((a) => `ohne ${ALLERGEN_LABEL[a]}`),
    ...(np.intolerances ?? []).map((i) => (i === 'lactose' ? 'laktosefrei' : i === 'fructose' ? 'fruktosearm' : 'glutenfrei (Zöliakie)')),
    ...(np.noPork ? ['ohne Schwein'] : []),
    ...(np.noAlcohol ? ['ohne Alkohol'] : []),
    ...(np.excludedFoods ?? []).map((id) => `ohne ${getFood(id)?.name ?? id}`),
  ];
  const pantryCount = Object.values(state.pantry ?? {}).filter((x) => x.quantityG > 0).length;
  cards.push({
    id: 'food',
    title: 'Essensrahmen',
    lines: [
      `${DIET_TEXT[np.diet]}${excl.length ? ` · ${excl.join(', ')}` : ''}`,
      `Woche: ${compactWeekTemplate(np.weekTemplate, np.slots)}`,
      `Vorrat: ${pantryCount ? `${pantryCount} ${pantryCount === 1 ? 'Lebensmittel' : 'Lebensmittel'}` : 'noch nichts erfasst'}`,
    ],
    step: 'diet',
    estimated: [!p.food.weekTemplate && 'Wochenraster', !pantryCount && 'Vorrat'].filter((x): x is string => !!x),
  });

  // Trainingswoche
  const draft = currentPlanDraft(state);
  const strength = draft.week.filter((d) => d.kind === 'strength');
  cards.push({
    id: 'training',
    title: 'Trainingswoche',
    lines: [
      `${strength.length} Krafttage: ${strength.map((d) => `${WD[d.weekday]} ${d.kind === 'strength' ? draft.sessions[d.session]!.template.name : ''}`).join(' · ')}`,
      `${planInputOf(state).sessionMinutes} min pro Einheit`,
    ],
    step: 'plan',
    estimated: [soft(p.training.weekdays) && 'Trainingstage', soft(p.training.level) && !p.body.trainingExperience && 'Erfahrung'].filter((x): x is string => !!x),
  });
  return cards;
}

// ---------- After the onboarding: one card for the most effective missing answer ----------

export type MissingHint = 'bodyFat' | 'activity' | 'weekTemplate' | 'pantry';

export const MISSING_HINT_REST_DAYS = 14;

export const MISSING_HINT: Record<MissingHint, { text: string; step: OnboardingStepId; section: 'A' | 'B' }> = {
  bodyFat: { text: 'Mit einer Körperfett-Schätzung werden Kalorien und Protein genauer.', step: 'bodyFat', section: 'A' },
  activity: { text: 'Wie aktiv ist dein Alltag? Das verändert deinen Kalorienbedarf am stärksten.', step: 'activity', section: 'A' },
  weekTemplate: { text: 'Isst du mittags auswärts? Mit deiner typischen Woche kaufst du nur, was du wirklich kochst.', step: 'week', section: 'B' },
  pantry: { text: 'Was hast du schon zu Hause? Dann steht es nicht noch einmal auf der Einkaufsliste.', step: 'pantry', section: 'B' },
};

/**
 * At most one quiet card on Heute (also "Neue Angaben ergänzen" for users of the
 * old onboarding, E8): the most effective missing answer – body fat > everyday
 * activity > typical week > pantry. Dismissed → MISSING_HINT_REST_DAYS days of rest.
 */
export function missingHint(state: AppState, today: ISODate): MissingHint | undefined {
  const p = state.onboarding;
  if (!p || !isSetupComplete(state) || p.progress.active || pendingConfirmation(state)) return undefined;
  const until = p.notices?.completeCard?.dismissedUntil;
  if (until && today < until) return undefined;
  const fat = p.body.bodyFat ?? (state.measurements ?? []).some((m) => m.kind === 'body_fat');
  if (!fat) return 'bodyFat';
  if (!p.body.activity || p.body.activity.source === 'default') return 'activity';
  if (!p.food.weekTemplate) return 'weekTemplate';
  if (!Object.keys(state.pantry ?? {}).length) return 'pantry';
  return undefined;
}

/**
 * Migrated values still to confirm (E5, E18) – one card at a time on Heute,
 * the stricter allergen reading first; the missing-answer card waits.
 */
export function pendingConfirmation(state: Pick<AppState, 'onboarding'>): 'allergens' | 'mealPrep' | undefined {
  const food = state.onboarding?.food;
  if (food?.allergens?.source === 'migrated' || food?.intolerances?.source === 'migrated') return 'allergens';
  if (food?.mealPrep?.source === 'migrated') return 'mealPrep';
  return undefined;
}

export const restUntil = (today: ISODate): ISODate => addDays(today, MISSING_HINT_REST_DAYS);
export const daysLeft = (until: ISODate, today: ISODate) => daysBetween(today, until);
