import { getProgram, PROGRAMS } from '../data/exercises';
import { addDays, daysBetween, weekStart } from './dates';
import { scheduleForWeek } from './training';
import type { Experience, GoalType, ISODate, TrainingEquipment, TrainingSetup, WorkoutProgram } from './types';

/**
 * Which program fits – simple, explainable rules instead of one plan for all:
 *
 * - equipment first: bodyweight → Körpergewicht, home → Zuhause (both full body)
 * - 1–2 days → full body (every muscle twice a week needs full body)
 * - 3 days: beginner → full body (fat loss: full body + one easy Zone-2 session),
 *   intermediate → Push / Pull / Beine
 * - 4 days → Oberkörper / Unterkörper
 * - 5–6 days → Push / Pull / Beine
 *
 * Beginners never get a split that needs more days or technique than they have.
 */
export function recommendProgram(input: { days: number; experience: Experience; goal?: GoalType; equipment?: TrainingEquipment }): string {
  const { days, experience, goal, equipment = 'gym' } = input;
  if (equipment === 'bodyweight') return 'bodyweight-basics';
  if (equipment === 'home') return 'home-full-body';
  if (days <= 2) return 'full-body';
  if (days === 3) {
    if (experience !== 'beginner') return 'push-pull-legs';
    return goal === 'fat_loss' ? 'strength-cardio' : 'full-body';
  }
  if (days === 4) return 'upper-lower';
  return 'push-pull-legs';
}

/** One line why – shown next to "Empfohlen". */
export function recommendationReason(input: { days: number; experience: Experience; goal?: GoalType; equipment?: TrainingEquipment }): string {
  const id = recommendProgram(input);
  if (id === 'bodyweight-basics') return 'Ohne Geräte – alles mit dem eigenen Körpergewicht.';
  if (id === 'home-full-body') return 'Für zu Hause mit Kurzhanteln.';
  if (id === 'strength-cardio') return 'Kraft erhält die Muskeln, Zone 2 bringt Bewegung – Fett verlierst du über das Defizit.';
  if (id === 'full-body') return input.days <= 2 ? 'Mit wenigen Tagen trainierst du so jeden Muskel zweimal pro Woche.' : 'Einfach zu lernen und jeder Muskel zweimal pro Woche.';
  if (id === 'upper-lower') return 'Vier Tage: jeder Muskel zweimal pro Woche, gut erholt.';
  return 'Fokussierte Einheiten für mehr Trainingstage.';
}

/** The built-in programs that fit the equipment (gym shows everything). */
export function programsFor(equipment: TrainingEquipment = 'gym'): WorkoutProgram[] {
  if (equipment === 'gym') return PROGRAMS;
  return PROGRAMS.filter((p) => p.equipment === equipment || (equipment === 'home' && p.equipment === 'bodyweight'));
}

/** "Woche 1: Mo Push · Mi Pull · Fr Beine" – the real rotation of the first weeks, from the scheduler. */
export function programPreview(programId: string, weekdays: number[], from: ISODate, weeks = 2): Array<{ week: number; days: Array<{ weekday: number; name: string }> }> {
  const start = weekStart(from);
  return Array.from({ length: weeks }, (_, i) => {
    const ws = addDays(start, i * 7);
    const days = scheduleForWeek({ programId, weekdays }, ws).map((s) => ({ weekday: daysBetween(ws, s.date), name: s.template.name }));
    return { week: i + 1, days };
  });
}

/** "Woche 3 von 12" – only when the program has a duration and a start. */
export function programWeek(setup: TrainingSetup | null, today: ISODate): { week: number; of: number } | undefined {
  if (!setup?.startedAt) return undefined;
  const weeks = getProgram(setup.programId)?.weeks;
  if (!weeks) return undefined;
  const week = Math.floor(daysBetween(weekStart(setup.startedAt), weekStart(today)) / 7) + 1;
  return week >= 1 ? { week, of: weeks } : undefined;
}
