import { describe, expect, it } from 'vitest';
import { getExercise } from '../data/exercises';
import { PLAN } from './constants';
import { stressedAreas } from './onboarding/training';
import { estimateSeconds } from './training';
import {
  defaultSplit,
  frequency,
  PLAN_MUSCLES,
  recommendPlan,
  replaceExercise,
  splitOptions,
  swapDays,
  validatePlan,
  weeklyVolume,
  type DayPlan,
  type PlanInput,
} from './training/recommendPlan';
import { availableEquipment } from './trainingProfile';
import type { BodyArea, ComplaintSeverity, Experience } from './types';

/** Prompt 8 – the plan generator: split, volume, frequency, time, equipment, complaints, focus, spacing. */

const DAYS: Record<number, number[]> = { 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5] };
const LEVELS: Experience[] = ['beginner', 'intermediate', 'advanced'];
const plan = (patch: Partial<PlanInput>) => recommendPlan({ weekdays: DAYS[3]!, level: 'beginner', sessionMinutes: 75, ...patch });
const exercisesOf = (p: ReturnType<typeof recommendPlan>) => p.sessions.flatMap((s) => s.template.exercises);

describe('split by days and level', () => {
  it('follows the rules; beginners with 5–6 days get 3–4 strength days plus cardio / mobility days', () => {
    expect([2, 3, 4].map((d) => defaultSplit(d, 'beginner'))).toEqual(['fb2', 'fb3', 'ul4']);
    expect(defaultSplit(5, 'intermediate')).toBe('ulppl5');
    expect(defaultSplit(6, 'advanced')).toBe('ppl6');
    expect(defaultSplit(6, 'intermediate')).toBe('ulppl5'); // PPL ×2 only for Erfahrene
    for (const days of [5, 6]) {
      const p = plan({ weekdays: DAYS[days]!, level: 'beginner' });
      const strength = p.week.filter((d) => d.kind === 'strength').length;
      expect(strength, `${days} days`).toBeGreaterThanOrEqual(3);
      expect(strength).toBeLessThanOrEqual(4);
      expect(p.week.filter((d) => d.kind === 'extra')).toHaveLength(days - strength);
      expect(p.split.reason).toMatch(/Cardio- oder Mobilitätstage/);
    }
    expect(splitOptions(5, 'beginner').map((s) => s.id)).not.toContain('ulppl5');
    expect(splitOptions(6, 'intermediate').map((s) => s.id)).not.toContain('ppl6');
    expect(splitOptions(4, 'advanced')[0]!.id).toBe('ul4'); // the default first
  });
});

describe('volume per muscle by level', () => {
  it.each(LEVELS)('%s: every muscle within its weekly band of hard sets (synergists half) when time allows', (level) => {
    const days = level === 'beginner' ? DAYS[3]! : level === 'intermediate' ? DAYS[4]! : DAYS[6]!;
    const p = plan({ weekdays: days, level });
    const [lo, hi] = PLAN.volume[level];
    for (const m of PLAN_MUSCLES) {
      expect(p.volume[m], `${level} ${m}`).toBeGreaterThanOrEqual(lo);
      expect(p.volume[m], `${level} ${m}`).toBeLessThanOrEqual(hi);
    }
    expect(p.volume).toEqual(weeklyVolume(p.sessions));
    // Reps and intensity by exercise kind.
    for (const te of exercisesOf(p)) {
      const compound = getExercise(te.exerciseId)!.mechanics === 'compound';
      expect(te.repMin).toBeGreaterThanOrEqual(compound ? 6 : 10);
      expect(te.repMax).toBeLessThanOrEqual(compound ? 12 : 20);
    }
    expect(p.reasons.join(' ')).toMatch(/1–3 Wiederholungen Reserve/);
  });

  it('focus muscles get more volume – within the upper limit', () => {
    let raised = 0;
    for (const level of LEVELS) {
      const without = plan({ level, weekdays: DAYS[4]! });
      const focus = plan({ level, weekdays: DAYS[4]!, focus: ['chest', 'back'] });
      for (const m of ['chest', 'back'] as const) {
        const hi = PLAN.volume[level][1];
        expect(focus.volume[m]!).toBeLessThanOrEqual(hi);
        expect(focus.volume[m]!, `${level} ${m}`).toBeGreaterThanOrEqual(without.volume[m]!);
        // Synergist work can already fill a muscle to the top – then there is no room left.
        if (without.volume[m]! < hi) {
          expect(focus.volume[m]!, `${level} ${m}`).toBeGreaterThan(without.volume[m]!);
          raised++;
        }
      }
    }
    expect(raised).toBeGreaterThan(0);
  });
});

describe('frequency', () => {
  it('every muscle at least 2× per week for 2–6 days and every level', () => {
    for (const level of LEVELS)
      for (const days of [2, 3, 4, 5, 6]) {
        const p = plan({ level, weekdays: DAYS[days]! });
        const strength = p.week.filter((d): d is Extract<DayPlan, { kind: 'strength' }> => d.kind === 'strength').map((d) => p.sessions[d.session]!);
        for (const m of PLAN_MUSCLES) expect(frequency(strength, m), `${level} ${days} ${m}`).toBeGreaterThanOrEqual(2);
      }
  });
});

