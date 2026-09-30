import { getRecipe } from '../../data/recipes';
import { plannedMealMacros } from '../../domain/nutrition';
import type { PlannedMeal } from '../../domain/types';
import { fmt } from '../../lib/format';
import { withUndo } from '../../lib/undo';
import { markEaten, unmarkEaten } from '../../store/actions';
import { Icon } from '../../components/ui/Icon';
import { runMealEaten } from './logFeedback';
import { SwapText, motionStyles } from '../../components/ui/SwapText';
import { useJustChanged } from '../../lib/motion';
import styles from './nutrition.module.css';

interface MealRowProps {
  meal: PlannedMeal;
  label?: string;
  onOpen: () => void;
  highlight?: boolean;
  /** Hide the check button (e.g. future days in the week plan). */
  checkable?: boolean;
}

export function MealRow({ meal, label, onOpen, highlight, checkable = true }: MealRowProps) {
  const recipe = getRecipe(meal.recipeId);
  const macros = plannedMealMacros(meal);
  const eaten = meal.status === 'eaten';
  const skipped = meal.status === 'skipped';

  // Eaten right now → the check snaps in and the row flashes once (not on arrival).
  const justChanged = useJustChanged(eaten);

  const toggle = () => {
    if (eaten) {
      withUndo('Markierung entfernt', () => unmarkEaten(meal.id));
    } else {
      runMealEaten(meal, `${recipe?.title ?? 'Mahlzeit'} erfasst`, () => markEaten(meal.id));
    }
  };

  return (
    <div className={[styles.mealRow, highlight && styles.mealRowHighlight, (eaten || skipped) && styles.mealRowDone, eaten && justChanged && styles.mealRowJust].filter(Boolean).join(' ')}>
      <button type="button" className={styles.mealMain} onClick={onOpen}>
        <span className={styles.mealEmoji} aria-hidden>
          {recipe?.emoji ?? '🍽️'}
        </span>
        <span className={styles.mealText}>
          {label && <span className={styles.mealLabel}>{label}</span>}
          <SwapText className={styles.mealTitle} text={recipe?.title ?? 'Unbekanntes Rezept'} />
          <span className={styles.mealMeta}>
            {skipped ? (meal.skippedFor === 'eating_out' ? 'Auswärts – nicht im Plan' : 'Anders gegessen') : `${fmt.kcal(macros.kcal)} · ${fmt.int(macros.protein)} g Protein`}
          </span>
        </span>
      </button>
      {checkable && !skipped && (
        <button
          type="button"
          className={[eaten ? styles.checkDone : styles.check, eaten && justChanged && motionStyles.snap].filter(Boolean).join(' ')}
          onClick={toggle}
          aria-pressed={eaten}
          aria-label={eaten ? `${recipe?.title} nicht mehr als gegessen markieren` : `${recipe?.title} als gegessen markieren`}
        >
          <Icon name="check" size={18} strokeWidth={2.4} />
        </button>
      )}
    </div>
  );
}
