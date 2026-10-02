import { describe, expect, it } from 'vitest';
import { EXERCISES, getExercise, jointLoad } from '../data/exercises';
import { prescribe } from './adaptive/progression';
import { alternativesFor } from './exerciseLibrary';
import { calculateTargets } from './nutrition';
import {
  cardioSurcharge,
  complaintGaps,
  estimateTrainingLevel,
  gentleAlternative,
  placesToItems,
  recommendCardio,
  severityThreshold,
  startWeight,
  stressedAreas,
  trainingSetupFrom,
  type YearsBucket,
} from './onboarding/training';
import { availableEquipment } from './trainingProfile';
import type { BodyArea, ComplaintSeverity, Experience, Sex, TrainingSetup } from './types';

/** Prompt 7 – area C: level, complaints (E22), equipment, cardio, start weights. */

const LEVELS: Experience[] = ['beginner', 'intermediate', 'advanced'];

describe('estimateTrainingLevel – every combination', () => {
  const YEARS: (YearsBucket | undefined)[] = [undefined, 'never', 'lt1', '1to2', '3to5', 'gt5'];
  // Normalised FFMI below / inside / above the sex-specific band ("keine Angabe" = the mean of both).
  const FFMI: Record<Sex, Record<'low' | 'mid' | 'high', number>> = {
    male: { low: 18, mid: 20, high: 23 },
    female: { low: 15, mid: 17, high: 20 },
    unspecified: { low: 16.5, mid: 19, high: 21.5 },
  };
  const base = (y: YearsBucket | undefined) => (y === '1to2' ? 1 : y === '3to5' || y === 'gt5' ? 2 : 0);

  it('years set the start, the FFMI moves one level, a pause > 6 months one level down – never outside the three levels', () => {
    let n = 0;
    for (const sex of ['male', 'female', 'unspecified'] as Sex[])
      for (const years of YEARS)
        for (const band of [undefined, 'low', 'mid', 'high'] as const)
          for (const pausedLong of [false, true]) {
            let i = base(years);
            if (band === 'high' && i < 2) i++;
            else if (band === 'low' && i > 0) i--;
            if (pausedLong && i > 0) i--;
            const r = estimateTrainingLevel({ sex, ...(years ? { years } : {}), ...(band ? { ffmiNormalized: FFMI[sex][band] } : {}), pausedLong });
            const label = `${sex} ${years} ${band} ${pausedLong}`;
            expect(r.level, label).toBe(LEVELS[i]);
            expect(r.confidence, label).toBe(years && band ? 'hoch' : years ? 'mittel' : 'niedrig');
            expect(r.note, label).toBe(pausedLong ? 'Muskelgedächtnis: Du baust schneller wieder auf als beim ersten Mal.' : undefined);
            expect(r.reasons.length, label).toBeGreaterThan(0);
            n++;
          }
    expect(n).toBe(3 * 6 * 4 * 2);
  });

  it('explains itself', () => {
    const r = estimateTrainingLevel({ sex: 'male', years: '1to2', ffmiNormalized: 23 });
    expect(r).toMatchObject({ level: 'advanced', confidence: 'hoch' });
    expect(r.reasons.join(' ')).toMatch(/FFMI ca\. 23\).*eine Stufe höher/);
  });
});

