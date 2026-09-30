import { useMemo, useState } from 'react';
import { getExercise } from '../../data/exercises';
import { addDays, today, weekStart, weekdayIndex } from '../../domain/dates';
import { formatLitres, waterWeek } from '../../domain/water';
import { goalProgress, latestWeight, weekStats, weightsInRange } from '../../domain/progress';
import { formatSet } from '../../domain/training';
import type { GoalType } from '../../domain/types';
import { fmt, relativeDay, weekdayShort } from '../../lib/format';
import { href } from '../../lib/router';
import { withUndo } from '../../lib/undo';
import { removeWeight } from '../../store/actions';
import { useAppState } from '../../store/store';
import { Screen, Section } from '../../components/Screen';
import { Button, IconButton } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Segmented } from '../../components/ui/Controls';
import { EmptyState } from '../../components/ui/Feedback';
import { ProgressBar } from '../../components/ui/Progress';
import { WeightChart } from './WeightChart';
import { WeightSheet } from './WeightSheet';
import styles from './progress.module.css';

const GOAL_LABEL: Record<GoalType, string> = {
  muscle_gain: 'Muskelaufbau',
  fat_loss: 'Fett verlieren',
  maintain: 'Fit bleiben',
  recomp: 'Recomposition',
};

type Range = '28' | '90' | 'all';

