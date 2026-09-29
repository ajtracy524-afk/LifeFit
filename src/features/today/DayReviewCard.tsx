import { useMemo, useState } from 'react';
import { addDays, today } from '../../domain/dates';
import { dayReview } from '../../domain/review/dayReview';
import { markReviewSeen } from '../../store/actions';
import { useAppState } from '../../store/store';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import styles from './today.module.css';

/**
 * "Dein gestriger Tag" – shown on the first visits of a new day until read.
 * Good things first, then what is relevant (patterns, not the single day),
 * at most two points to improve, the simplest step and – on request – why.
 */
export function DayReviewCard() {
  const state = useAppState();
  const yesterday = addDays(today(), -1);
  const review = useMemo(() => (state.coach.reviewSeen?.[yesterday] ? undefined : dayReview(state, yesterday)), [state, yesterday]);
  const [why, setWhy] = useState(false);
  if (!review) return null;
  const nothingToImprove = !review.improve.length;

  return (
    <Card aria-label="Dein gestriger Tag" className={styles.review}>
      <CardHeader title="Dein gestriger Tag" />
      {review.good.length > 0 && (
        <section>
          <h3 className={styles.reviewHeading}>Was lief gut</h3>
          <ul className={styles.reviewList} data-tone="good">
            {review.good.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </section>
      )}
      {review.relevant.length > 0 && (
        <section>
          <h3 className={styles.reviewHeading}>Was auffällt</h3>
          {review.relevant.map((r) => (
            <p key={r} className={styles.reviewText}>
              {r}
            </p>
          ))}
        </section>
      )}
      {review.improve.length > 0 && (
        <section>
          <h3 className={styles.reviewHeading}>Was du verbessern könntest</h3>
          {review.improve.map((r) => (
            <p key={r} className={styles.reviewText}>
              {r}
            </p>
          ))}
        </section>
      )}
      {review.simplest && (
        <section>
          <h3 className={styles.reviewHeading}>Die einfachste Verbesserung</h3>
          <p className={styles.reviewText}>{review.simplest.action}</p>
          {review.simplest.options.length > 0 && (
            <ul className={styles.reviewOptions}>
              {review.simplest.options.map((o) => (
                <li key={o.foodId}>{o.text}</li>
              ))}
            </ul>
          )}
        </section>
      )}
      {review.unusual.length > 0 && (
        <section>
          <h3 className={styles.reviewHeading}>Außergewöhnlich</h3>
          {review.unusual.map((u) => (
            <p key={u} className={styles.reviewText}>
              {u}
            </p>
          ))}
        </section>
      )}
      {nothingToImprove && review.unusual.length === 0 && <p className={styles.reviewText}>Nichts, was dir auffallen müsste – weiter so.</p>}
      <div className={styles.reviewActions}>
        {review.why.length > 0 && (
          <button type="button" className={styles.whyToggle} aria-expanded={why} onClick={() => setWhy(!why)}>
            Warum?
          </button>
        )}
        <Button size="sm" variant="secondary" onClick={() => markReviewSeen(yesterday)}>
          Verstanden
        </Button>
      </div>
      {why && (
        <ul className={styles.reviewWhy}>
          {review.why.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}
