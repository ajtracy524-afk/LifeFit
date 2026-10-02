import { EXERCISES, getExercise } from '../../data/exercises';
import { CARDIO, PLAN } from '../constants';
import { MUSCLE_LABEL } from '../exerciseLibrary';
import { stressedAreas } from '../onboarding/training';
import { estimateSeconds } from '../training';
import { availableEquipment, isExcluded } from '../trainingProfile';
import type { BodyArea, CardioPlan, EquipmentItem, Exercise, Experience, MuscleGroup, TemplateExercise, TrainingLimitations, WorkoutTemplate } from '../types';

/**
 * "Dein Trainingsplan" (Prompt 8) – a pure, deterministic plan generator.
 * Sources for every rule: constants.ts → PLAN.
 *
 *   split by training days and level → sessions with their muscles
 *   per muscle the best allowed exercise (equipment, complaints by joint load,
 *   "nicht möglich", disliked last), varied between sessions
 *   sets so every muscle reaches its weekly band (synergists count half),
 *   focus muscles +25 % within the upper limit
 *   sessions fit the chosen minutes: supersets first, then visible cuts
 *   week: no heavy work for the same muscles on consecutive days, Zone 2 on
 *   rest days or after strength, HIIT not the day before legs
 */

export type SplitId = 'fb1' | 'fb2' | 'fb3' | 'ul4' | 'ulppl5' | 'ppl6';
export type SessionKind = 'full_a' | 'full_b' | 'full_c' | 'upper' | 'lower' | 'push' | 'pull' | 'legs';

/** The muscles a plan balances – arms, calves and core included. */
export const PLAN_MUSCLES: MuscleGroup[] = ['quads', 'chest', 'back', 'hamstrings', 'glutes', 'shoulders', 'biceps', 'triceps', 'calves', 'core'];
const BIG: MuscleGroup[] = ['quads', 'chest', 'back', 'hamstrings', 'glutes', 'shoulders'];
const LEGS: MuscleGroup[] = ['quads', 'hamstrings', 'glutes'];

const SESSION_MUSCLES: Record<SessionKind, MuscleGroup[]> = {
  full_a: PLAN_MUSCLES,
  full_b: PLAN_MUSCLES,
  full_c: PLAN_MUSCLES,
  upper: ['chest', 'back', 'shoulders', 'biceps', 'triceps'],
  lower: ['quads', 'hamstrings', 'glutes', 'calves', 'core'],
  push: ['chest', 'shoulders', 'triceps'],
  pull: ['back', 'biceps', 'core'],
  legs: ['quads', 'hamstrings', 'glutes', 'calves', 'core'],
};
const SESSION_NAME: Record<SessionKind, string> = {
  full_a: 'Ganzkörper A',
  full_b: 'Ganzkörper B',
  full_c: 'Ganzkörper C',
  upper: 'Oberkörper',
  lower: 'Unterkörper',
  push: 'Push',
  pull: 'Pull',
  legs: 'Beine',
};

export interface SplitInfo {
  id: SplitId;
  label: string;
  sessions: SessionKind[];
  /** Days with a strength session; the rest of the chosen days become cardio / mobility days. */
  strengthDays: number;
  reason: string;
}

const SPLITS: Record<SplitId, Omit<SplitInfo, 'reason'>> = {
  fb1: { id: 'fb1', label: 'Ganzkörper', sessions: ['full_a'], strengthDays: 1 },
  fb2: { id: 'fb2', label: 'Ganzkörper A/B', sessions: ['full_a', 'full_b'], strengthDays: 2 },
  fb3: { id: 'fb3', label: 'Ganzkörper A/B/C', sessions: ['full_a', 'full_b', 'full_c'], strengthDays: 3 },
  ul4: { id: 'ul4', label: 'Oberkörper / Unterkörper ×2', sessions: ['upper', 'lower', 'upper', 'lower'], strengthDays: 4 },
  ulppl5: { id: 'ulppl5', label: 'Ober/Unter + Push/Pull/Beine', sessions: ['upper', 'lower', 'push', 'pull', 'legs'], strengthDays: 5 },
  ppl6: { id: 'ppl6', label: 'Push/Pull/Beine ×2', sessions: ['push', 'pull', 'legs', 'push', 'pull', 'legs'], strengthDays: 6 },
};

