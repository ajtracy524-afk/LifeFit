import { describe, expect, it } from 'vitest';
import { emptyState } from '../store/persistence';
import {
  ageFromBirthYear,
  bmi,
  bmiClass,
  bmrFor,
  energyEstimate,
  fatFreeMass,
  ffmi,
  ffmiClass,
  formatBodyFat,
  measuredEstimate,
  navyEstimate,
  navyFemale,
  navyMale,
  rfmEstimate,
  rfmFemale,
  rfmMale,
  targetOptionsFor,
  trainingSurcharge,
  visualEstimate,
  visualStages,
  whtr,
  whtrClass,
} from './body';
import { calculateTargets } from './nutrition';

describe('BMI and WHtR', () => {
  it('Mann, 80 kg, 180 cm: BMI ≈ 24.7 (WHO: im Referenzbereich)', () => {
    expect(bmi(80, 180)).toBeCloseTo(24.69, 2);
    expect(bmiClass(bmi(80, 180)!).key).toBe('within');
  });

  it('WHO class limits: 18.5 / 25 / 30 belong to the higher class', () => {
    expect(bmiClass(18.49).key).toBe('below');
    expect(bmiClass(18.5).key).toBe('within');
    expect(bmiClass(25).key).toBe('above');
    expect(bmiClass(30).key).toBe('well_above');
    // Neutral wording – no "zu dick".
    expect(bmiClass(32).label).toBe('Deutlich über dem Referenzbereich');
  });

  it('WHtR = waist / height, guide value < 0.5, clearly above from 0.6', () => {
    expect(whtr(90, 180)).toBe(0.5);
    expect(whtrClass(0.49).key).toBe('below');
    expect(whtrClass(0.5).key).toBe('above');
    expect(whtrClass(0.6).key).toBe('well_above');
  });

  it('missing or impossible inputs give no value (never a made-up one)', () => {
    expect(bmi(undefined, 180)).toBeUndefined();
    expect(bmi(80, 0)).toBeUndefined();
    expect(whtr(undefined, 180)).toBeUndefined();
  });
});

describe('body fat – four methods', () => {
  it('US Navy, men (height 180, waist 85, neck 38 cm): 495 / (1.0324 − 0.19077·log10(47) + 0.15456·log10(180)) − 450 ≈ 16.1 %', () => {
    expect(navyMale({ heightCm: 180, waistCm: 85, neckCm: 38 })).toBeCloseTo(16.1, 1);
  });

  it('US Navy, women (height 165, waist 72, hip 98, neck 33 cm): 495 / (1.29579 − 0.35004·log10(137) + 0.221·log10(165)) − 450 ≈ 26.9 %', () => {
    expect(navyFemale({ heightCm: 165, waistCm: 72, hipCm: 98, neckCm: 33 })).toBeCloseTo(26.9, 1);
  });

  it('Relative Fat Mass (Woolcott & Bergman 2018): men 64 − 20·(height/waist), women 76 − 20·(height/waist)', () => {
    expect(rfmMale({ heightCm: 180, waistCm: 90 })).toBe(24);
    expect(rfmFemale({ heightCm: 165, waistCm: 80 })).toBeCloseTo(34.75, 2);
  });

  it('impossible measurements give no estimate', () => {
    expect(navyMale({ heightCm: 180, waistCm: 38, neckCm: 40 })).toBeUndefined(); // waist ≤ neck
    expect(navyFemale({ heightCm: 165, waistCm: 72, neckCm: 33 })).toBeUndefined(); // hip missing
    expect(rfmMale({ heightCm: 180, waistCm: 0 })).toBeUndefined();
    expect(navyEstimate('unspecified', { heightCm: 170, waistCm: 80, neckCm: 36 })).toBeUndefined(); // needs both formulas → hip
  });

  it('estimates are rounded and come as a range with the method accuracy', () => {
    expect(navyEstimate('male', { heightCm: 180, waistCm: 85, neckCm: 38 })).toEqual({ method: 'navy', percent: 16, range: [13, 20] });
    expect(rfmEstimate('male', { heightCm: 180, waistCm: 90 })).toEqual({ method: 'rfm', percent: 24, range: [20, 28] });
    expect(measuredEstimate(16)).toEqual({ method: 'measured', percent: 16, range: [13, 19] });
    expect(measuredEstimate(undefined)).toBeUndefined();
    expect(formatBodyFat(measuredEstimate(16)!)).toBe('ca. 16 % (13–19 %)');
  });

  it('"keine Angabe": mean of both formulas, the range spans both results', () => {
    const c = { heightCm: 170, waistCm: 80, neckCm: 35, hipCm: 98 };
    const m = navyMale(c)!;
    const f = navyFemale(c)!;
    const e = navyEstimate('unspecified', c)!;
    expect(e.percent).toBe(Math.round((m + f) / 2));
    expect(e.range[0]).toBeLessThanOrEqual(Math.round(Math.min(m, f)));
    expect(e.range[1]).toBeGreaterThanOrEqual(Math.round(Math.max(m, f)));
    const r = rfmEstimate('unspecified', { heightCm: 170, waistCm: 85 })!;
    expect(r.percent).toBe(Math.round((rfmMale({ heightCm: 170, waistCm: 85 })! + rfmFemale({ heightCm: 170, waistCm: 85 })!) / 2));
  });

  it('visual comparison: sex-specific bands, ±5 around the middle', () => {
    expect(visualStages('male')[0]).toMatchObject({ from: 8, to: 10 });
    expect(visualStages('female')[0]).toMatchObject({ from: 15, to: 19 });
    expect(visualEstimate({ from: 15, to: 19 })).toEqual({ method: 'visual', percent: 17, range: [12, 22] });
  });

  it('extreme values stay within physiological limits', () => {
    expect(measuredEstimate(1)!.range[0]).toBeGreaterThanOrEqual(2);
    expect(rfmEstimate('female', { heightCm: 150, waistCm: 200 })!.range[1]).toBeLessThanOrEqual(70);
  });
});

