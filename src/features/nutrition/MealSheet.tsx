import { useState } from 'react';
import { getFood } from '../../data/foods';
import { getRecipe } from '../../data/recipes';
import { today } from '../../domain/dates';
import { explainMeal } from '../../domain/explain';
import { swapOptions } from '../../domain/planner';
import type { PlannedMeal } from '../../domain/types';
import { fmt, relativeDay, SLOT_LABEL } from '../../lib/format';
import { navigate } from '../../lib/router';
import { showToast } from '../../lib/toast';
import { applyWithUndo, withUndo } from '../../lib/undo';
import { markEaten, removePlannedMeal, skipMeal, swapMeal, unmarkEaten, updateServings } from '../../store/actions';
import { useAppState } from '../../store/store';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Controls';
import { EmptyState } from '../../components/ui/Feedback';
import { Sheet } from '../../components/ui/Sheet';
import { RecipeDetail } from './RecipeDetail';
import styles from './nutrition.module.css';

interface MealSheetProps {
  mealId: string | null;
  onClose: () => void;
  /** Called after "Anders gegessen" so the caller can open food logging. */
  onLogInstead?: (meal: PlannedMeal) => void;
}

/** Details of a planned meal: portion size, eaten, swap, remove. */
export function MealSheet({ mealId, onClose, onLogInstead }: MealSheetProps) {
  const state = useAppState();
  const meal = state.plannedMeals.find((m) => m.id === mealId);
  const [disliking, setDisliking] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const recipe = meal ? getRecipe(meal.recipeId) : undefined;
  const open = !!meal && !!recipe;

  const close = () => {
    setSwapping(false);
    setDisliking(false);
    onClose();
  };

  if (!open) return <Sheet open={false} onClose={close} title="" children={null} />;

  const eaten = meal.status === 'eaten';

  if (swapping) {
    const options = swapOptions(meal, state.nutritionProfile);
    return (
      <Sheet open onClose={close} title="Mahlzeit tauschen" subtitle={`Ähnliche Kalorien wie ${recipe.title}`}>
        {options.length === 0 ? (
          <EmptyState compact emoji="🔍" title="Keine passende Alternative" text="Für diese Mahlzeit gibt es mit deinen Filtern keine ähnlichen Rezepte." />
        ) : (
          <ul className={styles.optionList}>
            {options.map((o) => (
              <li key={o.recipe.id}>
                <button
                  type="button"
                  className={styles.optionRow}
                  onClick={() => {
                    swapMeal(meal.id, o.recipe.id, o.servings);
                    showToast(`Getauscht gegen ${o.recipe.title} – Einkaufsliste aktualisiert`, {
                      action: { label: 'Liste', onClick: () => navigate('shopping') },
                    });
                    close();
                  }}
                >
                  <span className={styles.mealEmoji} aria-hidden>
                    {o.recipe.emoji}
                  </span>
                  <span className={styles.mealText}>
                    <span className={styles.mealTitle}>{o.recipe.title}</span>
                    <span className={styles.mealMeta}>
                      {fmt.kcal(o.macros.kcal)} · {o.recipe.prepMin} min
                    </span>
                  </span>
                  <span className={o.proteinDelta >= 0 ? styles.deltaUp : styles.delta}>
                    {o.proteinDelta >= 0 ? '+' : '−'}
                    {fmt.int(Math.abs(o.proteinDelta))} g P
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <Button variant="ghost" block onClick={() => setSwapping(false)}>
          Zurück
        </Button>
      </Sheet>
    );
  }

  return (
    <Sheet
      open
      onClose={close}
      title={recipe.title}
      subtitle={`${SLOT_LABEL[meal.slot]} · ${relativeDay(meal.date)}`}
      footer={
        <>
          <Button variant="secondary" icon="swap" onClick={() => setSwapping(true)}>
            Tauschen
          </Button>
          {eaten ? (
            <Button variant="secondary" block onClick={() => unmarkEaten(meal.id)}>
              Doch nicht gegessen
            </Button>
          ) : (
            <Button
              block
              icon="check"
              onClick={() => {
                withUndo(`${recipe.title} erfasst`, () => markEaten(meal.id));
                close();
              }}
            >
              Gegessen
            </Button>
          )}
        </>
      }
    >
      {!eaten && <WhyThisMeal reasons={explainMeal(state, meal, today())} />}
      <RecipeDetail recipe={recipe} servings={meal.servings} onServingsChange={(v) => updateServings(meal.id, v)} />
      <div className={styles.sheetLinks}>
        {!eaten && onLogInstead && (
          <Button
            variant="ghost"
            onClick={() => {
              skipMeal(meal.id);
              close();
              onLogInstead(meal);
            }}
          >
            Anders gegessen
          </Button>
        )}
        <Button
          variant="ghost"
          className={styles.dangerLink}
          onClick={() => {
            withUndo('Mahlzeit entfernt – Einkaufsliste aktualisiert', () => removePlannedMeal(meal.id));
            close();
          }}
        >
          Aus Plan entfernen
        </Button>
        {!eaten && !disliking && (
          <Button variant="ghost" onClick={() => setDisliking(true)}>
            Mag ich nicht …
          </Button>
        )}
      </div>
      {disliking && (
        <div className={styles.dislike}>
          <p className={styles.muted}>Welche Zutat soll LifeFit nie mehr einplanen? Betroffene Mahlzeiten werden ersetzt.</p>
          <div className={styles.dislikeChips}>
            {recipe.ingredients
              .map((i) => getFood(i.foodId))
              .filter((f): f is NonNullable<typeof f> => !!f && f.category !== 'pantry')
              .map((f) => (
                <Chip
                  key={f.id}
                  selected={false}
                  onClick={() => {
                    if (applyWithUndo({ type: 'setDislike', foodId: f.id, disliked: true })) close();
                  }}
                >
                  {f.name}
                </Chip>
              ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** "Warum?" – only factors the planner really used (domain/explain.ts). */
function WhyThisMeal({ reasons }: { reasons: string[] }) {
  const [open, setOpen] = useState(false);
  if (reasons.length === 0) return null;
  return (
    <div className={styles.why}>
      <button type="button" className={styles.whyToggle} onClick={() => setOpen(!open)} aria-expanded={open}>
        Warum dieses Gericht?
      </button>
      {open && (
        <ul className={styles.whyList}>
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