/** The default split for a number of days and a level (the prompt's rules). */
export function defaultSplit(days: number, level: Experience): SplitId {
  if (days <= 1) return 'fb1';
  if (days === 2) return 'fb2';
  if (days === 3) return 'fb3';
  if (days === 4) return 'ul4';
  if (level === 'beginner') return days === 5 ? 'fb3' : 'ul4'; // 3–4 strength days, the rest cardio / mobility
  if (days === 5 || level === 'intermediate') return 'ulppl5';
  return 'ppl6';
}

/** Splits that fit the days and the level – the default first, each with a short reason. */
export function splitOptions(days: number, level: Experience): SplitInfo[] {
  const ids: SplitId[] = (['fb1', 'fb2', 'fb3', 'ul4', 'ulppl5', 'ppl6'] as SplitId[]).filter((id) => {
    const s = SPLITS[id];
    if (s.strengthDays > Math.max(1, days)) return false;
    if (id === 'ulppl5' && level === 'beginner') return false;
    if (id === 'ppl6' && level !== 'advanced') return false;
    return days <= 1 ? id === 'fb1' : id !== 'fb1';
  });
  const first = defaultSplit(days, level);
  return [first, ...ids.filter((id) => id !== first)].filter((id, i, a) => a.indexOf(id) === i).map((id) => ({ ...SPLITS[id], reason: splitReason(id, days, level) }));
}

function splitReason(id: SplitId, days: number, level: Experience): string {
  const extra = days - SPLITS[id].strengthDays;
  const rest = extra > 0 ? ` Die übrigen ${extra === 1 ? 'Tag wird' : `${extra} Tage werden`} Cardio- oder Mobilitätstage – Erholung gehört zum Aufbau.` : '';
  switch (id) {
    case 'fb1':
      return 'Ein Tag: ein Ganzkörpertraining – jede Muskelgruppe nur 1× pro Woche, mehr Tage wären wirksamer.';
    case 'fb2':
      return `Zwei Ganzkörper-Einheiten: jede Muskelgruppe 2× pro Woche.${rest}`;
    case 'fb3':
      return `${level === 'beginner' ? 'Der Standard für den Einstieg: ' : ''}drei Ganzkörper-Einheiten, viel Übung der Grundbewegungen, jede Muskelgruppe 3× pro Woche.${rest}`;
    case 'ul4':
      return `Ober- und Unterkörper im Wechsel: jede Muskelgruppe 2× pro Woche, kürzere Einheiten.${rest}`;
    case 'ulppl5':
      return `Ober/Unter plus Push/Pull/Beine: mehr Volumen pro Muskel – für Fortgeschrittene.${rest}`;
    case 'ppl6':
      return 'Push/Pull/Beine zweimal: hohes Volumen, nur für Erfahrene mit guter Erholung.';
  }
}

// ---------- Exercise choice ----------

/** Preferred exercises per muscle, most suitable first (compounds before isolation for big muscles). */
const PREFERRED: Record<MuscleGroup, string[]> = {
  quads: ['squat', 'leg-press', 'goblet-squat', 'split-squat', 'lunges', 'bodyweight-squat', 'leg-extension'],
  chest: ['bench-press', 'db-bench-press', 'incline-db-press', 'chest-press', 'push-up', 'dips', 'cable-fly'],
  back: ['barbell-row', 'lat-pulldown', 'db-row', 'pull-up', 'cable-row', 'assisted-pull-up', 'inverted-row', 'band-row'],
  hamstrings: ['romanian-deadlift', 'db-romanian-deadlift', 'leg-curl', 'deadlift'],
  glutes: ['hip-thrust', 'glute-bridge', 'kb-swing'],
  shoulders: ['overhead-press', 'machine-shoulder-press', 'lateral-raise', 'face-pull', 'rear-delt-fly'],
  biceps: ['biceps-curl', 'hammer-curl', 'cable-curl', 'band-curl'],
  triceps: ['triceps-pushdown', 'overhead-triceps-extension', 'close-grip-bench', 'dips'],
  calves: ['calf-raise', 'standing-calf-raise'],
  core: ['plank', 'dead-bug', 'cable-crunch', 'hanging-leg-raise'],
  forearms: [],
  cardio: [],
};

