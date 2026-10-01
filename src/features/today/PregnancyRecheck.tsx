import { PREGNANCY_RECHECK_DAYS } from '../../domain/constants';
import { today } from '../../domain/dates';
import { pregnancyRecheckDue } from '../../domain/goal';
import { setOnboardingAnswer } from '../../store/onboardingActions';
import { useAppState } from '../../store/store';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import styles from './today.module.css';

/**
 * "Gilt das noch?" (E4): a pregnancy / breastfeeding answer is asked again
 * after about 3 months, so it never sticks forever. One quiet card, two taps.
 */
export function PregnancyRecheck() {
  const answer = useAppState().onboarding?.health.pregnancy;
  if (!pregnancyRecheckDue(answer, today(), PREGNANCY_RECHECK_DAYS)) return null;
  const label = answer!.value === 'pregnant' ? 'Schwangerschaft' : 'Stillzeit';
  return (
    <Card aria-label="Kurze Frage">
      <p className={styles.recheckText}>
        Du hattest „{label}“ angegeben. <strong>Gilt das noch?</strong>
      </p>
      <div className={styles.recheckActions}>
        <Button size="sm" variant="secondary" onClick={() => setOnboardingAnswer('health', 'pregnancy', answer!.value)}>
          Ja, gilt noch
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOnboardingAnswer('health', 'pregnancy', 'no')}>
          Nein, nicht mehr
        </Button>
      </div>
    </Card>
  );
}
