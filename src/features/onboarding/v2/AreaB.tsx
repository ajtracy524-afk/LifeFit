import { useMemo, useState } from 'react';
import { CATEGORIES, FOODS } from '../../../data/foods';
import { allRecipes } from '../../../data/recipes';
import { feasibility, foodGroups, hardExclusionsOf, matchCatalog, usableFood, type FeasibilityChange } from '../../../domain/catalogTags';
import { HOUSEHOLD, MIN_RECIPES_PER_SLOT } from '../../../domain/constants';
import { nutritionProfileFrom } from '../../../domain/onboarding/food';
import type { OnboardingProfile, OnboardingStepId } from '../../../domain/onboarding/types';
import { DEFAULT_SLOTS, SLOT_ORDER } from '../../../domain/planner';
import type { CookingTime, DietType, FoodGroup, Intolerance, LmivAllergen, MealSlot, NutritionProfile } from '../../../domain/types';
import { confirmFoodAnswers, setFoodAnswer } from '../../../store/onboardingActions';
import { useAppState } from '../../../store/store';
import { Button } from '../../../components/ui/Button';
import { Chip, Field, OptionCard, Segmented, Stepper } from '../../../components/ui/Controls';
import { PantryStep } from './AreaBPantry';
import { WeekStep } from './AreaBWeek';
import styles from './onboardingV2.module.css';

/** Steps of section B with their content (Prompt 4). */
export const AREA_B_STEPS: OnboardingStepId[] = ['diet', 'allergies', 'preferences', 'routine', 'week', 'pantry'];

type Food = OnboardingProfile['food'];

/** The nutrition profile as the answers so far define it – also before the core setup exists. */
function profileFromAnswers(food: Food, current: NutritionProfile | null): NutritionProfile {
  return nutritionProfileFrom(food, current ?? { diet: 'omnivore', excluded: [], slots: DEFAULT_SLOTS });
}

export function AreaBStep({ step }: { step: OnboardingStepId }) {
  const state = useAppState();
  const food = state.onboarding?.food ?? {};
  const np = useMemo(() => profileFromAnswers(food, state.nutritionProfile), [food, state.nutritionProfile]);
  switch (step) {
    case 'diet':
      return <DietStep food={food} np={np} />;
    case 'allergies':
      return <AllergiesStep food={food} np={np} />;
    case 'preferences':
      return <PreferencesStep food={food} np={np} />;
    case 'routine':
      return <RoutineStep food={food} np={np} />;
    case 'week':
      return <WeekStep food={food} np={np} />;
    case 'pantry':
      return <PantryStep />;
    default:
      return null;
  }
}

// ---------- Ernährungsform ----------

const DIETS: { id: DietType; emoji: string; title: string; description: string }[] = [
  { id: 'omnivore', emoji: '🍗', title: 'Alles', description: 'Fleisch, Fisch und alles andere.' },
  { id: 'pescatarian', emoji: '🐟', title: 'Pescetarisch', description: 'Fisch und Meeresfrüchte, kein Fleisch.' },
  { id: 'vegetarian', emoji: '🥚', title: 'Vegetarisch', description: 'Kein Fleisch und kein Fisch, Eier und Milch ja.' },
  { id: 'vegan', emoji: '🌱', title: 'Vegan', description: 'Nur pflanzlich – auch kein Honig.' },
];

function DietStep({ food, np }: { food: Food; np: NutritionProfile }) {
  return (
    <div className={styles.stack}>
      <div className={styles.stack} role="group" aria-label="Ernährungsform">
        {DIETS.map((d) => (
          <OptionCard key={d.id} emoji={d.emoji} title={d.title} description={d.description} selected={food.diet?.value === d.id} onClick={() => setFoodAnswer('diet', d.id)} />
        ))}
      </div>
      <FeasibilityHint food={food} np={np} />
    </div>
  );
}

// ---------- Allergien & Unverträglichkeiten ----------

