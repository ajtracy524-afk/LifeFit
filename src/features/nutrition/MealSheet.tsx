import { useState } from 'react';
import { getFood } from '../../data/foods';
import { getRecipe } from '../../data/recipes';
import { today } from '../../domain/dates';
import { explainMeal } from '../../domain/explain';
import { fmt, relativeDay, SLOT_LABEL } from '../../lib/format';
import { applyWithUndo, withUndo } from '../../lib/undo';
import { markEaten, removePlannedMeal, unmarkEaten, updateServings } from '../../store/actions';
import { useAppState } from '../../store/store';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Controls';
import { Sheet } from '../../components/ui/Sheet';
import { RecipeDetail } from './RecipeDetail';
import { ReplacePanel } from './ReplacePanel';
import styles from './nutrition.module.css';

interface MealSheetProps {
  mealId: string | null;
  onClose: () => void;
  /** Open straight in "Ersetzen" (e.g. from the next-action card on Heute). */
  startReplacing?: boolean;
}

/**
 * Details of a planned meal: eaten, "Ersetzen" (suggestions, barcode,
 * manual – also what "Anders gegessen" means), portion size, remove.
 */
export function MealSheet({ mealId, onClose, startReplacing = false }: MealSheetProps) {
  const state = useAppState();
  const meal = state.plannedMeals.find((m) => m.id === mealId);
  const [disliking, setDisliking] = useState(false);
  const [replacing, setReplacing] = useState(startReplacing);
  const recipe = meal ? getRecipe(meal.recipeId) : undefined;
  const open = !!meal && !!recipe;

  const close = () => {
    setReplacing(false);
    setDisliking(false);
    onClose();
  };

  if (!open) return <Sheet open={false} onClose={close} title="" children={null} />;

  const eaten = meal.status === 'eaten';
  const skipped = meal.status === 'skipped';
  const replacement = skipped ? state.logEntries.filter((e) => e.replacedMealId === meal.id) : [];

  if (replacing && !skipped) {
    return (
      <Sheet open onClose={close} title={`${recipe.title} ersetzen`} subtitle={`${SLOT_LABEL[meal.slot]} · ${relativeDay(meal.date)}`}>
        <ReplacePanel meal={meal} onDone={close} onBack={() => setReplacing(false)} />
      </Sheet>
    );
  }

  return (
    <Sheet
      open
      onClose={close}
      title={recipe.title}
      subtitle={`${SLOT_LABEL[meal.slot]} · ${relativeDay(meal.date)}${eaten ? ' · gegessen' : skipped ? ' · ersetzt' : ''}`}
      footer={
        skipped ? undefined : (
          <>
            <Button variant="secondary" icon="swap" onClick={() => setReplacing(true)}>
              Ersetzen
            </Button>
            {eaten ? (
              <Button variant="secondary" block onClick={() => withUndo('Markierung entfernt', () => unmarkEaten(meal.id))}>
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
        )
      }
    >
      {skipped && (
        <p className={styles.hubNote}>
          {replacement.length
            ? `Ersetzt durch ${replacement.map((e) => `${e.name} (${fmt.kcal(e.macros.kcal)})`).join(', ')}.`
            : 'Anders gegessen – nicht in deiner Tagesbilanz.'}
        </p>
      )}
      {!eaten && !skipped && <WhyThisMeal reasons={explainMeal(state, meal, today())} />}
      <RecipeDetail recipe={recipe} servings={meal.servings} onServingsChange={(v) => updateServings(meal.id, v)} />
      <div className={styles.sheetLinks}>
        {!eaten && !skipped && (
          <Button variant="ghost" onClick={() => setReplacing(true)}>
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
        {!eaten && !skipped && !disliking && (
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
