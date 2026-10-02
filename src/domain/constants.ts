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

// ---------- Goal recommendation ----------

/**
 * Body fat bands for the goal recommendation (percent). Orientation from the
 * ACE body fat categories (American Council on Exercise: "obese" from about
 * 25 % for men and 32 % for women; "fitness" around 14–17 % / 21–24 %). The
 * prompt's starting points (25 / 33 and 15 / 23) sit within these ranges and
 * are used as such. "Very low" (no fat loss offered): men < 8 %, women < 15 %
 * – near essential fat (ACE: 2–5 % / 10–13 %), cf. Helms, Aragon & Fitschen,
 * J Int Soc Sports Nutr 2014;11:20 on the risks of very lean phases.
 */
export const GOAL_BODY_FAT = {
  male: { high: 25, low: 15, veryLow: 8 },
  female: { high: 33, low: 23, veryLow: 15 },
} as const;

/**
 * Recomposition (losing fat and building muscle at once) is realistic mainly
 * for beginners, people returning after a break and those with more body fat
 * (Barakat et al., Strength Cond J 2020;42(5):7–21, "Body Recomposition: Can
 * Trained Individuals Build Muscle and Lose Fat at the Same Time?").
 */
export const RECOMP_NOTE = 'Barakat et al. 2020';

/** Without body fat: BMI bands as a rough substitute (WHO classes, see BMI_CLASSES). */
export const GOAL_BMI = { underweight: 18.5, high: 30, elevated: 25 } as const;

/** When the possible deficit (target energy above the floor) is below this share of the total, "Halten" is recommended (E2). */
export const MIN_DEFICIT_SHARE = 0.1;

// ---------- Pace & calories ----------

/**
 * Approximation: about 7'700 kcal per kg of body weight change (the classic
 * 3'500 kcal per pound; Wishnofsky 1958). Real changes are not linear (Hall et
 * al., Lancet 2011;378:826–837) – that is why the app shows a period, not a
 * date, and adapts the target to the real weight trend.
 */
export const KCAL_PER_KG = 7700;

/**
 * Weekly change in % of body weight per pace.
 *   fat loss: 0.5 / 0.75 / 1 % – Helms, Aragon & Fitschen 2014 (0.5–1 %/week preserves lean mass)
 *   muscle gain: beginners 0.25–0.5 %, trained 0.1–0.25 %/week – Iraki et al., Sports 2019;7(7):154
 *   recomposition: maintenance to −10 % of the total energy (prompt; Barakat et al. 2020)
 */
export const PACE = {
  fat_loss: { gentle: -0.5, normal: -0.75, brisk: -1 },
  muscle_gain: {
    beginner: { gentle: 0.25, normal: 0.375, brisk: 0.5 },
    trained: { gentle: 0.1, normal: 0.175, brisk: 0.25 },
  },
  /** Share of the total energy (not of body weight). */
  recomp: { gentle: 0, normal: -0.05, brisk: -0.1 },
} as const;

/** Safety: the deficit never exceeds this share of the total energy (prompt; in line with Helms et al. 2014). */
export const MAX_DEFICIT_SHARE = 0.25;

/** Calorie floor (E11): max(BMR × 1.1; 1'200 kcal women / 1'500 kcal men and "keine Angabe"). */
export const CALORIE_FLOOR = { bmrFactor: 1.1, female: 1200, male: 1500, unspecified: 1500 } as const;

/** The forecast shows a period: the real pace is assumed between 75 % and 125 % of the planned one. */
export const FORECAST_PACE_SPREAD = [0.75, 1.25] as const;

// ---------- Macros ----------

/**
 * Protein in g per kg of (reference) body weight, within 1.6–2.2 g/kg:
 * 1.6 g/kg covers the benefit for muscle gain on average (Morton et al., Br J
 * Sports Med 2018;52:376–384, upper confidence limit ≈ 2.2 g/kg); in a deficit
 * the upper end protects lean mass (Helms et al. 2014; ISSN position stand,
 * Jäger et al., J Int Soc Sports Nutr 2017;14:20). Hard cap per day for very
 * heavy people.
 */
