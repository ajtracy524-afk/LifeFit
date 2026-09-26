import { useMemo, type ReactNode } from 'react';
import { getRecipe } from '../../data/recipes';
import { formatCostRange, priceLookup, recipeCostRange } from '../../domain/costs';
import { plannedMealMacros } from '../../domain/nutrition';
import type { NextAction } from '../../domain/today';
import { estimateMinutes } from '../../domain/training';
import type { WorkoutTemplate } from '../../domain/types';
import { fmt, SLOT_LABEL } from '../../lib/format';
import { navigate } from '../../lib/router';
import { withUndo } from '../../lib/undo';
import { markEaten } from '../../store/actions';
import { useAppState } from '../../store/store';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import styles from './today.module.css';

interface Props {
  action: NextAction;
  onPlanWeek: (week: string) => void;
  onStart: (template: WorkoutTemplate) => void;
  onOpenMeal: (mealId: string) => void;
  /** Straight to "Ersetzen" (suggestions, barcode, manual) – one tap instead of two. */
  onReplaceMeal: (mealId: string) => void;
}

/** "Was muss ich heute tun?" – one clear action, derived from the plan (domain/today.ts). */
export function NextActionCard({ action, onPlanWeek, onStart, onOpenMeal, onReplaceMeal }: Props) {
  const state = useAppState();
  const price = useMemo(() => priceLookup(state.products), [state.products]);
  switch (action.kind) {
    case 'resume_workout':
      return (
        <Shell eyebrow="Läuft gerade" title={action.name} text="Mach da weiter, wo du aufgehört hast.">
          <Button icon="play" onClick={() => navigate('session')}>
            Fortsetzen
          </Button>
        </Shell>
      );

    case 'plan_week':
      return (
        <Shell eyebrow="Als Nächstes" title="Noch keine Woche geplant" text="Plane deine Woche in etwa 1 Minute – Essen, Training und Einkauf passen dann zusammen.">
          <Button icon="sparkle" onClick={() => onPlanWeek(action.week)}>
            Woche planen
          </Button>
        </Shell>
      );

    case 'log_meal': {
      const recipe = getRecipe(action.meal.recipeId);
      const macros = plannedMealMacros(action.meal);
      const slot = SLOT_LABEL[action.meal.slot];
      const cost = recipe ? recipeCostRange(recipe, action.meal.servings, price) : undefined;
      return (
        <Shell
          eyebrow={`${action.due ? 'Jetzt' : 'Als Nächstes'} · ${state.plannerSettings.mealTimes[action.meal.slot]}`}
          title={
            // The dish itself opens the details (recipe, portion, "Warum?").
            <button type="button" className={styles.nextTitleButton} onClick={() => onOpenMeal(action.meal.id)} aria-label={`${slot}: ${recipe?.title ?? 'Mahlzeit'} – Details`}>
              {slot}: {recipe?.title ?? 'Mahlzeit'}
            </button>
          }
          text={[fmt.kcal(macros.kcal), `${fmt.int(macros.protein)} g P · ${fmt.int(macros.carbs)} g KH · ${fmt.int(macros.fat)} g F`, cost && formatCostRange(cost)].filter(Boolean).join(' · ')}
        >
          <Button icon="check" onClick={() => withUndo(`${slot} erfasst`, () => markEaten(action.meal.id))}>
            Gegessen
          </Button>
          <Button variant="secondary" icon="swap" onClick={() => onReplaceMeal(action.meal.id)}>
            Ersetzen
          </Button>
        </Shell>
      );
    }

    case 'start_training':
      return (
        <Shell eyebrow="Jetzt" title={action.session.template.name} text={`${action.session.template.exercises.length} Übungen · ~${estimateMinutes(action.session.template)} min`}>
          <Button icon="play" onClick={() => onStart(action.session.template)}>
            Training starten
          </Button>
        </Shell>
      );

    case 'shopping':
      return (
        <Shell eyebrow="Als Nächstes" title={`${action.count} ${action.count === 1 ? 'Artikel fehlt' : 'Artikel fehlen'} für heute oder morgen`} text="Die Liste ist schon um deinen Vorrat bereinigt.">
          <Button icon="cart" onClick={() => navigate('shopping')}>
            Einkauf prüfen
          </Button>
        </Shell>
      );

    case 'done':
      return <Shell eyebrow="Heute" title="Alles erledigt ✓" text="Für heute ist nichts mehr offen." />;
  }
}

function Shell({ eyebrow, title, text, children }: { eyebrow: string; title: ReactNode; text: string; children?: ReactNode }) {
  return (
    <Card tone="accent" className={styles.nextAction} aria-label="Nächste Aktion">
      <p className={styles.eyebrow}>{eyebrow}</p>
      <strong className={styles.nextTitle}>{title}</strong>
      <p className={styles.muted}>{text}</p>
      {children && <div className={styles.nextButtons}>{children}</div>}
    </Card>
  );
}
