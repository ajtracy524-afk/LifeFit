import { ALLERGEN_LABEL } from '../../domain/catalogTags';
import { pendingConfirmation } from '../../domain/onboarding/summary';
import { navigate } from '../../lib/router';
import { confirmFoodAnswers, openOnboardingStep } from '../../store/onboardingActions';
import { useAppState } from '../../store/store';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import styles from './today.module.css';

/**
 * E5: an old exclusion read more strictly ("Nüsse" → Erdnüsse + Schalenfrüchte)
 * is stored as 'migrated' and offered once for confirmation – the stricter
 * reading stays until the user changes it.
 */
export function AllergenConfirm() {
  const state = useAppState();
  if (pendingConfirmation(state) !== 'allergens') return null;
  const names = (state.onboarding?.food.allergens?.value ?? []).map((a) => ALLERGEN_LABEL[a]);
  return (
    <Card aria-label="Ausschlüsse bestätigen">
      <p className={styles.recheckText}>
        Aus deinen bisherigen Angaben schließen wir jetzt aus: <strong>{names.join(', ')}</strong>. Aus „Nüsse“ wurden Erdnüsse und Schalenfrüchte – sicher ist sicher. <strong>Stimmt das so?</strong>
      </p>
      <div className={styles.recheckActions}>
        <Button size="sm" variant="secondary" onClick={() => confirmFoodAnswers(['allergens', 'intolerances'])}>
          Ja, passt
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            openOnboardingStep('B', 'allergies');
            navigate('onboarding');
          }}
        >
          Anpassen
        </Button>
      </div>
    </Card>
  );
}