export const PROTEIN_PER_KG = { fat_loss: 2.2, recomp: 2.0, muscle_gain: 1.8, maintain: 1.6, maxPerDay: 220 } as const;

/**
 * With high body fat, protein is based on a reference weight instead of the
 * current one: the target weight if given, else the weight at a moderate body
 * fat (fat-free mass / (1 − reference)). Reference = the middle of the "mid"
 * band (men 20 %, women 28 %).
 */
export const PROTEIN_REFERENCE_BODY_FAT = { male: 20, female: 28, unspecified: 24 } as const;

/** Fat at least 0.8 g/kg and at least 20 % of the energy (ISSN 2017; Helms et al. 2014: 20–30 %). */
export const FAT_MIN = { perKg: 0.8, share: 0.2 } as const;

// ---------- Area B: food (Prompt 4) ----------

/**
 * Food preferences 👍 / 👎 as affinity per ingredient (the learned scale is
 * −1 … +1, explicitly avoided tastes −4). "Mag ich nicht" is stronger than
 * everything else, so such a recipe is planned only when nothing else fits
 * (E23); "mag ich" is a small, capped bonus. No source – a product decision.
 */
export const FOOD_PREFERENCE = { like: 0.3, likeMax: 0.6, dislike: -8 } as const;

/**
 * Feasibility check in the onboarding: fewer allowed recipes per meal than
 * this → a hint with a suggestion instead of an empty plan later. 3 keeps a
 * week from repeating one dish more than every other day.
 */
export const MIN_RECIPES_PER_SLOT = 3;

/** Household size: shopping amounts only (people who eat along). */
export const HOUSEHOLD = { min: 1, max: 8 } as const;

/** Cooking time levels in minutes; "egal" = no limit. The recipes' minutes are the truth (E13). */
export const COOKING_TIME_MIN = { '15': 15, '30': 30, '45': 45, any: Number.POSITIVE_INFINITY } as const;

// ---------- Area B: the typical week (Prompt 5) ----------

/**
 * Eating out: no recipe, no purchase, a reserved share of the day instead of
 * a kcal number (E12). Reserved kcal = the slot's usual share × size × place.
 * Restaurant meals tend to be larger than canteen meals, meals at friends'
 * in between – rough orientation, no source; the user picks the size.
 * Out meals are assumed to be low in protein (15 % of their energy vs. ~25 %
 * planned at home), so the planner shifts protein to the meals at home.
 */
export const EATING_OUT = {
  size: { small: 0.7, normal: 1, large: 1.4 },
  place: { canteen: 1, restaurant: 1.2, friends: 1.1 },
  /** Share of the out meal's energy assumed to come from protein. */
  proteinShare: 0.15,
  /** Logged "as planned": the rest of the energy split into carbs / fat (by energy). */
  carbShareOfRest: 0.55,
} as const;

/** Tolerance for the day with out meals: planned + reserved within ±10 % kcal, protein at least 90 % (same as the planner's day tests). */
export const DAY_TOLERANCE = { kcal: 0.1, protein: 0.1 } as const;

// ---------- Area B: pantry (Prompt 6) ----------

/**
 * Pantry: a fill level is a share of the catalog package (voll / halb / Rest).
 * Stock whose best-before date is near is used first: within `soonDays` the
 * planner's "unused stock" weight grows up to (1 + expiryWeight) – for every
 * category, not only perishables. No source – product decisions.
 */
export const PANTRY = { level: { full: 1, half: 0.5, rest: 0.15 }, soonDays: 5, expiryWeight: 2 } as const;

/** Serial scan: the same barcode again within this time is the same product (one detection, several frames). */
export const SCAN_REPEAT_MS = 2500;