describe('complaints replace exercises by the joint load levels (E22)', () => {
  const gym: Pick<TrainingSetup, 'equipment'> = { equipment: 'gym' };
  const withSeverity = (areas: BodyArea[], s: ComplaintSeverity) => ({ ...gym, limitations: { areas, excludedExercises: [], severity: Object.fromEntries(areas.map((a) => [a, s])) } });

  it('"leicht" replaces load 2, "deutlich" load ≥ 1; without a level it is "deutlich"', () => {
    expect(severityThreshold('mild')).toBe(2);
    expect(severityThreshold('clear')).toBe(1);
    expect(stressedAreas('db-bench-press', ['shoulder'], withSeverity(['shoulder'], 'mild').limitations)).toEqual([]); // shoulder 1
    expect(stressedAreas('db-bench-press', ['shoulder'], withSeverity(['shoulder'], 'clear').limitations)).toEqual(['shoulder']);
    expect(stressedAreas('db-bench-press', ['shoulder'], { areas: ['shoulder'], excludedExercises: [] } as never)).toEqual(['shoulder']);
    expect(gentleAlternative('bench-press', ['shoulder'], withSeverity(['shoulder'], 'mild'))!.id).toBe('db-bench-press');
    expect(gentleAlternative('squat', ['knee'], withSeverity(['knee'], 'mild'))!.id).toBe('goblet-squat');
    // "deutlich": no quad exercise is knee-neutral → a gap, reported – never removed silently.
    expect(gentleAlternative('squat', ['knee'], withSeverity(['knee'], 'clear'))).toBeUndefined();
    expect(complaintGaps(['knee'], withSeverity(['knee'], 'clear')).map((g) => g.exerciseId)).toContain('squat');
  });

  it('for every pair of joints and both levels: each exercise either gets an alternative below the threshold at BOTH joints, or appears in the gap list', () => {
    const joints: BodyArea[] = ['shoulder', 'knee', 'lower_back', 'wrist', 'elbow', 'hip'];
    let checked = 0;
    for (const s of ['mild', 'clear'] as ComplaintSeverity[]) {
      for (let a = 0; a < joints.length; a++)
        for (let b = a + 1; b < joints.length; b++) {
          const areas = [joints[a]!, joints[b]!];
          const setup = withSeverity(areas, s);
          const gaps = new Set(complaintGaps(areas, setup).map((g) => g.exerciseId));
          for (const e of EXERCISES.filter((x) => x.type === 'strength')) {
            if (!stressedAreas(e.id, areas, setup.limitations).length) continue;
            const alt = gentleAlternative(e.id, areas, setup);
            if (alt) {
              for (const j of areas) expect(jointLoad(alt.id, j), `${e.id} → ${alt.id} @ ${j} (${s})`).toBeLessThan(severityThreshold(s));
              expect(alt.primary).toBe(e.primary);
              expect(alt.type).not.toBe('mobility');
              expect(gaps.has(e.id)).toBe(false);
            } else expect(gaps.has(e.id), `${e.id} (${areas.join('+')}, ${s}) must be reported`).toBe(true);
            checked++;
          }
        }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe('equipment filter', () => {
  it('places stand for pieces of equipment; replacements only with what is there', () => {
    expect(placesToItems(['home_dumbbells', 'bands'])).toEqual(['dumbbells', 'bench', 'bands']);
    expect(placesToItems(['bodyweight'])).toEqual([]);
    expect(availableEquipment({ equipmentItems: placesToItems(['home_dumbbells']) })!.sort()).toEqual(['bodyweight', 'dumbbell']);
    const home = { equipmentItems: placesToItems(['home_dumbbells']) };
    for (const id of ['bench-press', 'squat', 'lat-pulldown', 'leg-press']) {
      for (const alt of alternativesFor(id, home)) expect(['dumbbell', 'bodyweight'], `${id} → ${alt.id}`).toContain(alt.equipment);
    }
    const bodyweightOnly = { equipmentItems: [], limitations: { areas: ['shoulder' as BodyArea], excludedExercises: [], severity: { shoulder: 'mild' as const } } };
    const alt = gentleAlternative('bench-press', ['shoulder'], bodyweightOnly);
    expect(alt?.equipment ?? 'bodyweight').toBe('bodyweight');
  });
});

describe('cardio per goal', () => {
  it('fat loss and recomposition: steps + 2× Zone 2; muscle gain: light cardio; maintain: WHO', () => {
    for (const goal of ['fat_loss', 'recomp'] as const) {
      const r = recommendCardio(goal);
      expect(r.plan.kind).toBe('mix');
      expect(r.label).toBe('Schrittziel + 2× Zone 2');
      expect(r.reasons.join(' ')).toMatch(/Kaloriendefizit.*viszeralen Bauchfett.*150–300 Minuten/);
    }
    const gain = recommendCardio('muscle_gain');
    expect(gain.plan.kind).toBe('steps');
    expect(gain.reasons.join(' ')).toMatch(/nicht direkt vor dem Beintraining/i);
    expect(recommendCardio('maintain').reasons.join(' ')).toMatch(/WHO/);
  });

  it('Zone 2 and HIIT add to the training surcharge, steps do not (they are in the everyday factor)', () => {
    expect(cardioSurcharge(80, { kind: 'steps', types: [] })).toBe(0);
    expect(cardioSurcharge(80, { kind: 'mix', types: [] })).toBeCloseTo(((5 - 1) * 80 * 0.5 * 2) / 7, 6);
    const profile = { sex: 'male' as const, age: 30, heightCm: 180, activity: 'moderate' as const };
    const without = calculateTargets(profile, 'maintain', 80, 3);
    const withCardio = calculateTargets(profile, 'maintain', 80, 3, { cardio: { kind: 'zone2', types: ['cycling'] } });
    expect(withCardio.tdee - without.tdee).toBeGreaterThan(40);
    expect(withCardio.kcal).toBeGreaterThan(without.kcal);
  });
});

describe('start weights', () => {
  const te = { exerciseId: 'bench-press', sets: 3, repMin: 6, repMax: 8, restSec: 120 };

  it('from a working set (Epley, 2 reps in reserve), rounded down to the weight step', () => {
    expect(startWeight({ kg: 100, reps: 5 }, 8, 2.5)).toBe(87.5);
    expect(startWeight({ kg: 0, reps: 5 }, 8, 2.5)).toBeUndefined();
    const rx = prescribe(te, [], '2026-10-05', { 'bench-press': { kg: 100, reps: 5 } });
    expect(rx).toMatchObject({ change: 'first', weightKg: 87.5, reps: 6 });
    expect(rx.reason).toMatch(/Startgewicht aus deinem Arbeitsgewicht \(100 kg × 5\)/);
  });

  it('without a working weight the first session is an entry set', () => {
    const rx = prescribe(te, [], '2026-10-05');
    expect(rx).toMatchObject({ change: 'first', weightKg: null });
    expect(rx.reason).toMatch(/^Einstiegs-Satz: .*daraus leiten wir dein Startgewicht ab\./);
    // A body-weight exercise never gets a start weight.
    expect(prescribe({ ...te, exerciseId: 'push-up' }, [], '2026-10-05', { 'push-up': { kg: 10, reps: 10 } }).weightKg).toBeNull();
    expect(getExercise('push-up')!.bodyweight).toBe(true);
  });
});

describe('answers → training setup', () => {
  it('takes over days, length, equipment, complaints with level, focus (max. 2), weights and cardio', () => {
    const f = <T,>(value: T) => ({ value, source: 'user' as const, updatedAt: '' });
    const s = trainingSetupFrom(
      {
        weekdays: f([4, 0, 2]),
        sessionMinutes: f(45),
        places: f(['home_dumbbells' as const]),
        complaints: f({ areas: ['knee' as BodyArea], severity: { knee: 'mild' as const } }),
        focusMuscles: f(['glutes', 'shoulders', 'back'] as never),
        workingWeights: f({ 'db-bench-press': { kg: 24, reps: 10 } }),
        cardio: f({ kind: 'zone2' as const, types: ['cycling' as const] }),
      },
      { programId: 'full-body', weekdays: [1], limitations: { areas: [], excludedExercises: ['dips'] } },
    );
    expect(s).toMatchObject({
      weekdays: [0, 2, 4],
      sessionMinutes: 45,
      equipmentItems: ['dumbbells', 'bench'],
      limitations: { areas: ['knee'], excludedExercises: ['dips'], severity: { knee: 'mild' } },
      musclePriorities: ['glutes', 'shoulders'],
      workingWeights: { 'db-bench-press': { kg: 24, reps: 10 } },
      cardio: { kind: 'zone2', types: ['cycling'] },
    });
  });
});
