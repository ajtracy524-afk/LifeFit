import { describe, expect, it } from 'vitest';
import { numberFreeReport, type NutrientReport } from './nutrientReport';
import { dayPortions, portionKcal, withoutKcal } from './numberFree';

/** E14 / Prompt 9 – the number-free mode in the remaining screens: the helpers. */

describe('withoutKcal', () => {
  it('leaves texts without kcal as they are', () => {
    expect(withoutKcal('Mehr Gemüse zum Abendessen.')).toBe('Mehr Gemüse zum Abendessen.');
  });
  it('drops kcal segments, brackets and side clauses', () => {
    expect(withoutKcal('Pasta → Sandwich · −120 kcal')).toBe('Pasta → Sandwich');
    expect(withoutKcal('Mehr Protein (ca. 300 kcal)')).toBe('Mehr Protein');
    expect(withoutKcal('Mit einem Getränk anfangen: Cola durch Zero ersetzen – im Schnitt kommen 210 kcal pro Tag über Getränke zusammen.')).toBe('Mit einem Getränk anfangen: Cola durch Zero ersetzen.');
  });
  it('keeps the advice when a sentence is about the number', () => {
    expect(withoutKcal('Über Getränke kommen im Schnitt etwa 210 kcal pro Tag zusammen. Wasser oder ungesüßter Tee wären eine einfache Stellschraube.')).toBe('Wasser oder ungesüßter Tee wären eine einfache Stellschraube.');
  });
  it('drops a text that is only the number', () => {
    expect(withoutKcal('1.820 von 2.100 kcal')).toBeUndefined();
    expect(withoutKcal('Tagesziele: Do −150 kcal, Fr +150 kcal')).toBeUndefined();
  });
});

describe('portions', () => {
  it('klein / normal / groß as shares of an average meal; the day in meals', () => {
    expect(portionKcal('normal', 2400, 4)).toBe(600);
    expect(portionKcal('klein', 2400, 4)).toBe(360);
    expect(portionKcal('groß', 2400, 4)).toBe(840);
    expect(dayPortions(1800, 2400, 4).text).toBe('ca. 3 von 4 Mahlzeiten');
  });
});

describe('the nutrient report without numbers', () => {
  it('leaves out the energy row and kcal sentences, keeps the rest', () => {
    const row = (key: string, unit: string, message: string) => ({ key, label: key, unit, amount: 1, message, tone: 'green' }) as unknown as NutrientReport['groups'][number]['rows'][number];
    const report = {
      date: '2026-10-05',
      entries: 3,
      finished: false,
      groups: [{ id: 'macro', label: 'Makros', rows: [row('kcal', 'kcal', 'Noch 400 kcal'), row('protein', 'g', 'Im Zielbereich')] }],
      summary: ['Heute 1.600 kcal gegessen.', 'Protein im Ziel.'],
    } as unknown as NutrientReport;
    const nf = numberFreeReport(report);
    expect(nf.groups[0]!.rows.map((r) => r.key)).toEqual(['protein']);
    expect(nf.summary).toEqual(['Protein im Ziel.']);
  });
});