const ALLERGENS: { id: LmivAllergen; label: string }[] = [
  { id: 'gluten', label: 'Glutenhaltiges Getreide' },
  { id: 'crustaceans', label: 'Krebstiere' },
  { id: 'eggs', label: 'Eier' },
  { id: 'fish', label: 'Fisch' },
  { id: 'peanuts', label: 'Erdnüsse' },
  { id: 'soy', label: 'Soja' },
  { id: 'milk', label: 'Milch' },
  { id: 'tree_nuts', label: 'Schalenfrüchte (Nüsse)' },
  { id: 'celery', label: 'Sellerie' },
  { id: 'mustard', label: 'Senf' },
  { id: 'sesame', label: 'Sesam' },
  { id: 'sulphites', label: 'Sulfite' },
  { id: 'lupin', label: 'Lupinen' },
  { id: 'molluscs', label: 'Weichtiere' },
];
const INTOLERANCES: { id: Intolerance; label: string; hint: string }[] = [
  { id: 'lactose', label: 'Laktose', hint: 'Laktosefreie Milchprodukte bleiben erlaubt – die Einkaufsliste nimmt sie automatisch.' },
  { id: 'fructose', label: 'Fruktose', hint: 'Äpfel, Honig und Zuckeralkohole (z. B. in Proteinriegeln) fallen weg.' },
  { id: 'celiac', label: 'Zöliakie', hint: 'Strenger als „glutenarm“: auch Spuren und Verunreinigungen (z. B. Quinoa, Linsen) fallen weg.' },
];

const toggle = <T,>(list: T[], item: T): T[] => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

