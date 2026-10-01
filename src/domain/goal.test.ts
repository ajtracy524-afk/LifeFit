import { describe, expect, it } from 'vitest';
import { calculateTargets } from './nutrition';
import {
  calorieFloorFor,
  forecast,
  goalCalories,
  macroTargets,
  monthPart,
  recommendGoal,
  referenceWeight,
  type ExperienceBucket,
  type GoalInput,
} from './goal';
import type { GoalType } from './types';

const ALL: GoalType[] = ['fat_loss', 'recomp', 'muscle_gain', 'maintain'];
const options = (r: ReturnType<typeof recommendGoal>) => [r.recommended, ...r.alternatives];

describe('recommendGoal – decision table with body fat', () => {
  // [sex, body fat, beginner-like?, expected recommendation]
  const table: Array<[GoalInput['sex'], number, boolean, GoalType]> = [
    ['male', 28, true, 'fat_loss'],
    ['male', 28, false, 'fat_loss'],
    ['male', 20, true, 'recomp'],
    ['male', 20, false, 'fat_loss'],
    ['male', 12, true, 'muscle_gain'],
    ['male', 12, false, 'muscle_gain'],
    ['female', 35, true, 'fat_loss'],
    ['female', 35, false, 'fat_loss'],
    ['female', 27, true, 'recomp'],
    ['female', 27, false, 'fat_loss'],
    ['female', 20, true, 'muscle_gain'],
    ['female', 20, false, 'muscle_gain'],
    // "keine Angabe": mean thresholds (high 29, low 19)
    ['unspecified', 30, false, 'fat_loss'],
    ['unspecified', 24, true, 'recomp'],
    ['unspecified', 16, false, 'muscle_gain'],
  ];
  for (const [sex, fat, beginner, expected] of table) {
    it(`${sex}, ${fat} %, ${beginner ? 'Einsteiger' : 'erfahren'} → ${expected}`, () => {
      const experience: ExperienceBucket = beginner ? 'lt1' : '3to5';
      const r = recommendGoal({ sex, bodyFat: { percent: fat, method: 'measured' }, experience, weightKg: 75, heightCm: 175 });
      expect(r.recommended).toBe(expected);
      expect(r.confidence).toBe('hoch');
      expect(r.basis).toBe('bodyFat');
      // Every goal is offered unless blocked; the recommendation is not repeated in the alternatives.
      expect(new Set(options(r))).toEqual(new Set(ALL));
      expect(r.alternatives).not.toContain(r.recommended);
      expect(r.reasons.length).toBeGreaterThan(0);
    });
  }

  it('high body fat: Recomposition is the first alternative for beginners, not for trained people', () => {
    expect(recommendGoal({ sex: 'male', bodyFat: { percent: 28, method: 'navy' }, experience: 'never' }).alternatives[0]).toBe('recomp');
    expect(recommendGoal({ sex: 'male', bodyFat: { percent: 28, method: 'navy' }, experience: 'gt5' }).alternatives[0]).toBe('maintain');
  });

  it('a long break counts like a beginner (muscle memory)', () => {
    expect(recommendGoal({ sex: 'male', bodyFat: { percent: 20, method: 'measured' }, experience: '3to5', paused: true }).recommended).toBe('recomp');
  });

  it('RFM or visual estimates give "mittel"', () => {
    expect(recommendGoal({ sex: 'male', bodyFat: { percent: 20, method: 'visual' }, experience: 'lt1' }).confidence).toBe('mittel');
    expect(recommendGoal({ sex: 'male', bodyFat: { percent: 20, method: 'rfm' }, experience: 'lt1' }).confidence).toBe('mittel');
  });
});

