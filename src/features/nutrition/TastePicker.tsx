import { RECIPES } from '../../data/recipes';
import { MEAL_STYLES, TASTE_RECIPES, TASTES, type Taste } from '../../data/tastes';
import { recipeAllowed } from '../../domain/nutrition';
import { matchingTastes, recipeStyle } from '../../domain/preferences';
import type { GoalType, MealStyle, NutritionProfile } from '../../domain/types';
import { Chip, OptionCard } from '../../components/ui/Controls';
import styles from './nutrition.module.css';

type Filter = Pick<NutritionProfile, 'diet' | 'excluded'>;

/** Tastes that at least one recipe allowed by diet and allergens can serve – nothing offered that can never be planned. */
function availableTastes(filter: Filter): Taste[] {
  const allowed = new Set(RECIPES.filter((r) => recipeAllowed(r, { ...filter, slots: [] })).map((r) => r.id));
  return TASTES.filter((t) => [...(TASTE_RECIPES.get(t.id) ?? [])].some((id) => allowed.has(id)));
}

interface TasteProps {
  filter: Filter;
  favorites: string[];
  avoided: string[];
  onChange: (next: { favorites: string[]; avoided: string[] }) => void;
}

/** "Gern häufiger" and "eher selten" – one taste can only be in one of the two lists. */
export function TastePicker({ filter, favorites, avoided, onChange }: TasteProps) {
  const tastes = availableTastes(filter);
  const toggle = (list: 'favorites' | 'avoided', id: string) => {
    const mine = list === 'favorites' ? favorites : avoided;
    const other = list === 'favorites' ? avoided : favorites;
    const nextMine = mine.includes(id) ? mine.filter((x) => x !== id) : [...mine, id];
    const nextOther = other.filter((x) => x !== id);
    onChange(list === 'favorites' ? { favorites: nextMine, avoided: nextOther } : { favorites: nextOther, avoided: nextMine });
  };
  const chips = (list: 'favorites' | 'avoided', group?: Taste['group']) => (
    <div className={styles.chipRow}>
      {tastes
        .filter((t) => !group || t.group === group)
        .map((t) => (
          <Chip key={t.id} selected={(list === 'favorites' ? favorites : avoided).includes(t.id)} onClick={() => toggle(list, t.id)}>
            {t.emoji} {t.label}
          </Chip>
        ))}
    </div>
  );
  return (
    <div>
      <p className={styles.fieldLabel}>Frühstück</p>
      {chips('favorites', 'breakfast')}
      <p className={styles.fieldLabel}>Mittag & Abend</p>
      {chips('favorites', 'main')}
      <p className={styles.fieldLabel}>Was möchtest du eher selten oder gar nicht essen?</p>
      {chips('avoided')}
    </div>
  );
}

/** A starting point for the style, from the goal and the daily target – the user decides. */
export function defaultMealStyle(goal: GoalType, kcal: number | undefined): MealStyle {
  if (goal === 'fat_loss') return 'light';
  if (goal === 'muscle_gain' && (kcal ?? 0) >= 2800) return 'hearty';
  return 'balanced';
}

interface StyleProps {
  filter: Filter;
  value: MealStyle;
  suggested: MealStyle;
  /** Examples never show what the user wants to eat rarely. */
  avoided?: string[];
  onChange: (style: MealStyle) => void;
}

/** Kinds of meals with real examples from the catalog – described, never judged. */
export function MealStylePicker({ filter, value, suggested, avoided, onChange }: StyleProps) {
  const allowed = RECIPES.filter((r) => recipeAllowed(r, { ...filter, slots: [] }) && matchingTastes(r.id, avoided).length === 0);
  return (
    <div className={styles.quickForm}>
      {MEAL_STYLES.map((s) => {
        const examples = s.id === 'balanced' ? [] : allowed.filter((r) => recipeStyle(r) === s.id).slice(0, 3);
        return (
          <OptionCard
            key={s.id}
            title={s.id === suggested ? `${s.label} · Vorschlag für dein Ziel` : s.label}
            description={examples.length ? `${s.description} Z. B. ${examples.map((r) => r.title).join(', ')}.` : s.description}
            selected={value === s.id}
            onClick={() => onChange(s.id)}
          />
        );
      })}
    </div>
  );
}
