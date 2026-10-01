import { bmi, fatFreeMass, rfmEstimate } from './body';
import {
  CALORIE_FLOOR,
  ENERGY_ROUND_KCAL,
  FAT_MIN,
  FORECAST_PACE_SPREAD,
  GOAL_BMI,
  GOAL_BODY_FAT,
  KCAL_PER_KG,
  MAX_DEFICIT_SHARE,
  MIN_DEFICIT_SHARE,
  PACE,
  PROTEIN_PER_KG,
  PROTEIN_REFERENCE_BODY_FAT,
} from './constants';
import { addDays } from './dates';
import type { GoalType, ISODate, Macros, Sex } from './types';

/**
 * Goal recommendation, calories from the pace, macros and forecast – pure and
 * tested; every threshold in domain/constants.ts with its source. The user
 * always has the last word: the recommendation only orders the options.
 */

export type Pace = 'gentle' | 'normal' | 'brisk';
export type Confidence = 'hoch' | 'mittel' | 'niedrig';
export type ExperienceBucket = 'never' | 'lt1' | '1to2' | '3to5' | 'gt5';

export const GOAL_LABEL: Record<GoalType, string> = {
  fat_loss: 'Fett verlieren',
  recomp: 'Recomposition',
  muscle_gain: 'Muskelaufbau',
  maintain: 'Halten & Gesundheit',
};

export const GOAL_SUBTITLE: Record<GoalType, string> = {
  fat_loss: 'Körperfett reduzieren, Muskeln erhalten',
  recomp: 'Fett verlieren und Muskeln aufbauen',
  muscle_gain: 'Lean Bulk – langsam und sauber zunehmen',
  maintain: 'Gewicht halten, fitter und kräftiger werden',
};

export interface GoalInput {
  sex: Sex;
  age?: number;
  pregnancy?: 'no' | 'pregnant' | 'breastfeeding';
  bodyFat?: { percent: number; method: 'measured' | 'navy' | 'rfm' | 'visual' };
  weightKg?: number;
  heightCm?: number;
  waistCm?: number;
  experience?: ExperienceBucket;
  paused?: boolean;
  /** Total energy and calorie floor – "Halten" when there is hardly room for a deficit (E2). */
  tdee?: number;
  floor?: number;
}

export interface GoalRecommendation {
  recommended: GoalType;
  /** The other goals that can be chosen, most fitting first. */
  alternatives: GoalType[];
  /** Goals not offered, with a friendly reason. */
  blocked: { goal: GoalType; reason: string }[];
  reasons: string[];
  confidence: Confidence;
  /** Only "Halten & Gesundheit" is possible (under 18, pregnancy / breastfeeding). */
  locked: boolean;
  /** What the recommendation rests on. */
  basis: 'bodyFat' | 'rfm' | 'bmi' | 'none';
  /** "Mit Körperfettangabe wird die Empfehlung genauer" etc. */
  note?: string;
}

const ALL_GOALS: GoalType[] = ['fat_loss', 'recomp', 'muscle_gain', 'maintain'];

/** Thresholds for the sex; "keine Angabe": the mean of both. */
function bands(sex: Sex) {
  if (sex !== 'unspecified') return GOAL_BODY_FAT[sex];
  const m = GOAL_BODY_FAT.male;
  const f = GOAL_BODY_FAT.female;
  return { high: (m.high + f.high) / 2, low: (m.low + f.low) / 2, veryLow: (m.veryLow + f.veryLow) / 2 };
}

const pct = (n: number) => `${Math.round(n)} %`;
const isBeginnerLike = (i: GoalInput) => !i.experience || i.experience === 'never' || i.experience === 'lt1' || !!i.paused;

export function isMinor(age: number | undefined): boolean {
  return age !== undefined && age < 18;
}