function AllergiesStep({ food, np }: { food: Food; np: NutritionProfile }) {
  const allergens = food.allergens?.value ?? [];
  const tracesOk = food.tracesOk?.value ?? [];
  const intolerances = food.intolerances?.value ?? [];
  const exclusions = food.exclusions?.value ?? [];
  const custom = food.customExclusions?.value ?? [];
  const [text, setText] = useState('');
  const migrated = food.allergens?.source === 'migrated' || food.intolerances?.source === 'migrated';
  const matched = useMemo(() => custom.map((c) => ({ entry: c, ...matchCatalog([c], FOODS) })), [custom]);

  const add = () => {
    const entry = text.trim();
    if (!entry || custom.some((c) => c.toLowerCase() === entry.toLowerCase())) return setText('');
    setFoodAnswer('customExclusions', [...custom, entry]);
    setText('');
  };

  return (
    <div className={styles.stack}>
      {migrated && (
        <div className={styles.tip} role="note">
          <strong>Aus deinen bisherigen Angaben übernommen.</strong> „Nüsse“ heißt jetzt <strong>Erdnüsse</strong> und <strong>Schalenfrüchte</strong>, „Laktose“ ist eine
          Unverträglichkeit – laktosefreie Produkte bleiben erlaubt. Bitte kurz prüfen.
          <div className={styles.tipAction}>
            <Button size="sm" variant="secondary" onClick={() => confirmFoodAnswers(['allergens', 'intolerances'])}>
              Passt so
            </Button>
          </div>
        </div>
      )}

      <p className={styles.label}>Allergien (die 14 Hauptallergene)</p>
      <div className={styles.chips} role="group" aria-label="Allergien">
        {ALLERGENS.map((a) => (
          <Chip key={a.id} selected={allergens.includes(a.id)} onClick={() => setFoodAnswer('allergens', toggle(allergens, a.id))}>
            {a.label}
          </Chip>
        ))}
      </div>
      {allergens.length > 0 && (
        <div className={styles.stack} role="group" aria-label="Spuren">
          <p className={styles.hint}>Spuren („kann Spuren enthalten“) schließen wir mit aus – außer du sagst, sie sind für dich okay:</p>
          <div className={styles.chips}>
            {allergens.map((id) => (
              <Chip key={id} selected={tracesOk.includes(id)} onClick={() => setFoodAnswer('tracesOk', toggle(tracesOk, id))}>
                Spuren von {ALLERGENS.find((a) => a.id === id)!.label} okay
              </Chip>
            ))}
          </div>
        </div>
      )}

      <p className={styles.label}>Unverträglichkeiten</p>
      <div className={styles.chips} role="group" aria-label="Unverträglichkeiten">
        {INTOLERANCES.map((i) => (
          <Chip key={i.id} selected={intolerances.includes(i.id)} onClick={() => setFoodAnswer('intolerances', toggle(intolerances, i.id))}>
            {i.label}
          </Chip>
        ))}
      </div>
      {INTOLERANCES.filter((i) => intolerances.includes(i.id)).map((i) => (
        <p key={i.id} className={styles.hint}>
          {i.label}: {i.hint}
        </p>
      ))}

      <p className={styles.label}>Weitere Ausschlüsse</p>
      <div className={styles.chips} role="group" aria-label="Weitere Ausschlüsse">
        <Chip selected={exclusions.includes('pork')} onClick={() => setFoodAnswer('exclusions', toggle(exclusions, 'pork' as const))}>
          Schwein
        </Chip>
        <Chip selected={exclusions.includes('alcohol')} onClick={() => setFoodAnswer('exclusions', toggle(exclusions, 'alcohol' as const))}>
          Alkohol in Rezepten
        </Chip>
        {exclusions.includes('alcohol') && (
          <Chip selected={food.fermentationAlcoholOk?.value === true} onClick={() => setFoodAnswer('fermentationAlcoholOk', !food.fermentationAlcoholOk?.value)}>
            Alkohol aus Fermentation (z. B. Sojasauce) okay
          </Chip>
        )}
      </div>

      <form
        className={styles.addRow}
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Field label="Was isst du sonst nicht?" placeholder="z. B. Pilze, Koriander" value={text} onChange={(e) => setText(e.currentTarget.value)} />
        <Button type="submit" variant="secondary" disabled={!text.trim()}>
          Hinzufügen
        </Button>
      </form>
      {matched.length > 0 && (
        <ul className={styles.matches} aria-label="Eigene Ausschlüsse">
          {matched.map((m) => (
            <li key={m.entry}>
              <span>
                <strong>{m.entry}</strong>{' '}
                {m.foods.length ? `– im Katalog: ${m.foods.map((id) => FOODS.find((f) => f.id === id)?.name).join(', ')}` : '– nicht im Katalog; wir prüfen die Namen deiner eigenen Produkte'}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setFoodAnswer('customExclusions', custom.filter((c) => c !== m.entry))}>
                Entfernen
              </Button>
            </li>
          ))}
        </ul>
      )}

      <FeasibilityHint food={food} np={np} />
    </div>
  );
}

// ---------- Vorlieben ----------

const GROUPS: { id: FoodGroup; label: string }[] = [
  { id: 'protein', label: 'Protein' },
  { id: 'carbs', label: 'Kohlenhydrate' },
  { id: 'fat', label: 'Gesunde Fette' },
  { id: 'veg', label: 'Gemüse & Obst' },
];
type Pref = 'like' | 'dislike' | undefined;
const NEXT: Record<string, Pref> = { neutral: 'like', like: 'dislike', dislike: undefined };
const PREF_LABEL = { like: 'mag ich', dislike: 'mag ich nicht', neutral: 'neutral' } as const;

