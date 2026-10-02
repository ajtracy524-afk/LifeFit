import { useMemo, useState } from 'react';
import { allRecipes } from '../../data/recipes';
import { today } from '../../domain/dates';
import { recipeLabels } from '../../domain/catalogTags';
import { recipeAllowed, recipeMacros } from '../../domain/nutrition';
import { dayTargetFor } from '../../domain/week';
import { recipeSlot, servingsForSlot } from '../../domain/planner';
import type { ISODate, MealSlot, Recipe } from '../../domain/types';
import { fmt, relativeDay, SLOT_LABEL } from '../../lib/format';
import { navigate } from '../../lib/router';
import { showToast } from '../../lib/toast';
import { addPlannedMeal } from '../../store/actions';
import { useAppState } from '../../store/store';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/Icon';
import { Sheet } from '../../components/ui/Sheet';
import { RecipeDetail } from './RecipeDetail';
import styles from './nutrition.module.css';

export interface PickerTarget {
  date: ISODate;
  slot: MealSlot;
}

interface RecipePickerProps {
  target: PickerTarget | null;
  onClose: () => void;
}

/** Choose a recipe for a day and slot. Adding it puts its ingredients on the shopping list. */
export function RecipePicker({ target, onClose }: RecipePickerProps) {
  const state = useAppState();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<{ recipe: Recipe; servings: number } | null>(null);

  const close = () => {
    setQuery('');
    setSelected(null);
    onClose();
  };

  const dayTarget = target ? dayTargetFor(state, target.date) : undefined;
  const slots = state.nutritionProfile?.slots ?? ['breakfast', 'lunch', 'dinner'];

  const list = useMemo(() => {
    if (!target) return [];
    const q = query.trim().toLowerCase();
    return allRecipes().filter((r) => recipeAllowed(r, state.nutritionProfile))
      .filter((r) => !q || r.title.toLowerCase().includes(q) || recipeLabels(r).some((t) => t.toLowerCase().includes(q)))
      .sort((a, b) => Number(b.slots.includes(recipeSlot(target.slot))) - Number(a.slots.includes(recipeSlot(target.slot))));
  }, [target, query, state.nutritionProfile]);

  if (!target) return <Sheet open={false} onClose={close} title="" children={null} />;

  const defaultServings = (r: Recipe) => (dayTarget ? servingsForSlot(r, target.slot, dayTarget, slots) : 1);
  const isPast = target.date < today();

  if (selected) {
    return (
      <Sheet
        open
        onClose={close}
        title={selected.recipe.title}
        subtitle={`${SLOT_LABEL[target.slot]} · ${relativeDay(target.date)}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setSelected(null)}>
              Zurück
            </Button>
            <Button
              block
              icon={isPast ? 'check' : 'plus'}
              onClick={() => {
                addPlannedMeal(target.date, target.slot, selected.recipe.id, selected.servings);
                if (isPast) {
                  showToast(`${selected.recipe.title} als gegessen erfasst`);
                } else {
                  showToast(`${selected.recipe.ingredients.length} Zutaten zur Einkaufsliste hinzugefügt`, {
                    action: { label: 'Ansehen', onClick: () => navigate('shopping') },
                  });
                }
                close();
              }}
            >
              {isPast ? 'Als gegessen erfassen' : 'Einplanen'}
            </Button>
          </>
        }
      >
        <RecipeDetail recipe={selected.recipe} servings={selected.servings} onServingsChange={(servings) => setSelected({ ...selected, servings })} />
      </Sheet>
    );
  }

  return (
    <Sheet open onClose={close} title="Rezept wählen" subtitle={`${SLOT_LABEL[target.slot]} · ${relativeDay(target.date)}`}>
      <label className={styles.search}>
        <Icon name="search" size={18} />
        <span className="visually-hidden">Rezepte durchsuchen</span>
        <input type="search" placeholder="Rezept oder Stichwort suchen" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>

      {list.length === 0 ? (
        <EmptyState compact emoji="🔍" title={`Nichts gefunden für „${query}“`} text="Versuch einen anderen Begriff, z. B. „Hähnchen“ oder „Vegan“." />
      ) : (
        <ul className={styles.optionList}>
          {list.map((r) => {
            const servings = defaultServings(r);
            const m = recipeMacros(r, servings);
            const fits = r.slots.includes(recipeSlot(target.slot));
            return (
              <li key={r.id}>
                <button type="button" className={styles.optionRow} onClick={() => setSelected({ recipe: r, servings })}>
                  <span className={styles.mealEmoji} aria-hidden>
                    {r.emoji}
                  </span>
                  <span className={styles.mealText}>
                    <span className={styles.mealTitle}>{r.title}</span>
                    <span className={styles.mealMeta}>
                      {fmt.kcal(m.kcal)} · {fmt.int(m.protein)} g Protein · {r.prepMin} min
                      {!fits && ' · eher für andere Mahlzeit'}
                    </span>
                  </span>
                  <Icon name="chevronRight" size={18} className={styles.muted} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