export function recommendGoal(i: GoalInput): GoalRecommendation {
  // 1. Safety first: under 18, pregnancy or breastfeeding → only "Halten & Gesundheit".
  const pregnant = i.pregnancy === 'pregnant' || i.pregnancy === 'breastfeeding';
  if (isMinor(i.age) || pregnant) {
    const reason = pregnant
      ? 'In Schwangerschaft und Stillzeit plant LifeFit kein Kaloriendefizit. Deinen Mehrbedarf besprichst du am besten mit deiner Hebamme oder Ärztin bzw. deinem Arzt.'
      : 'Unter 18 plant LifeFit kein Kaloriendefizit – dein Körper braucht die Energie für die Entwicklung.';
    return {
      recommended: 'maintain',
      alternatives: [],
      blocked: ALL_GOALS.filter((g) => g !== 'maintain').map((goal) => ({ goal, reason })),
      reasons: [reason, 'Training macht dich trotzdem fitter und kräftiger.'],
      confidence: 'hoch',
      locked: true,
      basis: 'none',
    };
  }

  const beginner = isBeginnerLike(i);
  const b = bands(i.sex);
  const value = bmi(i.weightKg, i.heightCm);
  const blocked: GoalRecommendation['blocked'] = [];
  const reasons: string[] = [];
  let order: GoalType[];
  let basis: GoalRecommendation['basis'];
  let confidence: Confidence;
  let note: string | undefined;

  // 2. What we know about body fat: own value / tape → hoch; RFM or visual → mittel; RFM from the waist → mittel; BMI → niedrig.
  let fat: number | undefined = i.bodyFat?.percent;
  if (i.bodyFat) {
    basis = 'bodyFat';
    confidence = i.bodyFat.method === 'measured' || i.bodyFat.method === 'navy' ? 'hoch' : 'mittel';
  } else if (i.waistCm && i.heightCm) {
    fat = rfmEstimate(i.sex, { heightCm: i.heightCm, waistCm: i.waistCm })?.percent;
    basis = fat !== undefined ? 'rfm' : 'none';
    confidence = 'mittel';
    note = 'Mit einer Körperfettangabe wird die Empfehlung genauer.';
  } else if (value !== undefined) {
    basis = 'bmi';
    confidence = 'niedrig';
    note = 'Mit Körperfettangabe wird die Empfehlung genauer.';
  } else {
    basis = 'none';
    confidence = 'niedrig';
    note = 'Mit Gewicht, Größe und Körperfett können wir dir ein Ziel empfehlen.';
  }

  if (fat !== undefined) {
    const source = basis === 'rfm' ? 'aus deinem Taillenumfang geschätzt' : 'nach deiner Angabe';
    if (fat >= b.high) {
      order = beginner ? ['fat_loss', 'recomp', 'maintain', 'muscle_gain'] : ['fat_loss', 'maintain', 'recomp', 'muscle_gain'];
      reasons.push(`Körperfett ca. ${pct(fat)} (${source}) – im oberen Bereich.`, 'Ein moderates Defizit senkt das Körperfett, viel Protein und Krafttraining erhalten die Muskeln.');
      if (beginner) reasons.push('Als Einsteiger oder Wiedereinsteiger ist auch Recomposition realistisch.');
    } else if (fat >= b.low) {
      order = beginner ? ['recomp', 'fat_loss', 'maintain', 'muscle_gain'] : ['fat_loss', 'muscle_gain', 'maintain', 'recomp'];
      reasons.push(`Körperfett ca. ${pct(fat)} (${source}) – im mittleren Bereich.`);
      reasons.push(beginner ? 'Als Einsteiger oder Wiedereinsteiger kannst du gleichzeitig Fett verlieren und Muskeln aufbauen.' : 'Mit Trainingserfahrung klappt beides selten gleichzeitig: erst Fett verlieren, danach gezielt aufbauen.');
    } else {
      order = ['muscle_gain', 'maintain', 'recomp', 'fat_loss'];
      reasons.push(`Körperfett ca. ${pct(fat)} (${source}) – im niedrigen Bereich.`, 'Gute Voraussetzungen für einen langsamen, sauberen Muskelaufbau.');
    }
    if (fat < b.veryLow) blocked.push({ goal: 'fat_loss', reason: `Mit ca. ${pct(fat)} Körperfett bist du schon sehr schlank – weiteres Abnehmen bieten wir nicht an. Muskelaufbau oder Halten passen besser.` });
  } else if (value !== undefined) {
    if (value >= GOAL_BMI.high) {
      order = beginner ? ['fat_loss', 'recomp', 'maintain', 'muscle_gain'] : ['fat_loss', 'maintain', 'recomp', 'muscle_gain'];
      reasons.push('Dein BMI liegt deutlich über dem Referenzbereich.');
    } else if (value >= GOAL_BMI.elevated) {
      order = beginner ? ['recomp', 'fat_loss', 'maintain', 'muscle_gain'] : ['maintain', 'muscle_gain', 'fat_loss', 'recomp'];
      reasons.push(beginner ? 'Dein BMI liegt etwas über dem Referenzbereich – als Einsteiger ist Recomposition realistisch.' : 'Mit Trainingserfahrung sagt der BMI wenig – vieles davon können Muskeln sein. Halten ist ein guter Start.');
    } else if (value >= GOAL_BMI.underweight) {
      order = beginner ? ['recomp', 'muscle_gain', 'maintain', 'fat_loss'] : ['muscle_gain', 'maintain', 'recomp', 'fat_loss'];
      reasons.push(beginner ? 'Dein BMI liegt im Referenzbereich – als Einsteiger kannst du Fett verlieren und Muskeln aufbauen.' : 'Dein BMI liegt im Referenzbereich – gute Voraussetzungen für Muskelaufbau.');
    } else {
      order = ['muscle_gain', 'maintain', 'recomp', 'fat_loss'];
      reasons.push('Dein BMI liegt unter dem Referenzbereich – Muskelaufbau mit leichtem Überschuss passt gut.');
    }
  } else {
    order = ['maintain', 'recomp', 'muscle_gain', 'fat_loss'];
    reasons.push('Noch zu wenige Angaben – Halten ist ein guter Start, du kannst jederzeit wechseln.');
  }

  if (value !== undefined && value < GOAL_BMI.underweight && !blocked.some((x) => x.goal === 'fat_loss')) {
    blocked.push({ goal: 'fat_loss', reason: 'Dein BMI liegt unter 18,5 – Abnehmen bieten wir nicht an. Muskelaufbau oder Halten passen besser.' });
  }

  let allowed = order.filter((g) => !blocked.some((x) => x.goal === g));
  // 3. Hardly room for a deficit (low total energy close to the floor) → "Halten" (E2).
  if (allowed[0] === 'fat_loss' && i.tdee && i.floor !== undefined && (i.tdee - i.floor) / i.tdee < MIN_DEFICIT_SHARE) {
    allowed = ['maintain', ...allowed.filter((g) => g !== 'maintain')];
    reasons.unshift('Dein Energiebedarf liegt nah an der Untergrenze – ein Defizit hätte kaum Spielraum, deshalb empfehlen wir Halten.');
    if (i.sex === 'unspecified') note = 'Mit der Angabe deines Geschlechts wird die Berechnung genauer.';
  }

  return { recommended: allowed[0]!, alternatives: allowed.slice(1), blocked, reasons, confidence, locked: false, basis, ...(note ? { note } : {}) };
}