describe('recommendGoal – without body fat', () => {
  it('waist known → RFM as substitute, confidence "mittel", with the hint', () => {
    // RFM men: 64 − 20·(180/100) = 28 % → high
    const r = recommendGoal({ sex: 'male', heightCm: 180, waistCm: 100, weightKg: 95, experience: '3to5' });
    expect(r).toMatchObject({ basis: 'rfm', confidence: 'mittel', recommended: 'fat_loss', note: 'Mit einer Körperfettangabe wird die Empfehlung genauer.' });
  });

  it('only BMI + experience → confidence "niedrig" and "Mit Körperfettangabe wird die Empfehlung genauer"', () => {
    const cases: Array<[number, boolean, GoalType]> = [
      [100, true, 'fat_loss'], // BMI 30.9
      [100, false, 'fat_loss'],
      [88, true, 'recomp'], // BMI 27.2
      [88, false, 'maintain'], // trained: BMI says little
      [72, true, 'recomp'], // BMI 22.2
      [72, false, 'muscle_gain'],
      [57, true, 'muscle_gain'], // BMI 17.6
    ];
    for (const [kg, beginner, expected] of cases) {
      const r = recommendGoal({ sex: 'male', weightKg: kg, heightCm: 180, experience: beginner ? 'never' : 'gt5' });
      expect(r.recommended, `${kg} kg`).toBe(expected);
      expect(r).toMatchObject({ basis: 'bmi', confidence: 'niedrig', note: 'Mit Körperfettangabe wird die Empfehlung genauer.' });
    }
  });

  it('nothing known → "Halten" as a start, low confidence', () => {
    expect(recommendGoal({ sex: 'unspecified' })).toMatchObject({ recommended: 'maintain', confidence: 'niedrig', basis: 'none' });
  });
});

describe('recommendGoal – guardrails', () => {
  it('under 18: only "Halten & Gesundheit", everything else blocked with a reason – no question needed', () => {
    const r = recommendGoal({ sex: 'male', age: 17, bodyFat: { percent: 28, method: 'measured' }, experience: 'lt1' });
    expect(r).toMatchObject({ recommended: 'maintain', alternatives: [], locked: true });
    expect(r.blocked.map((b) => b.goal).sort()).toEqual(['fat_loss', 'muscle_gain', 'recomp']);
    expect(r.reasons.join(' ')).toContain('Training macht dich trotzdem fitter');
  });

  it('pregnancy or breastfeeding: locked to "Halten & Gesundheit", the reason points to the midwife or doctor', () => {
    for (const pregnancy of ['pregnant', 'breastfeeding'] as const) {
      const r = recommendGoal({ sex: 'female', pregnancy, bodyFat: { percent: 38, method: 'measured' } });
      expect(r).toMatchObject({ recommended: 'maintain', locked: true });
      expect(r.reasons[0]).toContain('Hebamme');
    }
    expect(recommendGoal({ sex: 'female', pregnancy: 'no', bodyFat: { percent: 38, method: 'measured' } }).locked).toBe(false);
  });

  it('BMI < 18.5 or very low body fat: "Fett verlieren" is not offered, with a friendly explanation', () => {
    const lean = recommendGoal({ sex: 'male', bodyFat: { percent: 7, method: 'measured' }, experience: 'gt5' });
    expect(options(lean)).not.toContain('fat_loss');
    expect(lean.blocked[0]).toMatchObject({ goal: 'fat_loss' });
    expect(lean.blocked[0]!.reason).toMatch(/sehr schlank/);
    expect(options(recommendGoal({ sex: 'female', bodyFat: { percent: 14, method: 'measured' } }))).not.toContain('fat_loss');
    const under = recommendGoal({ sex: 'female', weightKg: 48, heightCm: 168 }); // BMI 17.0
    expect(options(under)).not.toContain('fat_loss');
    expect(under.blocked[0]!.reason).toMatch(/18,5/);
  });

  it('hardly room for a deficit (E2): "Halten" is recommended, "keine Angabe" gets the hint on the sex', () => {
    const r = recommendGoal({ sex: 'unspecified', bodyFat: { percent: 35, method: 'measured' }, tdee: 1600, floor: 1500 });
    expect(r.recommended).toBe('maintain');
    expect(r.alternatives).toContain('fat_loss'); // still the user's choice
    expect(r.note).toBe('Mit der Angabe deines Geschlechts wird die Berechnung genauer.');
  });
});