describe('fat-free mass and FFMI', () => {
  it('FFM = weight · (1 − body fat); FFMI normalised to 1.80 m', () => {
    expect(fatFreeMass(80, 15)).toBe(68);
    expect(ffmi(80, 180, 15).raw).toBeCloseTo(20.99, 2);
    expect(ffmi(80, 180, 15).normalized).toBeCloseTo(20.99, 2); // 1.80 m – no correction
    expect(ffmi(80, 170, 15).normalized).toBeCloseTo(68 / 2.89 + 0.61, 2);
  });

  it('bands are sex-specific (from domain/constants)', () => {
    expect(ffmiClass(21, 'male')).toBe('Über dem Durchschnitt');
    expect(ffmiClass(20, 'female')).toBe('Deutlich über dem Durchschnitt');
    expect(ffmiClass(21, 'female')).toBe('Sehr hoch – selten ohne langjähriges Training'); // band limits belong to the higher band
    expect(ffmiClass(26, 'male')).toBe('Sehr hoch – selten ohne langjähriges Training');
    expect(ffmiClass(17, 'male')).toBe('Unter dem Durchschnitt');
  });
});

describe('energy', () => {
  const man = { sex: 'male' as const, age: 30, heightCm: 180, weightKg: 80 };

  it('Mann, 80 kg, 180 cm, 30 Jahre: Mifflin = 1780 kcal; "keine Angabe" −78', () => {
    expect(bmrFor(man)).toEqual({ kcal: 1780, formula: 'mifflin' });
    expect(bmrFor({ ...man, sex: 'female' }).kcal).toBe(1614);
    expect(bmrFor({ ...man, sex: 'unspecified' }).kcal).toBe(1697);
  });

  it('Katch-McArdle with measured or Navy body fat, the mean with RFM or visual', () => {
    const katch = 370 + 21.6 * 64; // 20 % of 80 kg → FFM 64 kg
    expect(bmrFor({ ...man, bodyFat: { method: 'measured', percent: 20 } })).toEqual({ kcal: katch, formula: 'katch' });
    expect(bmrFor({ ...man, bodyFat: { method: 'navy', percent: 20 } }).formula).toBe('katch');
    expect(bmrFor({ ...man, bodyFat: { method: 'rfm', percent: 20 } })).toEqual({ kcal: (1780 + katch) / 2, formula: 'mean' });
    expect(bmrFor({ ...man, bodyFat: { method: 'visual', percent: 20 } }).formula).toBe('mean');
  });

  it('training surcharge: (3.5 − 1) MET · kg · h per session, as a daily average', () => {
    expect(trainingSurcharge(80, 3, 60)).toBeCloseTo((2.5 * 80 * 3) / 7, 6);
    expect(trainingSurcharge(80, 0)).toBe(0);
    expect(trainingSurcharge(80, 3, 30)).toBeCloseTo(trainingSurcharge(80, 3, 60) / 2, 6);
  });

  it('total = BMR · everyday factor + training, the parts add up (training counted once)', () => {
    const e = energyEstimate({ ...man, activity: 'sedentary', sessionsPerWeek: 3 });
    expect(e.activityFactor).toBe(1.2);
    expect(e.bmr + e.everyday + e.training).toBeCloseTo(e.tdee, 6);
    expect(e.tdee).toBeCloseTo(1780 * 1.2 + (2.5 * 80 * 3) / 7, 6);
    for (const [activity, factor] of [['light', 1.375], ['moderate', 1.5], ['active', 1.65]] as const) {
      expect(energyEstimate({ ...man, activity, sessionsPerWeek: 0 }).tdee).toBeCloseTo(1780 * factor, 6);
    }
  });

  it('"keine Angabe" is shown as the range between the male and the female result', () => {
    const e = energyEstimate({ ...man, sex: 'unspecified', activity: 'sedentary', sessionsPerWeek: 0 });
    expect(e.bmrRange).toEqual([1610, 1780]);
    expect(e.tdeeRange).toEqual([1940, 2140]);
    expect(energyEstimate({ ...man, activity: 'sedentary', sessionsPerWeek: 0 }).bmrRange).toEqual([1780, 1780]);
  });

  it('calculateTargets uses the same energy (one calculation, E10) and reads body fat and session length', () => {
    const t = calculateTargets({ ...man, activity: 'sedentary' }, 'maintain', 80, 3);
    expect(t.tdee).toBe(Math.round(energyEstimate({ ...man, activity: 'sedentary', sessionsPerWeek: 3 }).tdee));
    const withFat = calculateTargets({ ...man, activity: 'sedentary' }, 'maintain', 80, 3, { bodyFat: { method: 'measured', percent: 20 }, sessionMinutes: 45 });
    expect(withFat.bmr).toBe(Math.round(370 + 21.6 * 64));
    expect(withFat.tdee).toBe(Math.round((370 + 21.6 * 64) * 1.2 + (2.5 * 80 * 0.75 * 3) / 7));
  });

  it('target options come from what is stored (latest body fat, session length)', () => {
    const s = {
      ...emptyState(),
      measurements: [
        { id: 'a', date: '2026-08-01', kind: 'body_fat' as const, value: 25, method: 'estimate' as const },
        { id: 'b', date: '2026-09-01', kind: 'body_fat' as const, value: 22, method: 'measured' as const },
      ],
      training: { programId: 'full-body', weekdays: [0, 2], sessionMinutes: 45 },
    };
    expect(targetOptionsFor(s)).toEqual({ bodyFat: { method: 'measured', percent: 22 }, sessionMinutes: 45 });
    expect(targetOptionsFor(emptyState())).toEqual({});
  });

  it('age from the birth year', () => {
    expect(ageFromBirthYear(1996, '2026-10-01')).toBe(30);
  });
});