// ---------- Calories ----------

export function calorieFloorFor(sex: Sex, bmr: number): number {
  return Math.max(bmr * CALORIE_FLOOR.bmrFactor, CALORIE_FLOOR[sex]);
}

export interface GoalCaloriesInput {
  goal: GoalType;
  pace?: Pace;
  tdee: number;
  bmr: number;
  sex: Sex;
  weightKg: number;
  experience?: 'beginner' | 'intermediate' | 'advanced';
  /** Under 18 or pregnancy / breastfeeding: never a deficit. */
  noDeficit?: boolean;
}

export interface GoalCalories {
  kcal: number;
  /** Planned weekly weight change in kg (after the safety limits). */
  weeklyChangeKg: number;
  /** The deficit was limited to 25 % of the total energy. */
  capped: boolean;
  /** The calorie floor applied. */
  floored: boolean;
}

/**
 * Daily calories from the total energy and the pace (≈ 7'700 kcal per kg).
 * Safety: never below the floor (BMR × 1.1, 1'200 w / 1'500 m and "keine
 * Angabe"), the deficit never above 25 % of the total, no deficit at all
 * under 18 or in pregnancy / breastfeeding. The strictest rule wins.
 */
export function goalCalories(i: GoalCaloriesInput): GoalCalories {
  const pace = i.pace ?? 'normal';
  let delta = 0;
  if (i.goal === 'fat_loss') delta = (i.weightKg * (PACE.fat_loss[pace] / 100) * KCAL_PER_KG) / 7;
  else if (i.goal === 'muscle_gain') {
    const rates = i.experience === 'intermediate' || i.experience === 'advanced' ? PACE.muscle_gain.trained : PACE.muscle_gain.beginner;
    delta = (i.weightKg * (rates[pace] / 100) * KCAL_PER_KG) / 7;
  } else if (i.goal === 'recomp') delta = i.tdee * PACE.recomp[pace];

  if (i.noDeficit && delta < 0) delta = 0;
  let kcal = i.tdee + delta;
  const minByShare = i.tdee * (1 - MAX_DEFICIT_SHARE);
  const capped = kcal < minByShare;
  if (capped) kcal = minByShare;
  const floor = calorieFloorFor(i.sex, i.bmr);
  const floored = kcal < floor;
  if (floored) kcal = floor;
  kcal = Math.round(kcal / ENERGY_ROUND_KCAL) * ENERGY_ROUND_KCAL;
  // Recomposition aims at a stable weight; otherwise the real energy difference decides.
  const weeklyChangeKg = i.goal === 'recomp' ? 0 : ((kcal - i.tdee) * 7) / KCAL_PER_KG;
  return { kcal, weeklyChangeKg, capped, floored };
}

