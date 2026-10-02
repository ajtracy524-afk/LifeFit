import { describe, expect, it } from 'vitest';
import type { BodyArea, LmivAllergen } from '../domain/types';
import { EXERCISES, JOINT_LOAD, jointLoad } from './exercises';
import { FOODS, getFood, LACTOSE_FREE_VARIANT } from './foods';
import { RECIPES } from './recipes';

/**
 * The reviewed catalog tags (docs/CATALOG_TAGS_REVIEW.md, released with the
 * corrections E15–E23). Old filter results are pinned here: they may only
 * change where a correction was released.
 */

// The catalog before Prompt 3b (vegan / vegetarian and the four old exclusions).
const OLD_VEGAN = [
  'broccoli', 'bell-pepper', 'zucchini', 'tomato', 'cucumber', 'onion', 'potato', 'sweet-potato', 'banana', 'apple', 'avocado', 'lettuce',
  'oats', 'rice', 'pasta', 'couscous', 'quinoa', 'bread', 'wrap', 'rice-cakes', 'tofu', 'kidney', 'chickpeas', 'corn', 'canned-tomato',
  'lentils', 'berries', 'spinach', 'edamame', 'olive-oil', 'peanut-butter', 'almonds', 'soy-sauce', 'toast', 'orange',
];
const OLD_VEGETARIAN_ONLY = ['egg', 'milk', 'skyr', 'quark', 'cottage', 'feta', 'mozzarella', 'whey', 'honey', 'protein-bar', 'gouda', 'greek-yogurt'];
const OLD_MEAT = ['chicken', 'beef-mince', 'salmon', 'tuna'];
const OLD_EXCLUSIONS: Record<string, string[]> = {
  lactose: ['milk', 'skyr', 'quark', 'cottage', 'feta', 'mozzarella', 'whey', 'protein-bar', 'gouda', 'greek-yogurt'],
  gluten: ['oats', 'pasta', 'couscous', 'bread', 'wrap', 'soy-sauce', 'toast'],
  nuts: ['peanut-butter', 'almonds'],
  fish: ['salmon', 'tuna'],
};
// Released corrections: Gouda is practically lactose-free (E20); the protein bar contains gluten and nuts as traces (E15).
const RELEASED: Record<string, { add: string[]; remove: string[] }> = {
  lactose: { add: [], remove: ['gouda'] },
  gluten: { add: ['protein-bar'], remove: [] },
  nuts: { add: ['protein-bar'], remove: [] },
  fish: { add: [], remove: [] },
};
const OLD_IDS = [...OLD_VEGAN, ...OLD_VEGETARIAN_ONLY, ...OLD_MEAT];

describe('catalog foods', () => {
  it('every catalog food carries the reviewed tags', () => {
    for (const f of FOODS) {
      expect(f.tags, f.id).toBeDefined();
      expect(Array.isArray(f.tags!.allergens) && Array.isArray(f.tags!.kinds), f.id).toBe(true);
    }
    expect(FOODS.filter((f) => OLD_IDS.includes(f.id))).toHaveLength(OLD_IDS.length);
  });

  it('vegetarian and vegan filter exactly as before (fish only got its own animal kind)', () => {
    for (const id of OLD_VEGAN) expect(getFood(id), id).toMatchObject({ vegan: true, vegetarian: true });
    for (const id of OLD_VEGETARIAN_ONLY) expect(getFood(id), id).toMatchObject({ vegan: false, vegetarian: true });
    for (const id of OLD_MEAT) expect(getFood(id), id).toMatchObject({ vegan: false, vegetarian: false });
    expect(getFood('salmon')!.tags!.kinds).toEqual(['fish']);
    expect(getFood('chicken')!.tags!.kinds).toEqual(['meat']);
  });

  it('the old exclusions only change where a correction was released', () => {
    for (const [allergen, before] of Object.entries(OLD_EXCLUSIONS)) {
      const expected = [...before.filter((id) => !RELEASED[allergen]!.remove.includes(id)), ...RELEASED[allergen]!.add].sort();
      const now = OLD_IDS.filter((id) => getFood(id)!.allergens.includes(allergen as never)).sort();
      expect(now, allergen).toEqual(expected);
    }
  });

  it('applies the released corrections (E15, E17, E20, E23)', () => {
    const tags = (id: string) => getFood(id)!.tags!;
    expect(tags('peanut-butter').traces).toEqual(['tree_nuts']);
    expect(tags('protein-bar').traces).toEqual(['peanuts', 'tree_nuts']);
    expect(tags('toast').traces).toEqual(['sesame', 'soy']);
    expect(tags('soy-sauce').alcohol).toBe('fermentation');
    expect(tags('gouda').lactose).toBe('low');
    expect(tags('feta').lactose).toBe('yes');
    expect(tags('whey').allergens).toContain('soy');
    expect(tags('protein-bar').fructose).toBe(true);
    expect(tags('oats').allergens).toContain('gluten');
    // Condiments are no preference group (E16), staples are assumed at home (E19).
    for (const id of ['soy-sauce', 'salt', 'pepper']) expect(tags(id).groups, id).toEqual([]);
    for (const id of ['salt', 'pepper']) expect(tags(id)).toMatchObject({ basic: true, staple: true });
  });

  it('lactose-free variants: same nutrients, milk allergen stays, no lactose (E20)', () => {
    for (const [base, id] of Object.entries(LACTOSE_FREE_VARIANT)) {
      const a = getFood(base)!, b = getFood(id)!;
      expect(b.per100).toEqual(a.per100);
      expect(b.micros).toEqual(a.micros);
      expect(b.tags).toMatchObject({ lactoseFree: true, allergens: ['milk'], kinds: ['milk'] });
      expect(b.tags!.lactose).toBeUndefined();
      expect(b.allergens).not.toContain('lactose');
      expect(b.name).toBe(`${a.name} laktosefrei`);
    }
  });
});