export function ProgressScreen() {
  const state = useAppState();
  const [range, setRange] = useState<Range>('28');
  const [weightOpen, setWeightOpen] = useState(false);
  const t = today();
  const start = weekStart(t);

  const points = useMemo(() => weightsInRange(state.weights, range === 'all' ? 'all' : Number(range)), [state.weights, range]);
  const thisWeek = useMemo(() => weekStats(state, start), [state, start]);
  const lastWeek = useMemo(() => weekStats(state, addDays(start, -7)), [state, start]);
  const records = useMemo(
    () =>
      state.workouts
        .filter((w) => w.status === 'completed' && w.records?.length)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .flatMap((w) => w.records!.map((r) => ({ ...r, date: w.date, workoutId: w.id })))
        .slice(0, 5),
    [state.workouts],
  );

  if (!state.goal) return null;
  const goal = goalProgress(state.goal, state.weights);
  const latest = latestWeight(state.weights);
  const recentWeights = [...state.weights].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);

  return (
    <Screen
      title="Fortschritt"
      actions={
        <a href={href('profile')} className={styles.avatar} aria-label="Profil & Einstellungen">
          {state.profile?.name?.[0]?.toUpperCase() ?? '?'}
        </a>
      }
    >
      <Card>
        <p className={styles.eyebrow}>{GOAL_LABEL[state.goal.type]}</p>
        {goal.target !== undefined && goal.target !== goal.start ? (
          <>
            <div className={styles.goalRow}>
              <span className={styles.goalNumber}>{fmt.kg(goal.current)}</span>
              <span className={styles.muted}>Ziel {fmt.kg(goal.target)}</span>
            </div>
            <ProgressBar value={goal.percent} max={100} height={10} label="Fortschritt zum Zielgewicht" />
            <p className={styles.goalText}>
              {goal.percent >= 100
                ? 'Ziel erreicht – stark! Leg im Profil ein neues Ziel fest.'
                : `${goal.percent} % geschafft · noch ${fmt.kg(Math.abs(goal.remaining ?? 0))}` +
                  (goal.etaWeeks ? ` · bei diesem Tempo in ca. ${goal.etaWeeks} ${goal.etaWeeks === 1 ? 'Woche' : 'Wochen'}` : '')}
            </p>
          </>
        ) : (
          <>
            <div className={styles.goalRow}>
              <span className={styles.goalNumber}>{fmt.kg(goal.current)}</span>
              <span className={styles.muted}>Start {fmt.kg(goal.start)}</span>
            </div>
            <p className={styles.goalText}>
              {Math.abs(goal.current - goal.start) < 1 ? 'Du hältst dein Gewicht stabil.' : `${goal.current > goal.start ? '+' : '−'}${fmt.kg(Math.abs(goal.current - goal.start))} seit Start`}
            </p>
          </>
        )}
      </Card>

      <Card>
        <CardHeader title="Gewicht" meta={latest ? `zuletzt ${relativeDay(latest.date)}` : undefined} action={<Button size="sm" variant="secondary" icon="plus" onClick={() => setWeightOpen(true)}>Eintragen</Button>} />
        {state.weights.length < 2 ? (
          <EmptyState compact icon="scale" title="Ab 2 Einträgen zeigen wir deinen Trend" text="Tipp: Wiege dich morgens nach dem Aufstehen – so sind die Werte vergleichbar." />
        ) : (
          <>
            <Segmented
              label="Zeitraum"
              value={range}
              onChange={setRange}
              options={[
                { value: '28', label: '4 Wochen' },
                { value: '90', label: '3 Monate' },
                { value: 'all', label: 'Alles' },
              ]}
            />
            {points.length > 0 ? (
              <WeightChart points={points} target={state.goal.targetWeightKg} />
            ) : (
              <p className={styles.chartEmpty}>Keine Einträge in diesem Zeitraum.</p>
            )}
            <p className={styles.legend}>
              <span className={styles.legendDot} /> Tageswerte <span className={styles.legendLine} /> 7-Tage-Schnitt
            </p>
          </>
        )}
        {recentWeights.length > 0 && (
          <ul className={styles.weightList}>
            {recentWeights.map((w) => (
              <li key={w.id}>
                <span>{relativeDay(w.date)}</span>
                <strong>{fmt.kg(w.kg)}</strong>
                <IconButton icon="trash" label={`Eintrag vom ${relativeDay(w.date)} löschen`} onClick={() => withUndo('Eintrag gelöscht', () => removeWeight(w.id))} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Section title="Diese Woche">
        <div className={styles.statGrid}>
          <StatCard
            label="Ø Kalorien"
            value={thisWeek.loggedDays ? fmt.int(thisWeek.avgKcal) : '–'}
            sub={thisWeek.loggedDays ? `Ziel ${fmt.int(thisWeek.targetKcal)}` : 'Noch nichts erfasst'}
            ratio={thisWeek.targetKcal ? thisWeek.avgKcal / thisWeek.targetKcal : undefined}
          />
          <StatCard
            label="Ø Protein"
            value={thisWeek.loggedDays ? `${fmt.int(thisWeek.avgProtein)} g` : '–'}
            sub={`Ziel ${fmt.int(thisWeek.targetProtein)} g`}
            ratio={thisWeek.targetProtein ? thisWeek.avgProtein / thisWeek.targetProtein : undefined}
          />
          <StatCard label="Plan-Treue" value={thisWeek.adherence !== undefined ? `${thisWeek.adherence} %` : '–'} sub="Mahlzeiten wie geplant" />
          <StatCard
            label="Training"
            value={`${thisWeek.workoutsDone} / ${thisWeek.workoutsPlanned}`}
            sub={thisWeek.volumeKg ? `${fmt.int(thisWeek.volumeKg)} kg Volumen` : 'Einheiten'}
            ratio={thisWeek.workoutsPlanned ? thisWeek.workoutsDone / thisWeek.workoutsPlanned : undefined}
          />
        </div>
        <WaterWeek start={start} today={t} />
        {lastWeek.workoutsDone > 0 && thisWeek.volumeKg > 0 && (
          <p className={styles.compare}>
            {/* The running week is compared with a finished one – only an already reached value is a statement. */}
            {thisWeek.volumeKg >= lastWeek.volumeKg ? `Trainingsvolumen schon über der Vorwoche (${fmt.int(lastWeek.volumeKg)} kg)` : `Vorwoche: ${fmt.int(lastWeek.volumeKg)} kg Volumen`}
          </p>
        )}
      </Section>

      <Section title="Neue Rekorde">
        <Card padded={records.length === 0}>
          {records.length === 0 ? (
            <EmptyState compact emoji="🏆" title="Noch keine Rekorde" text="Sobald du ein Gewicht oder eine Wiederholungszahl übertriffst, erscheint es hier." />
          ) : (
            records.map((r, i) => (
              <a key={`${r.workoutId}-${r.exerciseId}-${i}`} href={href('workout', { id: r.workoutId })} className={styles.recordRow}>
                <span>🏆</span>
                <span className={styles.recordText}>
                  <strong>{getExercise(r.exerciseId)?.name}</strong>
                  <span className={styles.muted}>{relativeDay(r.date)}</span>
                </span>
                <strong>{formatSet(r)}</strong>
              </a>
            ))
          )}
        </Card>
      </Section>

      <WeightSheet open={weightOpen} onClose={() => setWeightOpen(false)} />
    </Screen>
  );
}

/** Water per day of this week – a plain list, no statistics. */
function WaterWeek({ start, today: t }: { start: string; today: string }) {
  const state = useAppState();
  const days = waterWeek(state, start, t).filter((d) => !d.future);
  const goal = state.nutritionProfile?.waterGoalMl;
  if (!days.some((d) => d.ml > 0)) return null;
  return (
    <Card>
      <CardHeader title="Wasser" meta={goal ? `Ziel ${formatLitres(goal)}` : undefined} />
      <ul className={styles.waterList}>
        {days.map((d) => (
          <li key={d.date}>
            <span>{weekdayShort(weekdayIndex(d.date))}</span>
            <ProgressBar value={d.ml} max={goal ?? Math.max(...days.map((x) => x.ml))} height={6} color="#3b82c4" label={`Wasser ${weekdayShort(weekdayIndex(d.date))}`} />
            <strong>{d.ml ? `${d.reached ? '✓ ' : ''}${formatLitres(d.ml)}` : '–'}</strong>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function StatCard({ label, value, sub, ratio }: { label: string; value: string; sub?: string; ratio?: number }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <strong className={styles.statValue}>{value}</strong>
      {sub && <span className={styles.statSub}>{sub}</span>}
      {ratio !== undefined && Number.isFinite(ratio) && <ProgressBar value={ratio} max={1} height={4} />}
    </div>
  );
}
