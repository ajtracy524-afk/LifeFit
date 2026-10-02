import { EXERCISES, getExercise, jointLoad } from '../../data/exercises';
import { CARDIO, START_WEIGHT, TRAINING_LEVEL } from '../constants';
import { alternativesFor } from '../exerciseLibrary';
import { DEFAULT_ITEMS } from '../trainingProfile';
import type { BodyArea, CardioPlan, ComplaintSeverity, EquipmentItem, Exercise, Experience, GoalType, Sex, TrainingLimitations, TrainingPlace, TrainingSetup } from '../types';
import type { OnboardingProfile } from './types';

/**
 * Area C (Prompt 7) – pure rules: training level, equipment from places,
 * joint-friendly replacements for complaints (E22), cardio per goal, start
 * weights. The UI only shows them; Prompt 8 builds the plan on top.
 */

// ---------- Training level ----------

export type YearsBucket = 'never' | 'lt1' | '1to2' | '3to5' | 'gt5';

export interface LevelInput {
  years?: YearsBucket;
  /** Pause longer than 6 months. */
  pausedLong?: boolean;
  /** Normalised FFMI, only with a known body fat. */
  ffmiNormalized?: number;
  sex: Sex;
}

export interface LevelEstimate {
  level: Experience;
  reasons: string[];
  confidence: 'hoch' | 'mittel' | 'niedrig';
  /** "Muskelgedächtnis …" after a long pause. */
  note?: string;
}

const LEVELS: Experience[] = ['beginner', 'intermediate', 'advanced'];
export const LEVEL_LABEL: Record<Experience, string> = { beginner: 'Anfänger', intermediate: 'Fortgeschritten', advanced: 'Erfahren' };

/** FFMI band of the level rule: "low" / "mid" / "high" (sex-specific, "keine Angabe" the mean). */
export function ffmiBand(normalized: number, sex: Sex): 'low' | 'mid' | 'high' {
  const t = sex === 'unspecified' ? { low: (TRAINING_LEVEL.ffmi.male.low + TRAINING_LEVEL.ffmi.female.low) / 2, high: (TRAINING_LEVEL.ffmi.male.high + TRAINING_LEVEL.ffmi.female.high) / 2 } : TRAINING_LEVEL.ffmi[sex];
  return normalized < t.low ? 'low' : normalized >= t.high ? 'high' : 'mid';
}

/**
 * Starting point by training years (< 1 → Anfänger, 1–3 → Fortgeschritten,
 * > 3 → Erfahren; the "3–5 Jahre" answer counts as more than 3). A high
 * normalised FFMI moves one level up, a low one down; a pause longer than
 * 6 months one level down. Always within the three levels.
 */
export function estimateTrainingLevel(i: LevelInput): LevelEstimate {
  const reasons: string[] = [];
  let index: number;
  if (!i.years || i.years === 'never' || i.years === 'lt1') {
    index = 0;
    reasons.push(i.years ? 'Weniger als 1 Jahr Krafttraining.' : 'Ohne Angabe zur Erfahrung starten wir behutsam.');
  } else if (i.years === '1to2') {
    index = 1;
    reasons.push('1–2 Jahre Krafttraining.');
  } else {
    index = 2;
    reasons.push(i.years === '3to5' ? '3–5 Jahre Krafttraining.' : 'Mehr als 5 Jahre Krafttraining.');
  }
  if (i.ffmiNormalized !== undefined) {
    const band = ffmiBand(i.ffmiNormalized, i.sex);
    const ffmi = i.ffmiNormalized.toLocaleString('de-DE', { maximumFractionDigits: 1 });
    if (band === 'high' && index < 2) {
      index += 1;
      reasons.push(`Deine fettfreie Masse (FFMI ca. ${ffmi}) spricht für mehr Trainingserfahrung – eine Stufe höher.`);
    } else if (band === 'low' && index > 0) {
      index -= 1;
      reasons.push(`Deine fettfreie Masse (FFMI ca. ${ffmi}) liegt eher im untrainierten Bereich – eine Stufe tiefer, für einen sauberen Aufbau.`);
    } else reasons.push(`Deine fettfreie Masse (FFMI ca. ${ffmi}) passt dazu.`);
  }
  let note: string | undefined;
  if (i.pausedLong && index > 0) {
    index -= 1;
    reasons.push('Länger als 6 Monate Pause – eine Stufe tiefer zum Wiedereinstieg.');
  }
  if (i.pausedLong) note = 'Muskelgedächtnis: Du baust schneller wieder auf als beim ersten Mal.';
  const confidence = i.years && i.ffmiNormalized !== undefined ? 'hoch' : i.years ? 'mittel' : 'niedrig';
  return { level: LEVELS[index]!, reasons, confidence, ...(note ? { note } : {}) };
}

