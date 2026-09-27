import type { CSSProperties } from 'react';
import { CELEBRATION_MS, dismissCelebration, useCelebration } from '../../lib/celebrate';
import { prefersReducedMotion } from '../../lib/motion';
import styles from './Celebration.module.css';

/** Particle layout: fixed angles and distances (no randomness – calm, repeatable), colors of the app. */
const COLORS = ['var(--accent)', 'var(--water)', 'var(--carbs)', 'var(--fat)'];
const PARTICLES = Array.from({ length: 18 }, (_, i) => ({
  angle: (i * 360) / 18 + (i % 2 ? 9 : 0),
  distance: 46 + (i % 3) * 18,
  color: COLORS[i % COLORS.length]!,
  delay: (i % 4) * 25,
}));

/**
 * The celebration chip (see lib/celebrate.ts): enters with a spring, its icon
 * animates by kind (power burst, water ripple, target sweep, growing sprout,
 * sparkle, dish shine, drawn check), real goals add particles, and it leaves
 * by itself. It never blocks input (pointer-events: none) – except a tap on
 * the chip itself, which dismisses it.
 */
export function CelebrationHost() {
  const c = useCelebration();
  const reduced = prefersReducedMotion();
  const particles = c && !reduced && c.level >= 3 ? PARTICLES.slice(0, c.level === 4 ? 18 : 10) : [];
  return (
    <div className={styles.host} aria-live="polite">
      {c && (
        <div
          key={c.id}
          className={[styles.chip, styles[c.kind], c.level === 4 && styles.big].filter(Boolean).join(' ')}
          style={{ '--life': `${CELEBRATION_MS[c.level]}ms` } as CSSProperties}
          data-kind={c.kind}
          data-level={c.level}
          data-testid="celebration"
          onClick={() => dismissCelebration(c.id)}
        >
          <span className={styles.icon} aria-hidden>
            {c.kind === 'water' && (
              <>
                <span className={styles.ripple} />
                <span className={`${styles.ripple} ${styles.rippleLate}`} />
              </>
            )}
            {c.kind === 'power' && (
              <span className={styles.burst}>
                {Array.from({ length: 8 }, (_, i) => (
                  <span key={i} style={{ '--a': `${i * 45}deg` } as CSSProperties} />
                ))}
              </span>
            )}
            {(c.kind === 'target' || c.kind === 'day') && (
              <svg className={styles.sweep} viewBox="0 0 44 44">
                <circle cx="22" cy="22" r="20" />
              </svg>
            )}
            {c.kind === 'check' ? (
              <svg className={styles.check} viewBox="0 0 24 24">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            ) : (
              <span className={styles.glyph}>{c.icon}</span>
            )}
          </span>
          <span className={styles.text}>
            <strong>{c.title}</strong>
            {c.detail && <span>{c.detail}</span>}
          </span>
          {particles.length > 0 && (
            <span className={styles.particles} aria-hidden>
              {particles.map((p, i) => (
                <span key={i} style={{ '--a': `${p.angle}deg`, '--d': `${p.distance}px`, '--c': p.color, '--delay': `${p.delay}ms` } as CSSProperties} />
              ))}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