export interface PlanInput {
  /** Chosen weekdays (0 = Monday). */
  weekdays: number[];
  level: Experience;
  sessionMinutes: number;
  /** Undefined = gym (everything). */
  equipmentItems?: EquipmentItem[];
  limitations?: TrainingLimitations;
  focus?: MuscleGroup[];
  cardio?: CardioPlan;
  dislikedExercises?: string[];
  /** Another split than the default (from splitOptions). */
  split?: SplitId;
}

const LEVEL_RANK: Record<Experience, number> = { beginner: 0, intermediate: 1, advanced: 2 };

/** Candidates for a muscle that the user can do: equipment, complaints (joint load), not excluded – disliked last. */
export function candidatesFor(muscle: MuscleGroup, input: Pick<PlanInput, 'equipmentItems' | 'limitations' | 'dislikedExercises' | 'level'>): Exercise[] {
  const allowed = availableEquipment(input.equipmentItems ? { equipmentItems: input.equipmentItems } : undefined);
  const areas: BodyArea[] = input.limitations?.areas ?? [];
  const ok = (e: Exercise) =>
    e.type === 'strength' && e.primary === muscle && (!allowed || allowed.includes(e.equipment)) && !isExcluded({ limitations: input.limitations }, e.id) && stressedAreas(e.id, areas, input.limitations).length === 0;
  const preferred = PREFERRED[muscle].map((id) => getExercise(id)).filter((e): e is Exercise => !!e && ok(e));
  const rest = EXERCISES.filter((e) => ok(e) && !preferred.includes(e));
  const all = [...preferred, ...rest];
  // Beginners first get exercises of their level; disliked ones go last.
  const rank = (e: Exercise) => (input.dislikedExercises?.includes(e.id) ? 10 : 0) + Math.max(0, LEVEL_RANK[e.difficulty] - LEVEL_RANK[input.level]);
  return all.map((e, i) => ({ e, i })).sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i).map(({ e }) => e);
}

// ---------- Plan ----------

export interface PlanSession {
  kind: SessionKind;
  template: WorkoutTemplate;
  /** Muscles worked heavily (primary muscle of a compound) – for the spacing rule. */
  heavy: MuscleGroup[];
}

export type DayPlan =
  | { weekday: number; kind: 'strength'; session: number; cardioAfter?: 'zone2' }
  | { weekday: number; kind: 'extra'; extra: 'cardio' | 'mobility' }
  | { weekday: number; kind: 'rest'; cardio?: 'zone2' | 'hiit' };

export interface GeneratedPlan {
  split: SplitInfo;
  sessions: PlanSession[];
  /** 7 days, Monday first. */
  week: DayPlan[];
  /** Hard sets per muscle and week (synergists half). */
  volume: Partial<Record<MuscleGroup, number>>;
  /** Weekly band per muscle (focus raised). */
  targets: Partial<Record<MuscleGroup, [number, number]>>;
  reasons: string[];
  /** Visible adjustments ("Supersätze …", "1 Satz weniger …") and gaps. */
  notes: string[];
  /** Hints of validatePlan for the generated week (recomputed by the UI after every edit). */
  warnings: string[];
}

const isCompound = (id: string) => getExercise(id)?.mechanics === 'compound';

function bandFor(muscle: MuscleGroup, input: PlanInput): [number, number] {
  const [lo, hi] = PLAN.volume[input.level];
  if (!input.focus?.includes(muscle)) return [lo, hi];
  return [Math.min(hi, Math.round(lo * PLAN.focusBoost)), hi];
}
const targetSets = (band: [number, number], focus: boolean) => (focus ? band[1] : Math.round((band[0] + band[1]) / 2));