describe('duration', () => {
  it('every session fits the chosen minutes; cuts are named, never silent', () => {
    for (const minutes of [30, 45, 60, 75])
      for (const level of LEVELS)
        for (const days of [2, 3, 4, 6]) {
          const p = plan({ level, weekdays: DAYS[days]!, sessionMinutes: minutes });
          for (const s of p.sessions) expect(estimateSeconds(s.template), `${minutes} ${level} ${days} ${s.template.name}`).toBeLessThanOrEqual(minutes * 60);
          const full = plan({ level, weekdays: DAYS[days]!, sessionMinutes: 90 });
          const fewerSets = exercisesOf(p).reduce((n, te) => n + te.sets, 0) < exercisesOf(full).reduce((n, te) => n + te.sets, 0);
          if (fewerSets) expect(p.notes.some((n) => /(Satz|Sätze|Übungen?) weniger|statt .* Sätzen/.test(n)), `${minutes} ${level} ${days}`).toBe(true);
        }
  });

  it('uses supersets before cutting', () => {
    const p = plan({ level: 'beginner', weekdays: DAYS[3]!, sessionMinutes: 45 });
    expect(exercisesOf(p).some((te) => te.supersetGroup)).toBe(true);
    expect(p.notes.some((n) => n.includes('Supersätze'))).toBe(true);
  });
});

describe('equipment and complaints', () => {
  it('only exercises the equipment allows', () => {
    for (const items of [['dumbbells', 'bench'], [], ['bands']] as const) {
      const p = plan({ equipmentItems: [...items], level: 'intermediate', weekdays: DAYS[4]! });
      const allowed = availableEquipment({ equipmentItems: [...items] })!;
      for (const te of exercisesOf(p)) expect(allowed, `${items.join('+')}: ${te.exerciseId}`).toContain(getExercise(te.exerciseId)!.equipment);
    }
  });

  it('respects complaints by the joint load levels – and reports a muscle without any suitable exercise', () => {
    for (const s of ['mild', 'clear'] as ComplaintSeverity[])
      for (const areas of [['knee'], ['shoulder'], ['lower_back', 'wrist']] as BodyArea[][]) {
        const limitations = { areas, excludedExercises: [], severity: Object.fromEntries(areas.map((a) => [a, s])) };
        const p = plan({ limitations, level: 'intermediate', weekdays: DAYS[4]! });
        for (const te of exercisesOf(p)) expect(stressedAreas(te.exerciseId, areas, limitations), `${areas} ${s}: ${te.exerciseId}`).toEqual([]);
      }
    const knee = plan({ limitations: { areas: ['knee'], excludedExercises: [], severity: { knee: 'clear' } } });
    expect(knee.notes.some((n) => n.startsWith('Oberschenkel vorne: keine passende Übung'))).toBe(true);
    // "nicht möglich" in the profile is never planned.
    const none = plan({ limitations: { areas: [], excludedExercises: ['squat', 'leg-press'] } });
    expect(exercisesOf(none).some((te) => ['squat', 'leg-press'].includes(te.exerciseId))).toBe(false);
  });
});

describe('the week', () => {
  it('no heavy work for the same muscles on consecutive days in the generated layouts', () => {
    const layouts: [Experience, number[]][] = [
      ['beginner', [0, 2, 4]],
      ['beginner', [0, 1, 2, 3, 4]],
      ['intermediate', [0, 1, 3, 4]],
      ['intermediate', [0, 1, 2, 3, 4]],
      ['advanced', [0, 1, 2, 3, 4, 5]],
    ];
    for (const [level, weekdays] of layouts) {
      const p = plan({ level, weekdays });
      expect(p.warnings.filter((w) => w.includes('hintereinander')), `${level} ${weekdays}`).toEqual([]);
    }
  });

  it('Zone 2 on rest days or after strength, HIIT never the day before legs; checks never block', () => {
    const z = plan({ level: 'intermediate', weekdays: DAYS[4]!, cardio: { kind: 'mix', types: [] } });
    const zone2 = z.week.filter((d) => (d.kind === 'rest' && d.cardio === 'zone2') || (d.kind === 'strength' && d.cardioAfter === 'zone2'));
    expect(zone2).toHaveLength(2);
    expect(zone2.every((d) => d.kind === 'rest')).toBe(true); // rest days exist → there
    const h = plan({ level: 'intermediate', weekdays: DAYS[4]!, cardio: { kind: 'hiit', types: [] } });
    const day = h.week.find((d) => d.kind === 'rest' && d.cardio === 'hiit')!;
    const nextDay = h.week[(day.weekday + 1) % 7]!;
    expect(nextDay.kind !== 'strength' || !h.sessions[nextDay.session]!.heavy.some((m) => ['quads', 'hamstrings', 'glutes'].includes(m))).toBe(true);

    // Two full-body days in a row: a hint, the plan stays.
    const fb = plan({ weekdays: [0, 1] });
    expect(fb.warnings.some((w) => w.startsWith('Mo und Di:'))).toBe(true);
    expect(fb.sessions).toHaveLength(2);
  });

  it('edits: swapping days and exercises, validated at once', () => {
    const p = plan({ level: 'intermediate', weekdays: DAYS[4]! }); // U Mo, L Di, U Do, L Fr
    const swapped = swapDays(p.week, 1, 3); // Di ↔ Do → U, U on Mo/Di
    expect(swapped[1]).toMatchObject({ weekday: 1, kind: 'strength', session: 2 });
    expect(validatePlan({ sessions: p.sessions, week: swapped, sessionMinutes: 75 }).some((w) => w.startsWith('Mo und Di:'))).toBe(true);
    const first = p.sessions[0]!.template.exercises[0]!;
    const replaced = replaceExercise(p.sessions, 0, 0, 'db-bench-press');
    expect(replaced[0]!.template.exercises[0]).toMatchObject({ exerciseId: 'db-bench-press', sets: first.sets });
    expect(p.sessions[0]!.template.exercises[0]!.exerciseId).toBe(first.exerciseId); // pure
  });
});