// ---------- Equipment ----------

export const PLACE_ITEMS: Record<TrainingPlace, EquipmentItem[]> = {
  gym: DEFAULT_ITEMS.gym,
  home_dumbbells: ['dumbbells', 'bench'],
  home_barbell: ['barbell', 'rack', 'bench'],
  bodyweight: [],
  bands: ['bands'],
};

export const PLACE_LABEL: Record<TrainingPlace, string> = {
  gym: 'Studio',
  home_dumbbells: 'Zuhause mit Kurzhanteln',
  home_barbell: 'Zuhause mit Langhantel & Rack',
  bodyweight: 'Nur Körpergewicht',
  bands: 'Bänder',
};

/** The pieces of equipment several places stand for (bodyweight is always possible). */
export function placesToItems(places: TrainingPlace[]): EquipmentItem[] {
  return [...new Set(places.flatMap((p) => PLACE_ITEMS[p]))];
}

// ---------- Complaints (E22) ----------

/** "leicht" → replace load 2, "deutlich" → replace load ≥ 1. */
export const severityThreshold = (s: ComplaintSeverity): 1 | 2 => (s === 'mild' ? 2 : 1);

export function severityOf(limitations: Pick<TrainingLimitations, 'severity'> | undefined, area: BodyArea): ComplaintSeverity {
  return limitations?.severity?.[area] ?? 'clear';
}

/** The complained areas an exercise loads at or above their threshold. */
export function stressedAreas(exerciseId: string, areas: BodyArea[], limitations?: Pick<TrainingLimitations, 'severity'>): BodyArea[] {
  return areas.filter((a) => jointLoad(exerciseId, a) >= severityThreshold(severityOf(limitations, a)));
}

/**
 * A joint-friendly replacement: same main muscle, never mobility work (E21),
 * below the threshold at EVERY complained area, with the user's equipment and
 * not excluded. Undefined = a gap – shown as a hint, never removed silently.
 */
export function gentleAlternative(exerciseId: string, areas: BodyArea[], setup: Pick<TrainingSetup, 'equipment' | 'equipmentItems' | 'limitations' | 'likedExercises' | 'dislikedExercises'> | null | undefined): Exercise | undefined {
  const ex = getExercise(exerciseId);
  if (!ex) return undefined;
  return alternativesFor(exerciseId, setup ?? 'gym').find((a) => a.type !== 'mobility' && a.primary === ex.primary && stressedAreas(a.id, areas, setup?.limitations).length === 0);
}

export interface ComplaintGap {
  exerciseId: string;
  areas: BodyArea[];
}

/** Every strength exercise that needs a replacement for these complaints but has none (the hint list). */
export function complaintGaps(areas: BodyArea[], setup: Parameters<typeof gentleAlternative>[2]): ComplaintGap[] {
  return EXERCISES.filter((e) => e.type === 'strength')
    .map((e) => ({ exerciseId: e.id, areas: stressedAreas(e.id, areas, setup?.limitations) }))
    .filter((g) => g.areas.length > 0 && !gentleAlternative(g.exerciseId, areas, setup));
}

// ---------- Cardio ----------

export interface CardioRecommendation {
  plan: CardioPlan;
  label: string;
  reasons: string[];
}

/**
 * Per goal: fat loss and recomposition → step goal plus 2× Zone 2 (the deficit
 * does the work, cardio helps – visceral fat, heart and circulation); muscle
 * gain → light cardio for health, not before leg training; maintain → WHO.
 */
