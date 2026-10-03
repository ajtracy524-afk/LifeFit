import { useMemo, useState } from 'react';
import { getExercise } from '../../../data/exercises';
import { targetOptionsFor } from '../../../domain/body';
import { today } from '../../../domain/dates';
import { MUSCLE_LABEL } from '../../../domain/exerciseLibrary';
import { calculateTargets, targetForDate } from '../../../domain/nutrition';
import type { PlanDraft } from '../../../domain/onboarding/types';
import { planInputOf, planKeyOf } from '../../../domain/onboarding/summary';
import { currentWeight } from '../../../domain/progress';
import { estimateMinutes } from '../../../domain/training';
import {
  candidatesFor,
  recommendPlan,
  replaceExercise,
  splitOptions,
  swapDays,
  validatePlan,
  type DayPlan,
  type SplitId,
} from '../../../domain/training/recommendPlan';
import { weekdayLong } from '../../../lib/format';
import { showToast } from '../../../lib/toast';
import { withUndo } from '../../../lib/undo';
import { adoptPlan, applyGoalAsTarget, setTrainingAnswer } from '../../../store/onboardingActions';
import { useAppState } from '../../../store/store';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { OptionCard } from '../../../components/ui/Controls';
import { Sheet } from '../../../components/ui/Sheet';
import styles from './onboardingV2.module.css';

const keyOf = planKeyOf;

/**
 * "Dein Trainingsplan" (Prompt 8): the generated week – 7 cards, swap days
 * (drag or the accessible "Tauschen"), switch the split, swap exercises, live
 * hints that never block, "Warum dieser Plan?", and "Plan übernehmen".
 */