/** Weekly hard sets per muscle: primary × 1, secondary × PLAN.secondaryShare. */
export function weeklyVolume(sessions: Pick<PlanSession, 'template'>[]): Partial<Record<MuscleGroup, number>> {
  const v: Partial<Record<MuscleGroup, number>> = {};
  for (const s of sessions)
    for (const te of s.template.exercises) {
      const e = getExercise(te.exerciseId);
      if (!e) continue;
      v[e.primary] = (v[e.primary] ?? 0) + te.sets;
      for (const m of e.secondary) v[m] = (v[m] ?? 0) + te.sets * PLAN.secondaryShare;
    }
  return v;
}

/** How many sessions train a muscle directly (primary). */
export function frequency(sessions: Pick<PlanSession, 'template'>[], muscle: MuscleGroup): number {
  return sessions.filter((s) => s.template.exercises.some((te) => getExercise(te.exerciseId)?.primary === muscle)).length;
}

function exerciseEntry(id: string, first: boolean): TemplateExercise {
  const compound = isCompound(id);
  const [repMin, repMax] = compound ? (first ? PLAN.reps.main : PLAN.reps.compound) : PLAN.reps.isolation;
  return { exerciseId: id, sets: 2, repMin, repMax, restSec: compound ? (first ? PLAN.rest.main : PLAN.rest.compound) : PLAN.rest.isolation };
}

