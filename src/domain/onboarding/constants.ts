import type { ActivityLevel, GoalType, MealSlot } from '../types';

/**
 * Central constants of the new onboarding (docs/ONBOARDING_PLAN.md, Grundregel
 * "Konstanten-Datei mit Quellenkommentar"). Formulas and thresholds of the
 * later steps (BMI, Navy, RFM, FFMI, energy, goal) are added here in their
 * sessions – each with its source.
 */

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

/**
 * Accuracy of body fat values taken over from older data (± percentage points),
 * used only to show them as a range. A measured value (scale, caliper, DEXA)
 * is typically within ±3–4 percentage points (consumer BIA scales and calipers,
 * cf. ACSM's Guidelines for Exercise Testing and Prescription); a visual
 * estimate within ±5 (as stated in docs/ONBOARDING_PROMPTS.md, Prompt 2).
 */
export const MIGRATED_BODY_FAT_RANGE = { measured: 3, visual: 5 } as const;

/** "Gilt das noch?" for pregnancy / breastfeeding (E4). */
export const PREGNANCY_RECHECK_DAYS = 91;
