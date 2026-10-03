import { pendingConfirmation } from '../../domain/onboarding/summary';
import { setOnboardingAnswer } from '../../store/onboardingActions';
import { useAppState } from '../../store/store';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import styles from './today.module.css';

/**
 * E18: existing users were migrated to "Ich koche gern vor" (they know the
 * leftover logic) – asked once, with a short explanation.
 */
export function MealPrepConfirm() {
  const state = useAppState();
  // After the allergen confirmation – one card at a time.
  if (pendingConfirmation(state) !== 'mealPrep') return null;
  return (
    <Card aria-label="Kurze Frage">
      <p className={styles.recheckText}>
        Gerichte zum Vorkochen kochst du einmal und wärmst sie an den nächsten 1–2 Tagen nur auf. <strong>Möchtest du das beibehalten?</strong>
      </p>
      <div className={styles.recheckActions}>
        <Button size="sm" variant="secondary" onClick={() => setOnboardingAnswer('food', 'mealPrep', true)}>
          Ja, beibehalten
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOnboardingAnswer('food', 'mealPrep', false)}>
          Nein, lieber frisch
        </Button>
      </div>
    </Card>
  );
}
