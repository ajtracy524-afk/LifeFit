import { getFood } from '../../data/foods';
import { recipeMacros } from '../../domain/nutrition';
import { describeQuantity } from '../../domain/shopping';
import type { Recipe } from '../../domain/types';
import { fmt } from '../../lib/format';
import { Stepper } from '../../components/ui/Controls';
import styles from './nutrition.module.css';

interface RecipeDetailProps {
  recipe: Recipe;
  servings: number;
  onServingsChange?: (servings: number) => void;
}

/** Recipe content with live-scaled macros and ingredients. */
export function RecipeDetail({ recipe, servings, onServingsChange }: RecipeDetailProps) {
  const macros = recipeMacros(recipe, servings);
  return (
    <div className={styles.recipe}>
      <div className={styles.recipeHero}>
        <span className={styles.recipeEmoji} aria-hidden>
          {recipe.emoji}
        </span>
        <div className={styles.recipeTags}>
          <span className={styles.tag}>{recipe.prepMin} min</span>
          {recipe.tags.map((t) => (
            <span key={t} className={styles.tag}>
              {t}
            </span>
          ))}
        </div>
      </div>

      <div className={styles.macroGrid}>
        <Macro label="kcal" value={fmt.int(macros.kcal)} strong />
        <Macro label="Protein" value={`${fmt.int(macros.protein)} g`} />
        <Macro label="Kohlenh." value={`${fmt.int(macros.carbs)} g`} />
        <Macro label="Fett" value={`${fmt.int(macros.fat)} g`} />
      </div>

      {onServingsChange && (
        <div className={styles.servingsRow}>
          <span>Portionsgröße</span>
          <Stepper value={servings} onChange={onServingsChange} step={0.1} min={0.5} max={3} format={(v) => `${fmt.dec(v)} ×`} label="Portionen" />
        </div>
      )}

      <h3 className={styles.subheading}>Zutaten</h3>
      <ul className={styles.ingredients}>
        {recipe.ingredients.map((ing) => {
          const food = getFood(ing.foodId);
          if (!food) return null;
          const grams = ing.grams * servings;
          const q = describeQuantity(food, grams);
          return (
            <li key={ing.foodId}>
              <span>{food.name}</span>
              <span className={styles.ingredientAmount}>{food.pieceG ? q.quantity : fmt.g(grams)}</span>
            </li>
          );
        })}
      </ul>

      <h3 className={styles.subheading}>Zubereitung</h3>
      <ol className={styles.steps}>
        {recipe.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
    </div>
  );
}

function Macro({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? styles.macroCellStrong : styles.macroCell}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