// ---------- Macros ----------

export interface MacroInput {
  kcal: number;
  weightKg: number;
  goal: GoalType;
  sex: Sex;
  bodyFatPct?: number;
  targetWeightKg?: number;
}

/** The weight protein (and the fat minimum) is based on: with high body fat the target weight or the weight at a moderate body fat. */
export function referenceWeight(i: Pick<MacroInput, 'weightKg' | 'sex' | 'bodyFatPct' | 'targetWeightKg'>): number {
  if (i.bodyFatPct === undefined || i.bodyFatPct < bands(i.sex).high) return i.weightKg;
  if (i.targetWeightKg && i.targetWeightKg < i.weightKg) return i.targetWeightKg;
  const atModerate = fatFreeMass(i.weightKg, i.bodyFatPct) / (1 - PROTEIN_REFERENCE_BODY_FAT[i.sex] / 100);
  return Math.min(i.weightKg, atModerate);
}

/**
 * Protein 1.6–2.2 g/kg (upper end in a deficit), fat ≥ 0.8 g/kg and ≥ 20 %
 * of the energy, the rest carbohydrates. Grams are rounded; the sum matches
 * the calories within rounding.
 */
export function macroTargets(i: MacroInput): Macros {
  const ref = referenceWeight(i);
  const protein = Math.round(Math.min(ref * PROTEIN_PER_KG[i.goal], PROTEIN_PER_KG.maxPerDay));
  const fat = Math.round(Math.max(ref * FAT_MIN.perKg, (i.kcal * FAT_MIN.share) / 9));
  const carbs = Math.max(0, Math.round((i.kcal - protein * 4 - fat * 9) / 4));
  return { kcal: i.kcal, protein, carbs, fat };
}

// ---------- Forecast ----------

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** "Mitte März" / "Ende April 2027" – a part of a month, never an exact day. */
export function monthPart(date: ISODate, today: ISODate): string {
  const day = Number(date.slice(8, 10));
  const part = day <= 10 ? 'Anfang' : day <= 20 ? 'Mitte' : 'Ende';
  const year = date.slice(0, 4);
  return `${part} ${MONTHS[Number(date.slice(5, 7)) - 1]}${year !== today.slice(0, 4) ? ` ${year}` : ''}`;
}

export interface Forecast {
  targetWeightKg: number;
  from: ISODate;
  to: ISODate;
  /** "ca. Mitte März bis Ende April" */
  label: string;
}

/**
 * When a target weight (or target body fat) would be reached at the planned
 * pace – as a period: the real pace is assumed between 75 % and 125 % of the
 * plan. Undefined when the target lies in the other direction or there is no
 * planned change.
 */
export function forecast(i: { weightKg: number; weeklyChangeKg: number; today: ISODate; targetWeightKg?: number; targetBodyFat?: number; bodyFatPct?: number }): Forecast | undefined {
  const target =
    i.targetWeightKg ?? (i.targetBodyFat !== undefined && i.bodyFatPct !== undefined ? fatFreeMass(i.weightKg, i.bodyFatPct) / (1 - i.targetBodyFat / 100) : undefined);
  if (target === undefined || !i.weeklyChangeKg) return undefined;
  const diff = target - i.weightKg;
  if (Math.sign(diff) !== Math.sign(i.weeklyChangeKg) || Math.abs(diff) < 0.1) return undefined;
  const weeks = diff / i.weeklyChangeKg;
  const [slow, fast] = FORECAST_PACE_SPREAD;
  const from = addDays(i.today, Math.round((weeks / fast) * 7));
  const to = addDays(i.today, Math.round((weeks / slow) * 7));
  const a = monthPart(from, i.today);
  const b = monthPart(to, i.today);
  return { targetWeightKg: Math.round(target * 10) / 10, from, to, label: a === b ? `ca. ${a}` : `ca. ${a} bis ${b}` };
}

/**
 * "Gilt das noch?" – a pregnancy / breastfeeding answer is asked again after
 * about 3 months (E4), so it never sticks forever.
 */
export function pregnancyRecheckDue(answer: { value: 'no' | 'pregnant' | 'breastfeeding'; updatedAt: string } | undefined, today: ISODate, days: number): boolean {
  if (!answer || answer.value === 'no') return false;
  return addDays(answer.updatedAt.slice(0, 10), days) <= today;
}
