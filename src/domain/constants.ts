import type { ActivityLevel, GoalType, MealSlot } from './types';

/**
 * Central constants for body analysis, energy and the onboarding
 * (docs/ONBOARDING_PLAN.md, Grundregel "Konstanten-Datei mit Quellenkommentar").
 * Every factor and threshold names its source. Later sessions (goal, macros,
 * safety) add theirs here.
 */

// ---------- Onboarding ----------

/** Version of the stored OnboardingProfile (independent of the app's schemaVersion). */
export const ONBOARDING_VERSION = 1;

/**
 * Neutral start values for an app used without (or before finishing) the
 * onboarding. Not statistics about anybody: they only make the app usable and
 * are stored with source 'default', so the summary and the "Neue Angaben
 * ergänzen" card ask for the real values later.
 */
export const DEFAULT_SETUP = {
  weightKg: 70,
  heightCm: 170,
  age: 35,
  /** "keine Angabe": energy formulas use the mean of the sex constants (E2). */
  sex: 'unspecified',
  activity: 'light' as ActivityLevel,
  goal: 'maintain' as GoalType,
  /**
   * Two to three strength days per week – the WHO recommendation for adults is
   * muscle-strengthening activity on at least 2 days per week
   * (WHO Guidelines on physical activity and sedentary behaviour, 2020).
   */
  weekdays: [0, 2, 4],
  slots: ['breakfast', 'snack', 'lunch', 'dinner'] as MealSlot[],
} as const;

/** "Gilt das noch?" for pregnancy / breastfeeding (E4). */
export const PREGNANCY_RECHECK_DAYS = 91;

// ---------- Plausibility of inputs (a friendly hint, never a block) ----------

export const PLAUSIBLE = {
  weightKg: [30, 300],
  heightCm: [120, 230],
  /** Age from the birth year – the app is made for adults; under 18 the safety rules apply (Prompt 3). */
  age: [14, 100],
  waistCm: [40, 200],
  neckCm: [20, 70],
  hipCm: [50, 200],
  bodyFatPct: [3, 60],
} as const;

// ---------- BMI ----------

/**
 * WHO BMI classification for adults (WHO Technical Report Series 894, 2000).
 * Labels are neutral on purpose; the WHO terms are shown in the "Warum?" sheet.
 */
export const BMI_CLASSES = [
  { max: 18.5, key: 'below', label: 'Unter dem Referenzbereich', who: 'WHO: Untergewicht (< 18,5)' },
  { max: 25, key: 'within', label: 'Im Referenzbereich', who: 'WHO: Normalgewicht (18,5–24,9)' },
  { max: 30, key: 'above', label: 'Über dem Referenzbereich', who: 'WHO: Präadipositas (25–29,9)' },
  { max: Infinity, key: 'well_above', label: 'Deutlich über dem Referenzbereich', who: 'WHO: Adipositas (≥ 30)' },
] as const;

/** From this BMI on, the "BMI and muscles" card is highlighted (lower limit of the WHO class "Präadipositas"). */
export const BMI_HIGHLIGHT_FROM = 25;

// ---------- Waist-to-height ratio ----------

/**
 * "Keep your waist circumference to less than half your height": WHtR < 0.5 as
 * a simple screening value for central fat (Ashwell, Gunn & Gibson, Obes Rev
 * 2012;13:275–286). From 0.6 the risk rises clearly (same review).
 */
export const WHTR = { guide: 0.5, clearlyAbove: 0.6 } as const;

// ---------- Body fat ----------

/**
 * US Navy circumference method (Hodgdon & Beckett, Naval Health Research
 * Center, Reports 84-11 (men) and 84-29 (women), 1984), metric form with log10 and cm:
 *   men:   %BF = 495 / (1.0324 − 0.19077·log10(waist − neck) + 0.15456·log10(height)) − 450
 *   women: %BF = 495 / (1.29579 − 0.35004·log10(waist + hip − neck) + 0.22100·log10(height)) − 450
 * Accuracy compared to reference methods about ±3–4 percentage points.
 */
export const NAVY = {
  male: { a: 1.0324, b: 0.19077, c: 0.15456 },
  female: { a: 1.29579, b: 0.35004, c: 0.221 },
  accuracy: 3.5,
} as const;

/**
 * Relative Fat Mass (Woolcott & Bergman, Sci Rep 2018;8:10980):
 *   men: 64 − 20·(height / waist), women: 76 − 20·(height / waist).
 * Validated against DXA; the estimate is shown with about ±4 percentage points.
 */
export const RFM = { male: 64, female: 76, factor: 20, accuracy: 4 } as const;

/** Own measured value (scale, caliper, DXA): consumer devices are typically within about ±3 percentage points. */
export const MEASURED_ACCURACY = 3;

/** Visual comparison: about ±5 percentage points (docs/ONBOARDING_PROMPTS.md, Prompt 2). */
export const VISUAL_ACCURACY = 5;

