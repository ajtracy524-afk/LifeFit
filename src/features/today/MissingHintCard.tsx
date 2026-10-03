import { today } from '../../domain/dates';
import { MISSING_HINT, missingHint, restUntil } from '../../domain/onboarding/summary';
import { onboardingV2Enabled } from '../../lib/flags';
import { navigate } from '../../lib/router';
import { dismissMissingHint, openOnboardingStep } from '../../store/onboardingActions';
import { useAppState } from '../../store/store';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import styles from './today.module.css';

/**
 * Prompt 9: at most one quiet card for the most effective missing answer
 * (body fat > everyday activity > typical week > pantry). "Später" → 14 days
 * of rest. For users of the old onboarding this is "Neue Angaben ergänzen" (E8).
 */
export function MissingHintCard() {
  const state = useAppState();
  const hint = onboardingV2Enabled() ? missingHint(state, today()) : undefined;
  if (!hint) return null;
  const { text, section, step } = MISSING_HINT[hint];
  return (
    <Card aria-label="Angabe ergänzen">
      <p className={styles.recheckText}>{text}</p>
      <div className={styles.recheckActions}>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            openOnboardingStep(section, step);
            navigate('onboarding');
          }}
        >
          Ergänzen
        </Button>
        <Button size="sm" variant="ghost" onClick={() => dismissMissingHint(restUntil(today()))}>
          Später
        </Button>
      </div>
    </Card>
  );
}