function PreferencesStep({ food, np }: { food: Food; np: NutritionProfile }) {
  const prefs = food.preferences?.value ?? {};
  const ex = hardExclusionsOf(np);
  // Hard exclusions are not shown; a lactose-free swap keeps milk & co. visible. Condiments and variants never.
  const visible = FOODS.filter((f) => !f.tags?.lactoseFree && foodGroups(f).length > 0 && usableFood(f.id, ex) !== undefined);
  const save = (next: Record<string, 'like' | 'dislike'>) => setFoodAnswer('preferences', next);
  const set = (ids: string[], value: Pref) => {
    const next = { ...prefs };
    for (const id of ids) {
      if (value) next[id] = value;
      else delete next[id];
    }
    save(next);
  };

  return (
    <div className={styles.stack}>
      <p className={styles.hint}>Tippen wechselt: neutral → 👍 mag ich → 👎 mag ich nicht. 👎 planen wir nur, wenn sonst nichts passt.</p>
      {GROUPS.map((g) => {
        const inGroup = visible.filter((f) => foodGroups(f)[0] === g.id);
        if (!inGroup.length) return null;
        return (
          <section key={g.id} className={styles.stack} aria-label={g.label}>
            <h2 className={styles.groupTitle}>{g.label}</h2>
            {CATEGORIES.map((c) => {
              const foods = inGroup.filter((f) => f.category === c.id);
              if (!foods.length) return null;
              const ids = foods.map((f) => f.id);
              return (
                <div key={c.id} className={styles.stack}>
                  <div className={styles.subgroup}>
                    <span className={styles.hint}>{c.label}</span>
                    <span className={styles.quick}>
                      <Button size="sm" variant="ghost" onClick={() => set(ids, 'like')} aria-label={`${c.label} (${g.label}): alle mag ich`}>
                        alle 👍
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => set(ids, 'dislike')} aria-label={`${c.label} (${g.label}): alle mag ich nicht`}>
                        alle 👎
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => set(ids, undefined)} aria-label={`${c.label} (${g.label}): alle neutral`}>
                        neutral
                      </Button>
                    </span>
                  </div>
                  <div className={styles.chips}>
                    {foods.map((f) => {
                      const pref = prefs[f.id] ?? 'neutral';
                      return (
                        <button
                          key={f.id}
                          type="button"
                          className={styles.prefChip}
                          data-pref={pref}
                          aria-label={`${f.name}: ${PREF_LABEL[pref]}`}
                          onClick={() => set([f.id], NEXT[pref])}
                        >
                          {pref === 'like' ? '👍 ' : pref === 'dislike' ? '👎 ' : ''}
                          {f.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

// ---------- Dein Essalltag ----------

const MEAL_LABEL: Record<MealSlot, string> = { breakfast: 'Frühstück', snack: 'Snack 1', lunch: 'Mittagessen', snack2: 'Snack 2', dinner: 'Abendessen' };
const COOKING: { value: CookingTime; label: string }[] = [
  { value: '15', label: '≤ 15 min' },
  { value: '30', label: '≤ 30 min' },
  { value: '45', label: '≤ 45 min' },
  { value: 'any', label: 'egal' },
];
const BUDGET: { value: 'low' | 'medium' | 'any'; label: string }[] = [
  { value: 'low', label: 'günstig' },
  { value: 'medium', label: 'mittel' },
  { value: 'any', label: 'egal' },
];

function RoutineStep({ food, np }: { food: Food; np: NutritionProfile }) {
  const meals = food.meals?.value ?? np.slots;
  const cooking = food.cookingTime?.value;
  const [warn, setWarn] = useState(false);
  const toggleMeal = (slot: MealSlot) => {
    const next = meals.includes(slot) ? meals.filter((s) => s !== slot) : [...meals, slot];
    if (next.length < 2) return setWarn(true);
    setWarn(false);
    setFoodAnswer('meals', SLOT_ORDER.filter((s) => next.includes(s)));
  };
  const setCooking = (part: 'weekday' | 'weekend', value: CookingTime) =>
    setFoodAnswer('cookingTime', { weekday: cooking?.weekday ?? 'any', weekend: cooking?.weekend ?? 'any', [part]: value });

  return (
    <div className={styles.stack}>
      <p className={styles.label}>Mahlzeiten pro Tag ({meals.length})</p>
      <div className={styles.chips} role="group" aria-label="Mahlzeiten">
        {SLOT_ORDER.map((slot) => (
          <Chip key={slot} selected={meals.includes(slot)} onClick={() => toggleMeal(slot)}>
            {MEAL_LABEL[slot]}
          </Chip>
        ))}
      </div>
      {warn && <p className={styles.hint}>Mindestens zwei Mahlzeiten – sonst wird das Tagesziel zu groß für eine Portion.</p>}

      <p className={styles.label}>Zeit zum Kochen unter der Woche</p>
      <Segmented label="Kochzeit unter der Woche" options={COOKING} value={cooking?.weekday ?? ('' as CookingTime)} onChange={(v) => setCooking('weekday', v)} />
      <p className={styles.label}>Am Wochenende</p>
      <Segmented label="Kochzeit am Wochenende" options={COOKING} value={cooking?.weekend ?? ('' as CookingTime)} onChange={(v) => setCooking('weekend', v)} />
      <p className={styles.hint}>Die Minuten im Rezept sind die Wahrheit – längere Gerichte planen wir nur, wenn sonst nichts passt.</p>

      <div className={styles.chips}>
        <Chip selected={food.mealPrep?.value === true} onClick={() => setFoodAnswer('mealPrep', !food.mealPrep?.value)}>
          Ich koche gern einmal für 2–3 Tage vor
        </Chip>
      </div>
      {food.mealPrep?.value && <p className={styles.hint}>Der Planer bündelt Gerichte zum Vorkochen – an den Folgetagen nur aufwärmen.</p>}

      <Stepper
        label="Wie viele Personen essen mit (du eingeschlossen)?"
        value={food.householdSize?.value ?? 1}
        min={HOUSEHOLD.min}
        max={HOUSEHOLD.max}
        step={1}
        format={(n) => (n === 1 ? 'nur ich' : `${n} Personen`)}
        onChange={(n) => setFoodAnswer('householdSize', n)}
      />
      <p className={styles.hint}>Nur die Einkaufsmengen ändern sich – deine Nährwerte bleiben deine.</p>

      <p className={styles.label}>Budget</p>
      <Segmented label="Budget" options={BUDGET} value={food.budget?.value ?? ('' as 'low')} onChange={(v) => setFoodAnswer('budget', v)} />

      <FeasibilityHint food={food} np={np} />
    </div>
  );
}

// ---------- Machbarkeit ----------

const SLOT_NAME: Record<MealSlot, string> = { breakfast: 'das Frühstück', snack: 'Snack 1', lunch: 'das Mittagessen', snack2: 'Snack 2', dinner: 'das Abendessen' };

/** Too few recipes after the exclusions → a hint with ONE suggestion, instead of an empty plan later. */
function FeasibilityHint({ food, np }: { food: Food; np: NutritionProfile }) {
  const f = useMemo(() => feasibility(hardExclusionsOf(np), np.slots, allRecipes(), MIN_RECIPES_PER_SLOT), [np]);
  if (f.ok || !f.weakest) return null;
  const n = f.counts[f.weakest] ?? 0;
  const apply = (c: FeasibilityChange) => {
    if (c.kind === 'traces') setFoodAnswer('tracesOk', [...(food.tracesOk?.value ?? []), c.allergen]);
    else if (c.kind === 'fermentation') setFoodAnswer('fermentationAlcoholOk', true);
    else if (c.kind === 'diet') setFoodAnswer('diet', c.diet);
    else {
      // Remove the free-text entries that matched this food.
      const keep = (food.customExclusions?.value ?? []).filter((entry) => !matchCatalog([entry], FOODS).foods.includes(c.foodId));
      setFoodAnswer('customExclusions', keep);
    }
  };
  return (
    <div className={styles.tip} role="status" aria-label="Machbarkeit">
      Für {SLOT_NAME[f.weakest]} {n === 1 ? 'bleibt nur 1 Rezept' : n === 0 ? 'bleibt kein Rezept' : `bleiben nur ${n} Rezepte`} – Gerichte würden sich oft wiederholen.
      {f.suggestion ? (
        <>
          {' '}
          Vorschlag: <strong>{f.suggestion.label}</strong>.
          <div className={styles.tipAction}>
            <Button size="sm" variant="secondary" onClick={() => apply(f.suggestion!.change)}>
              Vorschlag übernehmen
            </Button>
          </div>
        </>
      ) : (
        ' Du kannst trotzdem weitermachen; eigene Gerichte helfen, die Lücke zu füllen.'
      )}
    </div>
  );
}