/**
 * Visual comparison stages (body fat in %), with features in words. The bands
 * follow the usual visual estimation charts for men and women; they are an
 * orientation, not a measurement – the result is always shown as a range.
 */
export const VISUAL_STAGES = {
  male: [
    { from: 8, to: 10, features: 'Bauchmuskeln deutlich sichtbar, Konturen sehr klar' },
    { from: 11, to: 14, features: 'Bauchmuskeln bei Licht sichtbar, Konturen klar' },
    { from: 15, to: 19, features: 'Bauchmuskeln kaum sichtbar, Konturen noch erkennbar' },
    { from: 20, to: 24, features: 'Leichter Bauchansatz, Konturen weich' },
    { from: 25, to: 30, features: 'Bauch gerundet, Konturen kaum sichtbar' },
    { from: 31, to: 40, features: 'Bauch und Hüften rund, Taille so breit wie die Brust oder breiter' },
  ],
  female: [
    { from: 15, to: 19, features: 'Bauchmuskeln teils sichtbar, Arme und Beine definiert' },
    { from: 20, to: 24, features: 'Flacher Bauch, Konturen sichtbar' },
    { from: 25, to: 29, features: 'Konturen weich, leichte Rundungen an Hüfte und Oberschenkeln' },
    { from: 30, to: 34, features: 'Rundungen an Bauch, Hüfte und Oberschenkeln' },
    { from: 35, to: 40, features: 'Bauch gerundet, Konturen kaum sichtbar' },
    { from: 41, to: 50, features: 'Rundungen am ganzen Körper, Taille kaum abgesetzt' },
  ],
} as const;

// ---------- Fat-free mass index ----------

/**
 * FFMI = fat-free mass / height², normalised to 1.80 m: + 6.1 · (1.8 − height).
 * Kouri et al., Clin J Sport Med 1995;5:223–228 (normalisation and the upper
 * limit of about 25 for men without anabolic steroids). The bands for women
 * are about 3–4 points lower (e.g. Schutz et al., Int J Obes 2002;26:953–960,
 * reference values of fat-free mass index in adults).
 */
export const FFMI = {
  normalizeHeightM: 1.8,
  normalizeFactor: 6.1,
  bands: {
    male: [18, 20, 22, 25],
    female: [15, 17, 19, 21],
  },
  labels: ['Unter dem Durchschnitt', 'Durchschnittlich', 'Über dem Durchschnitt', 'Deutlich über dem Durchschnitt', 'Sehr hoch – selten ohne langjähriges Training'],
} as const;

// ---------- Energy ----------

/**
 * Mifflin-St Jeor (Mifflin et al., Am J Clin Nutr 1990;51:241–247):
 *   10·kg + 6.25·cm − 5·age + s, s = +5 (men) / −161 (women).
 * "Keine Angabe": the mean of both, −78 (E2) – shown as the range between both.
 */
export const MIFFLIN = { kg: 10, cm: 6.25, age: 5, male: 5, female: -161, unspecified: -78 } as const;

/** Katch-McArdle (McArdle, Katch & Katch, Exercise Physiology): BMR = 370 + 21.6 · fat-free mass (kg). */
export const KATCH_MCARDLE = { base: 370, perKgFfm: 21.6 } as const;

/**
 * Everyday activity WITHOUT planned training (job, steps), as a factor on the
 * basal metabolic rate. The four steps follow the common PAL multipliers
 * (sitting 1.2 … very active), slightly below the classic values that already
 * contain sport (1.55 / 1.725), because training is added separately below –
 * no double counting (docs/ONBOARDING_PROMPTS.md, Prompt 2; FAO/WHO/UNU, Human
 * energy requirements, 2004, for the PAL concept).
 */
export const ACTIVITY_FACTOR: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.5,
  active: 1.65,
};

/** Step ranges shown with the activity levels (examples, not a rule). */
export const ACTIVITY_STEPS: Record<ActivityLevel, string> = {
  sedentary: 'weniger als 5’000 Schritte',
  light: '5’000–8’000 Schritte',
  moderate: '8’000–12’000 Schritte, stehender Beruf',
  active: 'körperliche Arbeit, mehr als 12’000 Schritte',
};

/**
 * Training surcharge per planned strength session: net energy above rest =
 * (MET − 1) · kg · hours. Strength training with several exercises, 8–15
 * reps: 3.5 MET (Ainsworth et al., Compendium of Physical Activities 2011,
 * code 02054). "− 1 MET" because resting energy is already in BMR × factor.
 * Spread over the week as a daily average.
 */
export const TRAINING_SURCHARGE = { strengthMet: 3.5, defaultMinutes: 60 } as const;

/** Energy values are rounded to this (a start value, not a measurement). */
export const ENERGY_ROUND_KCAL = 10;