describe('catalog recipes', () => {
  const union = (ids: string[], key: 'allergens' | 'traces') => [...new Set(ids.flatMap((id) => getFood(id)!.tags![key] ?? []))].sort();

  it('every ingredient is a catalog food', () => {
    for (const r of RECIPES) for (const i of r.ingredients) expect(getFood(i.foodId)?.tags, `${r.id}: ${i.foodId}`).toBeDefined();
  });

  it('recipe allergens are exactly the union of the ingredients\' allergens', async () => {
    const { recipeTags } = await import('../domain/catalogTags');
    for (const r of RECIPES) {
      const ids = r.ingredients.map((i) => i.foodId);
      const t = recipeTags(r);
      expect([...t.allergens].sort(), r.id).toEqual(union(ids, 'allergens'));
      const allergens = new Set<LmivAllergen>(t.allergens);
      expect([...t.traces].sort(), r.id).toEqual(union(ids, 'traces').filter((a) => !allergens.has(a as LmivAllergen)));
    }
  });

  it('typed meal-prep and portability replace the free tags (E18, E23)', () => {
    for (const r of RECIPES) {
      expect(r.tags, r.id).not.toContain('Meal Prep');
      expect(r.tags, r.id).not.toContain('To go');
      expect(['yes', 'chilled', 'no'], r.id).toContain(r.portable);
      expect(typeof r.mealPrep, r.id).toBe('boolean');
      expect(r.keepDays, r.id).toBeGreaterThanOrEqual(0);
    }
    expect(RECIPES.filter((r) => r.mealPrep)).toHaveLength(14);
    for (const id of ['skyr-bowl', 'quark-berries']) expect(RECIPES.find((r) => r.id === id)!.portable).toBe('chilled');
  });

  it('no hidden ingredients: what title and steps name is in the ingredient list (E23)', () => {
    const NAMED: [RegExp, string][] = [
      [/salz|salzen/i, 'salt'],
      [/pfeffer/i, 'pepper'],
      [/(?<!\p{L})Öl(?!\p{L})/u, 'olive-oil'], // "Öl", not "Olivenöl" in a title
      [/curry/i, 'curry-powder'],
      [/essig/i, 'vinegar'],
      [/sojasauce/i, 'soy-sauce'],
      [/honig/i, 'honey'],
      [/erdnussbutter/i, 'peanut-butter'],
    ];
    for (const r of RECIPES) {
      const text = [r.title, ...r.steps].join(' ');
      const ids = r.ingredients.map((i) => i.foodId);
      for (const [word, foodId] of NAMED) if (word.test(text)) expect(ids, `${r.id}: ${word}`).toContain(foodId);
      // "würzen" always says with what – an unnamed seasoning could hide an allergen (celery, mustard).
      for (const step of r.steps) if (/würzen/i.test(step)) expect(step, r.id).toMatch(/Salz|Pfeffer|Kurkuma|Chili|Curry|Kreuzkümmel|Paprikapulver/);
    }
  });
});

describe('exercises: joint load (E6, E9, E21)', () => {
  const JOINTS: BodyArea[] = ['shoulder', 'knee', 'lower_back', 'wrist', 'elbow', 'hip'];
  const byId = new Map(EXERCISES.map((e) => [e.id, e]));

  it('every exercise is rated (55 exercises)', () => {
    expect(EXERCISES).toHaveLength(55);
    for (const e of EXERCISES) expect(JOINT_LOAD[e.id], e.id).toBeDefined();
  });

  it('every exercise with level 2 at a joint has an alternative with level ≤ 1 there for the same main muscle', () => {
    for (const e of EXERCISES) {
      for (const joint of JOINTS) {
        if (jointLoad(e.id, joint) !== 2) continue;
        const ok = e.alternatives.some((id) => {
          const a = byId.get(id);
          return !!a && a.type !== 'mobility' && a.primary === e.primary && jointLoad(id, joint) <= 1;
        });
        expect(ok, `${e.id} @ ${joint}`).toBe(true);
      }
    }
  });

  it('mobility work is never an alternative for a strength exercise', () => {
    for (const e of EXERCISES.filter((x) => x.type === 'strength')) {
      for (const id of e.alternatives) expect(byId.get(id)?.type, `${e.id} → ${id}`).not.toBe('mobility');
    }
  });

  it('links the released alternatives', () => {
    for (const id of ['overhead-press', 'machine-shoulder-press']) expect(byId.get(id)!.alternatives).toEqual(expect.arrayContaining(['lateral-raise', 'face-pull', 'rear-delt-fly']));
    expect(byId.get('kb-swing')!.alternatives).toContain('glute-bridge');
  });
});