describe('existing target versions are snapshots (E10)', () => {
  it('old target versions are byte-identical after migration and a new calculation', async () => {
    const store = await import('../store/store');
    const actions = await import('../store/actions');
    const { migrateOnboarding } = await import('./onboarding/migrate');
    const old = { id: 'old', validFrom: '2026-08-01', method: 'formula' as const, kcal: 2450, protein: 160, carbs: 280, fat: 70 };
    const before = {
      ...emptyState(),
      profile: { name: 'A', sex: 'male' as const, age: 30, heightCm: 180, activity: 'sedentary' as const, experience: 'beginner' as const, createdAt: '2026-08-01T08:00:00Z' },
      goal: { type: 'maintain' as const, startWeightKg: 80, startedAt: '2026-08-01' },
      nutritionProfile: { diet: 'omnivore' as const, excluded: [], slots: ['lunch' as const] },
      training: { programId: 'full-body', weekdays: [0, 2, 4] },
      targets: [old],
    };
    const snapshot = JSON.stringify(old);
    store.commit(migrateOnboarding(before));
    expect(JSON.stringify(store.getState().targets[0])).toBe(snapshot);
    actions.recalculateTargets();
    const after = store.getState().targets;
    expect(after).toHaveLength(2); // a new version for today …
    expect(JSON.stringify(after.find((t) => t.id === 'old'))).toBe(snapshot); // … the old one untouched
    store.commit(emptyState());
  });
});