describe('goalCalories – pace and safety limits', () => {
  // BMR 1700 → floor 1870: the pace decides, not the floor.
  const base = { tdee: 2600, bmr: 1700, sex: 'male' as const, weightKg: 80 };

  it('fat loss: 0.5 / 0.75 / 1 % of body weight per week with ≈ 7700 kcal per kg', () => {
    expect(goalCalories({ ...base, goal: 'fat_loss', pace: 'gentle' }).kcal).toBe(Math.round((2600 - (80 * 0.005 * 7700) / 7) / 10) * 10); // −440
    expect(goalCalories({ ...base, goal: 'fat_loss', pace: 'normal', weightKg: 70 }).kcal).toBe(Math.round((2600 - (70 * 0.0075 * 7700) / 7) / 10) * 10); // −578
    expect(goalCalories({ ...base, goal: 'fat_loss', pace: 'gentle' }).weeklyChangeKg).toBeCloseTo(-0.4, 1);
  });

  it('the deficit is limited to 25 % of the total energy', () => {
    const r = goalCalories({ ...base, goal: 'fat_loss', pace: 'brisk', weightKg: 120, tdee: 2600, bmr: 1500 }); // −1320 wanted, floor 1650
    expect(r.capped).toBe(true);
    expect(r.kcal).toBe(1950);
  });

  it('never below the floor: max(BMR × 1.1; 1200 w / 1500 m and "keine Angabe")', () => {
    expect(calorieFloorFor('female', 1000)).toBe(1200);
    expect(calorieFloorFor('male', 1000)).toBe(1500);
    expect(calorieFloorFor('unspecified', 1000)).toBe(1500);
    expect(calorieFloorFor('male', 1600)).toBeCloseTo(1760, 6);
    const r = goalCalories({ goal: 'fat_loss', pace: 'brisk', tdee: 1800, bmr: 1300, sex: 'female', weightKg: 60 });
    expect(r.floored).toBe(true);
    expect(r.kcal).toBe(1430); // 1300 × 1.1
  });

  it('under 18 / pregnancy: no deficit whatever the goal', () => {
    expect(goalCalories({ ...base, goal: 'fat_loss', noDeficit: true }).kcal).toBe(2600);
    expect(goalCalories({ ...base, goal: 'recomp', pace: 'brisk', noDeficit: true }).kcal).toBe(2600);
  });

  it('muscle gain: beginners faster than trained people; recomposition maintenance to −10 %', () => {
    const beginner = goalCalories({ ...base, goal: 'muscle_gain', experience: 'beginner' });
    const trained = goalCalories({ ...base, goal: 'muscle_gain', experience: 'advanced' });
    expect(beginner.kcal).toBe(Math.round((2600 + (80 * 0.00375 * 7700) / 7) / 10) * 10);
    expect(trained.kcal).toBeLessThan(beginner.kcal);
    expect(goalCalories({ ...base, goal: 'recomp', pace: 'gentle' }).kcal).toBe(2600);
    expect(goalCalories({ ...base, goal: 'recomp', pace: 'brisk' }).kcal).toBe(2340);
    expect(goalCalories({ ...base, goal: 'recomp' }).weeklyChangeKg).toBe(0);
    expect(goalCalories({ ...base, goal: 'maintain' }).kcal).toBe(2600);
  });
});

describe('macroTargets', () => {
  it('protein 1.6–2.2 g/kg (upper end in a deficit), fat ≥ 0.8 g/kg and ≥ 20 %, carbs the rest – the sum matches the calories', () => {
    for (const goal of ['fat_loss', 'recomp', 'muscle_gain', 'maintain'] as const) {
      for (const kcal of [1500, 2200, 3200]) {
        const m = macroTargets({ kcal, weightKg: 80, goal, sex: 'male' });
        expect(m.protein / 80).toBeGreaterThanOrEqual(1.6 - 0.01);
        expect(m.protein / 80).toBeLessThanOrEqual(2.2 + 0.01);
        expect(m.fat).toBeGreaterThanOrEqual(Math.round(80 * 0.8));
        expect(m.fat * 9).toBeGreaterThanOrEqual(kcal * 0.2 - 9);
        if (m.carbs > 0) expect(Math.abs(m.protein * 4 + m.carbs * 4 + m.fat * 9 - kcal)).toBeLessThanOrEqual(6);
      }
    }
    expect(macroTargets({ kcal: 2000, weightKg: 80, goal: 'fat_loss', sex: 'male' }).protein).toBe(176); // 2.2 g/kg
    expect(macroTargets({ kcal: 2000, weightKg: 80, goal: 'maintain', sex: 'male' }).protein).toBe(128); // 1.6 g/kg
  });

  it('high body fat: protein from the target weight, else from the weight at a moderate body fat', () => {
    expect(referenceWeight({ weightKg: 110, sex: 'male', bodyFatPct: 30, targetWeightKg: 90 })).toBe(90);
    // FFM 77 kg / (1 − 0.20) = 96.25 kg
    expect(referenceWeight({ weightKg: 110, sex: 'male', bodyFatPct: 30 })).toBeCloseTo(96.25, 2);
    expect(referenceWeight({ weightKg: 80, sex: 'male', bodyFatPct: 18 })).toBe(80); // not high → current weight
    expect(macroTargets({ kcal: 2400, weightKg: 110, goal: 'fat_loss', sex: 'male', bodyFatPct: 30 }).protein).toBe(212);
  });

  it('calculateTargets uses the same rules (one calculation, E11)', () => {
    const t = calculateTargets({ sex: 'male', age: 30, heightCm: 180, activity: 'sedentary' }, 'fat_loss', 80, 3, { pace: 'gentle' });
    const g = goalCalories({ goal: 'fat_loss', pace: 'gentle', tdee: t.tdee, bmr: t.bmr, sex: 'male', weightKg: 80 });
    expect(Math.abs(t.kcal - g.kcal)).toBeLessThanOrEqual(10); // unrounded tdee inside calculateTargets
    expect(t.protein).toBe(176);
    // Under 18: no deficit, even with "Fett verlieren".
    const minor = calculateTargets({ sex: 'male', age: 16, heightCm: 175, activity: 'light' }, 'fat_loss', 70, 3);
    expect(minor.kcal).toBe(Math.round(minor.tdee / 10) * 10);
    const pregnant = calculateTargets({ sex: 'female', age: 30, heightCm: 168, activity: 'light' }, 'fat_loss', 70, 2, { pregnant: true });
    expect(pregnant.kcal).toBe(Math.round(pregnant.tdee / 10) * 10);
  });
});