export function recommendPlan(input: PlanInput): GeneratedPlan {
  const days = [...new Set(input.weekdays)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  const count = Math.min(6, days.length);
  const splitId = input.split && splitOptions(count, input.level).some((s) => s.id === input.split) ? input.split : defaultSplit(count, input.level);
  const split: SplitInfo = { ...SPLITS[splitId], reason: splitReason(splitId, count, input.level) };
  const notes: string[] = [];
  if (days.length > 6) notes.push('Mindestens ein Ruhetag pro Woche – der siebte Tag bleibt frei.');
  if (days.length === 0) notes.push('Ohne Trainingstage gibt es keinen Plan – wähle im Schritt „Dein Rahmen“ deine Tage.');

  // 1. One exercise per muscle and session; sessions of the same kind use different exercises.
  const seen: Partial<Record<SessionKind, number>> = {};
  const gaps = new Set<MuscleGroup>();
  const sessions: PlanSession[] = split.sessions.map((kind, si) => {
    const variant = (seen[kind] = (seen[kind] ?? -1) + 1) + (kind.startsWith('full') ? si : 0);
    const exercises: TemplateExercise[] = [];
    for (const muscle of SESSION_MUSCLES[kind]) {
      const options = candidatesFor(muscle, input);
      if (!options.length) {
        gaps.add(muscle);
        continue;
      }
      // Big muscles: a compound first; varied between sessions.
      const pool = BIG.includes(muscle) ? (options.filter((e) => e.mechanics === 'compound').length ? options.filter((e) => e.mechanics === 'compound') : options) : options;
      const pick = pool[variant % pool.length]!;
      if (!exercises.some((x) => x.exerciseId === pick.id)) exercises.push(exerciseEntry(pick.id, exercises.length === 0));
    }
    return { kind, template: { id: '', name: SESSION_NAME[kind], focus: '', exercises }, heavy: [] };
  });
  for (const g of gaps) notes.push(`${MUSCLE_LABEL[g]}: keine passende Übung mit deinem Equipment und deinen Beschwerden – diese Lücke bleibt sichtbar, statt sie zu überspielen.`);

  // 2. Sets: every muscle into its band (target: middle, focus: top).
  const targets: Partial<Record<MuscleGroup, [number, number]>> = {};
  for (const m of PLAN_MUSCLES) if (!gaps.has(m)) targets[m] = bandFor(m, input);
  const entriesFor = (m: MuscleGroup) => sessions.flatMap((s) => s.template.exercises.filter((te) => getExercise(te.exerciseId)?.primary === m));
  for (let round = 0; round < 40; round++) {
    const v = weeklyVolume(sessions);
    let changed = false;
    for (const m of PLAN_MUSCLES) {
      const band = targets[m];
      if (!band) continue;
      const want = targetSets(band, !!input.focus?.includes(m));
      const have = v[m] ?? 0;
      const own = entriesFor(m);
      if (have < want - 0.5) {
        // Add to the exercise with the fewest sets; beyond the per-exercise cap a second exercise joins.
        const target = own.filter((te) => te.sets < PLAN.sets.maxPerExercise).sort((a, b) => a.sets - b.sets)[0];
        if (target) {
          target.sets++;
          changed = true;
        } else if (addSecondExercise(sessions, m, input)) changed = true;
      } else if (have > band[1]) {
        const target = own.filter((te) => te.sets > PLAN.sets.min).sort((a, b) => b.sets - a.sets)[0];
        if (target) {
          target.sets--;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // 3. Each session fits the minutes: supersets of isolation work first, then visible cuts.
  const budget = input.sessionMinutes * 60;
  sessions.forEach((s, si) => {
    if (estimateSeconds(s.template) <= budget) return;
    const iso = s.template.exercises.filter((te) => !isCompound(te.exerciseId));
    for (let i = 0; i + 1 < iso.length; i += 2) iso[i]!.supersetGroup = iso[i + 1]!.supersetGroup = `s${si}-${i / 2}`;
    if (iso.length >= 2) notes.push(`${s.template.name}: Supersätze bei ${iso.slice(0, iso.length - (iso.length % 2)).map((te) => getExercise(te.exerciseId)!.name).join(', ')} – passt so in ${input.sessionMinutes} min.`);
    const cut: string[] = [];
    const dropped: string[] = [];
    while (estimateSeconds(s.template) > budget) {
      // The set that costs least: of the muscle furthest above its lower bound.
      const v = weeklyVolume(sessions);
      const options = s.template.exercises.filter((te) => te.sets > PLAN.sets.min);
      if (!options.length) {
        // Fewer exercises: the one whose muscle gets most from the rest of the week goes – named, never silent.
        if (s.template.exercises.length <= 1) break;
        const vNow = weeklyVolume(sessions);
        const spare = s.template.exercises.slice(1).sort((a, b) => {
          const sa = (vNow[getExercise(a.exerciseId)!.primary] ?? 0) - (targets[getExercise(a.exerciseId)!.primary]?.[0] ?? 0);
          const sb = (vNow[getExercise(b.exerciseId)!.primary] ?? 0) - (targets[getExercise(b.exerciseId)!.primary]?.[0] ?? 0);
          return sb - sa;
        })[0]!;
        s.template.exercises = s.template.exercises.filter((te) => te !== spare);
        dropped.push(getExercise(spare.exerciseId)!.name);
        continue;
      }
      const slack = (te: TemplateExercise) => {
        const m = getExercise(te.exerciseId)!.primary;
        return (v[m] ?? 0) - (targets[m]?.[0] ?? 0);
      };
      const victim = options.sort((a, b) => slack(b) - slack(a))[0]!;
      victim.sets--;
      cut.push(getExercise(victim.exerciseId)!.name);
    }
    if (cut.length) notes.push(`${s.template.name}: für ${input.sessionMinutes} min ${cut.length === 1 ? '1 Satz' : `${cut.length} Sätze`} weniger (${[...new Set(cut)].join(', ')}).`);
    if (dropped.length) notes.push(`${s.template.name}: für ${input.sessionMinutes} min ${dropped.length === 1 ? '1 Übung' : `${dropped.length} Übungen`} weniger (${dropped.join(', ')}).`);
  });

  const volume = weeklyVolume(sessions);
  for (const m of PLAN_MUSCLES) {
    const band = targets[m];
    if (band && (volume[m] ?? 0) < band[0]) notes.push(`${MUSCLE_LABEL[m]}: ca. ${round1(volume[m] ?? 0)} statt ${band[0]}–${band[1]} Sätzen pro Woche – mehr Zeit pro Einheit oder ein Tag mehr würde es erlauben.`);
  }
  sessions.forEach((s, i) => {
    s.heavy = [...new Set(s.template.exercises.filter((te) => isCompound(te.exerciseId)).map((te) => getExercise(te.exerciseId)!.primary))];
    s.template = { ...s.template, id: `plan-${i + 1}`, focus: musclesText(s.template) };
  });

  // 4. The week.
  const week = layoutWeek(days.slice(0, 6), sessions, split, input.cardio);
  const reasons = [
    split.reason,
    `Wochenvolumen pro Muskel: ${PLAN.volume[input.level][0]}–${PLAN.volume[input.level][1]} harte Sätze${input.focus?.length ? `, für ${input.focus.map((m) => MUSCLE_LABEL[m]).join(' und ')} etwas mehr` : ''}.`,
    'Grundübungen 6–12, Isolationsübungen 10–15 Wiederholungen – jeweils mit 1–3 Wiederholungen Reserve (RIR).',
  ];
  return { split, sessions, week, volume, targets, reasons, notes, warnings: validatePlan({ sessions, week, sessionMinutes: input.sessionMinutes }) };
}

function addSecondExercise(sessions: PlanSession[], muscle: MuscleGroup, input: PlanInput): boolean {
  const options = candidatesFor(muscle, input);
  for (const s of sessions) {
    if (!SESSION_MUSCLES[s.kind].includes(muscle)) continue;
    const used = new Set(s.template.exercises.map((te) => te.exerciseId));
    const second = options.find((e) => !used.has(e.id));
    // Up to three exercises per muscle and session – enough for the upper volume bands with 2 sessions.
    if (second && s.template.exercises.filter((te) => getExercise(te.exerciseId)?.primary === muscle).length < 3) {
      s.template.exercises.push(exerciseEntry(second.id, false));
      return true;
    }
  }
  return false;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function musclesText(t: WorkoutTemplate): string {
  const primaries = [...new Set(t.exercises.map((te) => getExercise(te.exerciseId)?.primary).filter((m): m is MuscleGroup => !!m && BIG.includes(m)))];
  return primaries.map((m) => MUSCLE_LABEL[m]).join(', ');
}

/**
 * Sessions onto the chosen days (in order), extra days for splits with fewer
 * strength days, cardio of the plan: Zone 2 on rest days or after strength,
 * HIIT on a rest day that is not right before legs.
 */
export function layoutWeek(days: number[], sessions: PlanSession[], split: Pick<SplitInfo, 'strengthDays'>, cardio: CardioPlan | undefined): DayPlan[] {
  const strengthDays = spread(days, split.strengthDays);
  const week: DayPlan[] = Array.from({ length: 7 }, (_, weekday) => ({ weekday, kind: 'rest' }) as DayPlan);
  strengthDays.forEach((d, i) => (week[d] = { weekday: d, kind: 'strength', session: i }));
  const extraKind: 'cardio' | 'mobility' = !cardio || cardio.kind === 'none' || cardio.kind === 'steps' ? 'cardio' : 'mobility';
  for (const d of days) if (!strengthDays.includes(d)) week[d] = { weekday: d, kind: 'extra', extra: extraKind };

  const legsOn = (d: number) => {
    const day = week[d % 7]!;
    return day.kind === 'strength' && sessions[day.session]!.heavy.some((m) => LEGS.includes(m));
  };
  const zone2 = cardio?.kind === 'zone2' || cardio?.kind === 'mix' ? CARDIO.zone2.perWeek : 0;
  const hiit = cardio?.kind === 'hiit' ? CARDIO.hiit.perWeek : 0;
  const restDays = () => week.filter((d) => d.kind === 'rest' && !('cardio' in d && d.cardio)).map((d) => d.weekday);
  for (let i = 0; i < hiit; i++) {
    const d = restDays().find((x) => !legsOn(x + 1));
    if (d !== undefined) week[d] = { weekday: d, kind: 'rest', cardio: 'hiit' };
  }
  for (let i = 0; i < zone2; i++) {
    const d = restDays()[0];
    if (d !== undefined) week[d] = { weekday: d, kind: 'rest', cardio: 'zone2' };
    else {
      const s = week.find((x) => x.kind === 'strength' && !x.cardioAfter);
      if (s && s.kind === 'strength') week[s.weekday] = { ...s, cardioAfter: 'zone2' };
    }
  }
  return week;
}

/**
 * `count` of the chosen days with the largest smallest gap between them (around the
 * week, Sunday → Monday included) – rest days between strength sessions. Earliest wins a tie.
 */
function spread(days: number[], count: number): number[] {
  if (count >= days.length) return days;
  let best: { pick: number[]; gap: number } | undefined;
  const choose = (start: number, pick: number[]) => {
    if (pick.length === count) {
      const gap = Math.min(...pick.map((d, i) => (i + 1 < pick.length ? pick[i + 1]! - d : pick[0]! + 7 - d)));
      if (!best || gap > best.gap) best = { pick: [...pick], gap };
      return;
    }
    for (let i = start; i < days.length; i++) choose(i + 1, [...pick, days[i]!]);
  };
  choose(0, []);
  return best!.pick;
}

/**
 * Hints for a plan – shown at once after every change, never blocking:
 * the same muscles heavy on consecutive days, HIIT the day before legs, a
 * muscle trained less than twice, a session longer than the chosen minutes.
 */
export function validatePlan(p: { sessions: PlanSession[]; week: DayPlan[]; sessionMinutes: number }): string[] {
  const out: string[] = [];
  const day = (d: number) => p.week[((d % 7) + 7) % 7]!;
  for (let d = 0; d < 7; d++) {
    const a = day(d);
    const b = day(d + 1);
    if (a.kind === 'strength' && b.kind === 'strength') {
      const same = p.sessions[a.session]!.heavy.filter((m) => p.sessions[b.session]!.heavy.includes(m));
      if (same.length) out.push(`${WEEKDAY[d]} und ${WEEKDAY[(d + 1) % 7]}: ${same.map((m) => MUSCLE_LABEL[m]).join(', ')} an zwei Tagen hintereinander schwer – besser einen Tag Pause dazwischen.`);
    }
    if (a.kind === 'rest' && a.cardio === 'hiit' && b.kind === 'strength' && p.sessions[b.session]!.heavy.some((m) => LEGS.includes(m))) out.push(`${WEEKDAY[d]}: HIIT am Tag vor dem Beintraining – die Beine sind dann nicht frisch.`);
  }
  const strength = p.week.filter((d): d is Extract<DayPlan, { kind: 'strength' }> => d.kind === 'strength').map((d) => p.sessions[d.session]!);
  if (strength.length >= 2) {
    for (const m of PLAN_MUSCLES) {
      const f = frequency(strength, m);
      if (f > 0 && f < PLAN.minFrequency) out.push(`${MUSCLE_LABEL[m]} wird nur ${f}× pro Woche trainiert – 2× wäre wirksamer.`);
    }
  }
  for (const s of p.sessions) if (estimateSeconds(s.template) > p.sessionMinutes * 60 + 60) out.push(`${s.template.name} dauert ca. ${Math.round(estimateSeconds(s.template) / 60)} min – länger als deine ${p.sessionMinutes} min.`);
  return out;
}

const WEEKDAY = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

// ---------- Edits (pure, for the week overview) ----------

/** Two days swap their content (strength, cardio, rest) – the sessions keep their exercises. */
export function swapDays(week: DayPlan[], a: number, b: number): DayPlan[] {
  const next = week.map((d) => ({ ...d }));
  const da = { ...week[a]!, weekday: b } as DayPlan;
  const db = { ...week[b]!, weekday: a } as DayPlan;
  next[b] = da;
  next[a] = db;
  return next;
}

/** One exercise of a session for another (sets, reps and rest follow the new exercise's kind). */
export function replaceExercise(sessions: PlanSession[], session: number, index: number, exerciseId: string): PlanSession[] {
  return sessions.map((s, i) => {
    if (i !== session) return s;
    const exercises = s.template.exercises.map((te, k) => (k === index ? { ...exerciseEntry(exerciseId, k === 0), sets: te.sets, ...(te.supersetGroup ? { supersetGroup: te.supersetGroup } : {}) } : te));
    const template = { ...s.template, exercises };
    return { ...s, template: { ...template, focus: musclesText(template) }, heavy: [...new Set(exercises.filter((te) => isCompound(te.exerciseId)).map((te) => getExercise(te.exerciseId)!.primary))] };
  });
}
