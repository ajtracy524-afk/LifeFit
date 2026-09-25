import type { FitnessGoal, Profile } from '../types';
import type { Recommendation, SafetyFlag, SafetyStatus } from './types';

/**
 * Guardrails – the part of the engine that must NEVER be delegated to an LLM.
 *
 * LifeFit gives fitness and everyday nutrition recommendations for healthy
 * adults. It does not diagnose, does not treat and does not give medical
 * nutrition advice. When the data suggests a situation outside that scope,
 * the engine switches to safe mode: no suggestions to eat less, only a neutral
 * pointer to qualified professionals.
 */

export const DISCLAIMER =
  'LifeFit gibt allgemeine Fitness- und Ernährungsempfehlungen für gesunde Erwachsene. Sie ersetzen keine ärztliche oder ernährungstherapeutische Beratung.';

export const SAFETY_THRESHOLDS = {
  minAge: 18,
  underweightBmi: 18.5,
  /** Weekly loss as % of body weight that is considered too fast. */
  rapidLossPct: 1.5,
  /** Average intake below this share of the target (≥ 4 logged days) … */
  veryLowIntakeRatio: 0.6,
  minLoggedDays: 4,
} as const;

export interface SafetyInput {
  profile: Pick<Profile, 'age' | 'heightCm'> | null;
  goal: Pick<FitnessGoal, 'type'> | null;
  weightKg?: number;
  /** kg per week, negative = losing. */
  weeklyRateKg?: number;
  recentIntake?: { loggedDays: number; avgKcal: number; targetKcal: number };
}

export function computeSafety({ profile, goal, weightKg, weeklyRateKg, recentIntake }: SafetyInput): SafetyStatus {
  const flags: SafetyFlag[] = [];
  const T = SAFETY_THRESHOLDS;

  if (profile && profile.age < T.minAge) flags.push('minor');

  if (profile && weightKg && goal?.type === 'fat_loss') {
    const bmi = weightKg / (profile.heightCm / 100) ** 2;
    if (bmi < T.underweightBmi) flags.push('underweight_deficit');
  }

  if (weightKg && weeklyRateKg !== undefined && (weeklyRateKg / weightKg) * 100 < -T.rapidLossPct) flags.push('rapid_loss');

  if (
    recentIntake &&
    recentIntake.targetKcal > 0 &&
    recentIntake.loggedDays >= T.minLoggedDays &&
    recentIntake.avgKcal < recentIntake.targetKcal * T.veryLowIntakeRatio
  ) {
    flags.push('very_low_intake');
  }

  return { restricted: flags.length > 0, flags };
}

const FLAG_REASON: Record<SafetyFlag, string> = {
  minor: 'Die Berechnungen in LifeFit sind für Erwachsene ausgelegt.',
  underweight_deficit: 'Dein Gewicht liegt im Verhältnis zur Größe bereits niedrig für ein Abnehmziel.',
  rapid_loss: 'Dein Gewicht sinkt aktuell sehr schnell.',
  very_low_intake: 'Deine erfassten Mahlzeiten liegen seit mehreren Tagen deutlich unter dem Ziel.',
};

/**
 * Applies the non-negotiable rules to the rule output:
 * 1. Safe mode removes everything that would increase a deficit.
 * 2. Safe mode adds exactly one neutral notice – no diagnosis, no numbers to hit.
 */
export function applyGuardrails(recs: Recommendation[], safety: SafetyStatus, date: string): Recommendation[] {
  if (!safety.restricted) return recs;
  const kept = recs.filter((r) => !r.increasesDeficit);
  const notice: Recommendation = {
    id: `safety:${date}`,
    kind: 'safety',
    domain: 'safety',
    priority: 'high',
    confidence: 'high',
    title: 'Keine Empfehlungen zum Kaloriensparen',
    message:
      'LifeFit schlägt in dieser Situation nicht vor, weniger zu essen. Wenn du Fragen zu Ernährung, Gewicht oder Gesundheit hast, sprich bitte mit einer Ärztin, einem Arzt oder einer qualifizierten Ernährungsfachkraft.',
    reasons: safety.flags.map((f) => FLAG_REASON[f]),
    facts: { flags: safety.flags.join(',') },
    actions: [],
  };
  return [notice, ...kept];
}

// ---------- Validation of generated text (LLM output) ----------

/**
 * Terms that indicate medical claims or harmful advice. Generated texts that
 * contain them are discarded and the deterministic template text is shown.
 */
const FORBIDDEN: { pattern: RegExp; reason: string }[] = [
  { pattern: /diagnos|befund|krankheit|erkrank|syndrom|symptom/i, reason: 'medizinische Diagnose' },
  { pattern: /therapi|behandl|heil(t|en|ung)|kurier|linder/i, reason: 'Heilversprechen / Behandlung' },
  { pattern: /medikament|arznei|tablette|dosier|dosis|rezeptpflicht/i, reason: 'Medikamente / Dosierung' },
  { pattern: /diabet|insulin|blutzucker|cholesterin|blutdruck|schilddrüse|niere|leber/i, reason: 'Krankheitsbezug' },
  { pattern: /(nährstoff|vitamin|eisen|mineral)\w*mangel|mangelerscheinung/i, reason: 'Mangel-Diagnose' },
  { pattern: /ess-?störung|magersucht|anorexi|bulimi/i, reason: 'Essstörung – nur Safe-Mode-Text' },
  {
    pattern: /\bfast(e|en|est|et)\b|(aus|weg)lassen|\bläss?t?\b[^.!?]*\bweg\b|\blass\b[^.!?]*\b(weg|aus)\b|hungern|nichts (mehr )?essen/i,
    reason: 'Restriktive Anweisung',
  },
  { pattern: /(ab|weg)trainieren|kalorien verbrennen, um|ausgleichen/i, reason: 'Kompensationsverhalten' },
  { pattern: /entgift|detox|abführ|erbrech/i, reason: 'Schädliche Praktik' },
];

export interface TextCheck {
  ok: boolean;
  violations: string[];
}

/**
 * Deterministic check for generated coach text:
 * – no medical / harmful wording
 * – every number ≥ 10 must come from the recommendation's facts (no invented values)
 */
export function validateCoachText(text: string, facts: Record<string, number | string | boolean> = {}): TextCheck {
  const violations = FORBIDDEN.filter((f) => f.pattern.test(text)).map((f) => f.reason);

  const allowed = Object.values(facts).filter((v): v is number => typeof v === 'number');
  // German notation: "1.850" = 1850, "0,5" = 0.5
  for (const match of text.matchAll(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/g)) {
    const n = Number(match[0].replace(/\./g, '').replace(',', '.'));
    if (n < 10) continue;
    const grounded = allowed.some((a) => Math.abs(a - n) <= Math.max(1, Math.abs(a) * 0.02));
    if (!grounded) violations.push(`Zahl ohne Datengrundlage: ${match[0]}`);
  }

  return { ok: violations.length === 0, violations };
}