export function PlanStep() {
  const state = useAppState();
  const input = planInputOf(state);
  const key = keyOf(input);
  const stored = state.onboarding?.training.planDraft?.value;
  const fresh = (split?: SplitId): PlanDraft => {
    const p = recommendPlan({ ...input, ...(split ? { split } : {}) });
    return { key, split: p.split.id, sessions: p.sessions, week: p.week };
  };
  // A stored draft counts only for the answers it was made for.
  const draft = stored && stored.key === key ? stored : undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands in for the answers in `input` (a new object each render)
  const generated = useMemo(() => recommendPlan({ ...input, ...(draft ? { split: draft.split } : {}) }), [key, draft?.split]);
  const plan: PlanDraft = draft ?? { key, split: generated.split.id, sessions: generated.sessions, week: generated.week };
  const save = (next: PlanDraft) => setTrainingAnswer('planDraft', next);
  // Generator notes (adjustments, gaps) plus the live check of the current week – hints, never a block.
  const notes = [...generated.notes, ...validatePlan({ ...plan, sessionMinutes: input.sessionMinutes })];
  const [open, setOpen] = useState<number | undefined>(undefined);
  const [why, setWhy] = useState(false);
  const [dragged, setDragged] = useState<number | undefined>(undefined);
  const [adopted, setAdopted] = useState(false);
  const options = splitOptions(input.weekdays.length, input.level);
  const adoptedHere = state.training?.programId === state.onboarding?.training.plan?.value.programId && adopted;

  const swap = (a: number, b: number) => a !== b && save({ ...plan, week: swapDays(plan.week, a, b) });

  // The new training days change the surcharge – a new target only on confirmation (E10).
  const weight = currentWeight(state.weights);
  const next = adoptedHere && state.profile && state.goal && state.training && weight ? calculateTargets(state.profile, state.goal.type, weight, state.training.weekdays.length, targetOptionsFor(state)) : undefined;
  const now = targetForDate(state.targets, today());

  return (
    <div className={styles.stack}>
      <Card className={styles.recommendation} aria-label="Split">
        <p className={styles.eyebrow}>Dein Split</p>
        <p className={styles.recommendationTitle}>{generated.split.label}</p>
        <p className={styles.hint}>{generated.split.reason}</p>
        <button type="button" className={styles.whyLink} onClick={() => setWhy(true)}>
          Warum dieser Plan?
        </button>
      </Card>
      {options.length > 1 && (
        <div className={styles.stack} role="group" aria-label="Split wechseln">
          <p className={styles.label}>Split wechseln</p>
          {options.map((o) => (
            <OptionCard key={o.id} title={o.label} description={o.reason} selected={plan.split === o.id} onClick={() => o.id !== plan.split && save(fresh(o.id))} />
          ))}
        </div>
      )}

      {notes.length > 0 && (
        <ul className={styles.planNotes} aria-label="Hinweise zum Plan">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <ol className={styles.weekPlan} aria-label="Deine Woche">
        {plan.week.map((d) => (
          <li
            key={d.weekday}
            className={styles.planDay}
            data-kind={d.kind}
            draggable
            onDragStart={() => setDragged(d.weekday)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => dragged !== undefined && swap(dragged, d.weekday)}
          >
            <div className={styles.subgroup}>
              <strong>{weekdayLong(d.weekday)}</strong>
              <select aria-label={`${weekdayLong(d.weekday)} tauschen mit`} value="" onChange={(e) => e.currentTarget.value !== '' && swap(d.weekday, Number(e.currentTarget.value))}>
                <option value="">Tauschen …</option>
                {plan.week
                  .filter((x) => x.weekday !== d.weekday)
                  .map((x) => (
                    <option key={x.weekday} value={x.weekday}>
                      mit {weekdayLong(x.weekday)}
                    </option>
                  ))}
              </select>
            </div>
            <DayContent day={d} plan={plan} />
            {d.kind === 'strength' && (
              <>
                <button type="button" className={styles.whyLink} aria-expanded={open === d.session} onClick={() => setOpen(open === d.session ? undefined : d.session)}>
                  {open === d.session ? 'Übungen zuklappen' : 'Übungen ansehen'}
                </button>
                {open === d.session && (
                  <ul className={styles.planExercises}>
                    {plan.sessions[d.session]!.template.exercises.map((te, i) => {
                      const ex = getExercise(te.exerciseId);
                      const alternatives = ex ? candidatesFor(ex.primary, input).filter((a) => a.id !== te.exerciseId) : [];
                      return (
                        <li key={`${te.exerciseId}-${i}`}>
                          <span>
                            {te.sets} × {te.repMin}–{te.repMax} {ex?.name}
                            {te.supersetGroup ? ' · Supersatz' : ''}
                          </span>
                          {alternatives.length > 0 && (
                            <select aria-label={`${ex?.name} tauschen`} value="" onChange={(e) => e.currentTarget.value && save({ ...plan, sessions: replaceExercise(plan.sessions, d.session, i, e.currentTarget.value) })}>
                              <option value="">Übung tauschen …</option>
                              {alternatives.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name}
                                </option>
                              ))}
                            </select>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </li>
        ))}
      </ol>

      {adoptedHere ? (
        <div className={styles.tip} role="status">
          Plan übernommen – er steht ab heute in deinem Training und auf Heute.
          {next && now && Math.abs(next.kcal - now.kcal) >= 30 && (
            <div className={styles.tipAction}>
              <Button size="sm" variant="secondary" onClick={() => withUndo('Neues Tagesziel gespeichert', () => applyGoalAsTarget({ type: state.goal!.type, ...(state.goal!.targetWeightKg ? { targetWeightKg: state.goal!.targetWeightKg } : {}) }, next))}>
                Tagesziel an die Trainingstage anpassen ({next.kcal.toLocaleString('de-CH')} kcal)
              </Button>
            </div>
          )}
        </div>
      ) : (
        <Button
          block
          onClick={() => {
            if (withUndo('Plan übernommen', () => !!adoptPlan(plan))) setAdopted(true);
            else showToast('Der Plan konnte nicht übernommen werden – sind Trainingstage gewählt?');
          }}
        >
          Plan übernehmen
        </Button>
      )}

      <Sheet open={why} onClose={() => setWhy(false)} title="Warum dieser Plan?">
        <div className={styles.whySheet}>
          {generated.reasons.map((r) => (
            <p key={r}>{r}</p>
          ))}
          <p>Jeder Muskel wird mindestens 2× pro Woche trainiert – bei gleichem Volumen wirksamer als 1× (Schoenfeld, Ogborn & Krieger 2016).</p>
          <p>Mehr harte Sätze bringen bis zu einem Punkt mehr Muskelaufbau (Schoenfeld et al. 2017; Pelland et al. 2024). Unterstützende Muskeln zählen halb.</p>
          <p>Nah am Muskelversagen (1–3 Wiederholungen Reserve) ist der Bereich der Wiederholungen weniger wichtig (Schoenfeld et al. 2017; Refalo et al. 2023).</p>
          <p>Keine schweren Einheiten für dieselben Muskeln an zwei Tagen hintereinander; Zone 2 an Ruhetagen oder nach dem Krafttraining, HIIT nicht am Tag vor dem Beintraining.</p>
        </div>
      </Sheet>
    </div>
  );
}

function DayContent({ day, plan }: { day: DayPlan; plan: PlanDraft }) {
  if (day.kind === 'strength') {
    const s = plan.sessions[day.session]!;
    const main = [...new Set(s.heavy)].map((m) => MUSCLE_LABEL[m]).join(', ');
    return (
      <p>
        🏋️ <strong>{s.template.name}</strong> · ca. {estimateMinutes(s.template)} min
        <br />
        <span className={styles.hint}>{main || s.template.focus}</span>
        {day.cardioAfter && <span className={styles.hint}> · danach Zone 2</span>}
      </p>
    );
  }
  if (day.kind === 'extra') return <p>{day.extra === 'mobility' ? '🧘 Mobilität & Erholung' : '🚴 Lockeres Cardio (Zone 2)'}</p>;
  if (day.cardio) return <p>{day.cardio === 'hiit' ? '⚡ HIIT (kurz)' : '🚴 Zone 2 – locker, Sprechen möglich'}</p>;
  return <p>🌿 Ruhe</p>;
}