describe('forecast – a period, never an exact date', () => {
  it('target weight at the planned pace: from 125 % to 75 % of the speed', () => {
    const f = forecast({ weightKg: 90, weeklyChangeKg: -0.5, targetWeightKg: 84, today: '2026-10-01' })!;
    // 12 weeks planned → 9.6 to 16 weeks
    expect(f.from).toBe('2026-12-07'); // 9.6 weeks = 67 days
    expect(f.to).toBe('2027-01-21');
    expect(f.label).toBe('ca. Anfang Dezember bis Ende Januar 2027');
  });

  it('target body fat: target weight = fat-free mass / (1 − target)', () => {
    const f = forecast({ weightKg: 90, weeklyChangeKg: -0.6, targetBodyFat: 15, bodyFatPct: 25, today: '2026-10-01' })!;
    expect(f.targetWeightKg).toBeCloseTo(79.4, 1); // 67.5 / 0.85
  });

  it('no forecast when the target lies in the other direction, there is no planned change or no target', () => {
    expect(forecast({ weightKg: 90, weeklyChangeKg: -0.5, targetWeightKg: 95, today: '2026-10-01' })).toBeUndefined();
    expect(forecast({ weightKg: 90, weeklyChangeKg: 0, targetWeightKg: 85, today: '2026-10-01' })).toBeUndefined();
    expect(forecast({ weightKg: 90, weeklyChangeKg: -0.5, today: '2026-10-01' })).toBeUndefined();
  });

  it('month parts: Anfang (1–10), Mitte (11–20), Ende (21–31), year only when not this year', () => {
    expect(monthPart('2026-03-05', '2026-01-01')).toBe('Anfang März');
    expect(monthPart('2026-03-15', '2026-01-01')).toBe('Mitte März');
    expect(monthPart('2027-04-28', '2026-01-01')).toBe('Ende April 2027');
  });
});

describe('number-free mode helpers (E14)', () => {
  it('meal size relative to an average meal; the day in halves of meals', async () => {
    const { mealSize, portionText, dayPortions, isNumberFree } = await import('./numberFree');
    expect(mealSize(400, 2400, 4)).toBe('klein'); // average 600
    expect(mealSize(600, 2400, 4)).toBe('normal');
    expect(mealSize(900, 2400, 4)).toBe('groß');
    expect(portionText(600, 2400, 4)).toBe('Portion: normal');
    expect(dayPortions(900, 2400, 4).text).toBe('ca. 1½ von 4 Mahlzeiten');
    expect(dayPortions(0, 2400, 3).text).toBe('ca. 0 von 3 Mahlzeiten');
    expect(dayPortions(300, 2400, 4).text).toBe('ca. ½ von 4 Mahlzeiten');
    expect(isNumberFree({ onboarding: undefined })).toBe(false);
  });
});