export function recommendCardio(goal: GoalType | undefined): CardioRecommendation {
  if (goal === 'muscle_gain') {
    return {
      plan: { kind: 'steps', types: ['walking'] },
      label: `Schrittziel (ca. ${CARDIO.steps.toLocaleString('de-CH')} Schritte)`,
      reasons: ['Leichtes Cardio für Herz und Kreislauf – es bremst den Muskelaufbau nicht.', 'Nicht direkt vor dem Beintraining, damit die Beine frisch sind.'],
    };
  }
  if (goal === 'fat_loss' || goal === 'recomp') {
    return {
      plan: { kind: 'mix', types: ['walking', 'cycling'] },
      label: `Schrittziel + ${CARDIO.zone2.perWeek}× Zone 2`,
      reasons: [
        'Fett verlierst du vor allem über das Kaloriendefizit.',
        'Ausdauertraining hilft zusätzlich, besonders beim viszeralen Bauchfett, und stärkt Herz und Kreislauf.',
        `WHO-Empfehlung: ${CARDIO.whoMinutes[0]}–${CARDIO.whoMinutes[1]} Minuten moderate Bewegung pro Woche.`,
      ],
    };
  }
  return {
    plan: { kind: 'mix', types: ['walking', 'cycling'] },
    label: `Schrittziel + ${CARDIO.zone2.perWeek}× Zone 2`,
    reasons: [`WHO-Empfehlung: ${CARDIO.whoMinutes[0]}–${CARDIO.whoMinutes[1]} Minuten moderate Bewegung pro Woche – für Herz, Kreislauf und Wohlbefinden.`],
  };
}

export { cardioSessions, cardioSurcharge } from '../body';

// ---------- Start weights ----------

/** The basic lifts asked for working weights – by equipment. */
export function workingWeightExercises(items: EquipmentItem[] | undefined): string[] {
  const has = (i: EquipmentItem) => !items || items.includes(i);
  return has('barbell') ? ['squat', 'bench-press', 'deadlift', 'barbell-row', 'overhead-press'] : ['goblet-squat', 'db-bench-press', 'db-romanian-deadlift', 'db-row', 'overhead-press'];
}

/** Start weight for `repMax` reps with a reserve, from a working set (Epley), rounded to the weight step. */
export function startWeight(set: { kg: number; reps: number }, repMax: number, step: number): number | undefined {
  if (!(set.kg > 0) || !(set.reps > 0)) return undefined;
  const oneRm = set.kg * (1 + set.reps / START_WEIGHT.epleyDivisor);
  const kg = oneRm / (1 + (repMax + START_WEIGHT.reserve) / START_WEIGHT.epleyDivisor);
  return Math.max(step, Math.floor(kg / step) * step);
}

// ---------- Answers → training setup ----------

type TrainingAnswers = OnboardingProfile['training'];

/** Area C answers into the setup the app computes with; unanswered fields stay as they are. */
export function trainingSetupFrom(t: TrainingAnswers, base: TrainingSetup): TrainingSetup {
  const s: TrainingSetup = { ...base };
  if (t.weekdays?.value.length) s.weekdays = [...t.weekdays.value].sort((a, b) => a - b);
  if (t.sessionMinutes) s.sessionMinutes = t.sessionMinutes.value;
  if (t.places) s.equipmentItems = placesToItems(t.places.value);
  else if (t.equipment) s.equipmentItems = [...t.equipment.value];
  if (t.complaints) {
    const c = t.complaints.value;
    s.limitations = { areas: [...c.areas], excludedExercises: base.limitations?.excludedExercises ?? [], ...(c.note ? { note: c.note } : {}), ...(c.severity ? { severity: { ...c.severity } } : {}) };
  }
  if (t.focusMuscles) s.musclePriorities = t.focusMuscles.value.slice(0, 2);
  if (t.workingWeights) s.workingWeights = { ...t.workingWeights.value };
  if (t.cardio) s.cardio = { kind: t.cardio.value.kind, types: [...t.cardio.value.types] };
  return s;
}
