import { useState } from 'react';
import { getExercise } from '../../../data/exercises';
import { ffmi, targetOptionsFor } from '../../../domain/body';
import { CARDIO } from '../../../domain/constants';
import { MUSCLE_LABEL } from '../../../domain/exerciseLibrary';
import { today } from '../../../domain/dates';
import { calculateTargets, targetForDate } from '../../../domain/nutrition';
import { cardioSurcharge, complaintGaps, estimateTrainingLevel, LEVEL_LABEL, placesToItems, PLACE_LABEL, recommendCardio, workingWeightExercises } from '../../../domain/onboarding/training';
import type { OnboardingProfile, OnboardingStepId } from '../../../domain/onboarding/types';
import type { BodyArea, CardioKind, CardioType, ComplaintSeverity, Experience, MuscleGroup, TrainingPlace } from '../../../domain/types';
import { currentWeight } from '../../../domain/progress';
import { withUndo } from '../../../lib/undo';
import { applyGoalAsTarget, setTrainingAnswer } from '../../../store/onboardingActions';
import { useAppState } from '../../../store/store';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Chip, Field, OptionCard, Segmented, WeekdayPicker } from '../../../components/ui/Controls';
import { Sheet } from '../../../components/ui/Sheet';
import { BACK, FRONT, type Zone } from '../../training/BodyMap';
import { PlanStep } from './AreaCPlan';
import { NumberField } from './NumberField';
import styles from './onboardingV2.module.css';

/** Steps of section C with their content (Prompt 7). */
export const AREA_C_STEPS: OnboardingStepId[] = ['level', 'frame', 'cardio', 'focus', 'plan'];

type Training = OnboardingProfile['training'];

export function AreaCStep({ step }: { step: OnboardingStepId }) {
  const profile = useAppState().onboarding;
  const t = profile?.training ?? {};
  switch (step) {
    case 'level':
      return <LevelStep profile={profile} t={t} />;
    case 'frame':
      return <FrameStep t={t} />;
    case 'cardio':
      return <CardioStep profile={profile} t={t} />;
    case 'focus':
      return <FocusStep t={t} />;
    case 'plan':
      return <PlanStep />;
    default:
      return null;
  }
}

// ---------- Erfahrung ----------

function LevelStep({ profile, t }: { profile: OnboardingProfile | undefined; t: Training }) {
  const b = profile?.body ?? {};
  const fat = b.bodyFat?.value;
  const ffmiNormalized = fat && b.weightKg && b.heightCm ? ffmi(b.weightKg.value, b.heightCm.value, fat.percent).normalized : undefined;
  const estimate = estimateTrainingLevel({
    sex: b.sex?.value ?? 'unspecified',
    ...(b.trainingExperience ? { years: b.trainingExperience.value } : {}),
    ...(t.pausedLong?.value ? { pausedLong: true } : {}),
    ...(ffmiNormalized !== undefined ? { ffmiNormalized } : {}),
  });
  // The recommendation is pre-selected; one tap overrides it.
  const chosen = t.level?.source === 'user' ? t.level.value : estimate.level;
  const weights = t.workingWeights?.value ?? {};
  const exercises = workingWeightExercises(t.places ? placesToItems(t.places.value) : t.equipment?.value);
  const setWeight = (id: string, part: 'kg' | 'reps', v: number | undefined) => {
    const current = weights[id] ?? { kg: 0, reps: 0 };
    const next = { ...weights, [id]: { ...current, [part]: v ?? 0 } };
    if (!(next[id]!.kg > 0) && !(next[id]!.reps > 0)) delete next[id];
    setTrainingAnswer('workingWeights', next);
  };

  return (
    <div className={styles.stack}>
      {b.trainingPaused?.value && (
        <div className={styles.stack} role="group" aria-label="Pause">
          <p className={styles.label}>Wie lange pausierst du schon?</p>
          <div className={styles.chips}>
            <Chip selected={t.pausedLong?.value === false} onClick={() => setTrainingAnswer('pausedLong', false)}>
              3–6 Monate
            </Chip>
            <Chip selected={t.pausedLong?.value === true} onClick={() => setTrainingAnswer('pausedLong', true)}>
              Länger als 6 Monate
            </Chip>
          </div>
        </div>
      )}
      <Card className={styles.recommendation} aria-label="Empfehlung">
        <p className={styles.eyebrow}>{t.level?.source === 'user' && chosen !== estimate.level ? 'Deine Wahl' : 'Unsere Einschätzung'}</p>
        <p className={styles.recommendationTitle}>{LEVEL_LABEL[estimate.level]}</p>
        <span className={styles.badge} data-confidence={estimate.confidence}>
          Sicherheit: {estimate.confidence}
        </span>
        <ul className={styles.reasons}>
          {estimate.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        {estimate.note && <p className={styles.tip}>{estimate.note}</p>}
      </Card>
      <div className={styles.stack} role="group" aria-label="Erfahrungsstufe">
        {(Object.keys(LEVEL_LABEL) as Experience[]).map((l) => (
          <OptionCard key={l} title={`${LEVEL_LABEL[l]}${l === estimate.level ? ' (empfohlen)' : ''}`} selected={chosen === l} onClick={() => setTrainingAnswer('level', l)} />
        ))}
      </div>

      {chosen !== 'beginner' && (
        <section className={styles.stack} aria-label="Arbeitsgewichte">
          <h2 className={styles.groupTitle}>Aktuelle Arbeitsgewichte (optional)</h2>
          <p className={styles.hint}>Gewicht × Wiederholungen eines typischen Satzes. Daraus wird dein Startgewicht – ohne Angabe beginnst du mit einem Einstiegs-Satz.</p>
          {exercises.map((id) => (
            <div key={id} className={styles.weightRow}>
              <span className={styles.label}>{getExercise(id)?.name ?? id}</span>
              <NumberField label={`${getExercise(id)?.name}: kg`} unit="kg" plain value={weights[id]?.kg || undefined} step={2.5} start={20} decimals={1} plausible={[1, 400]} onChange={(v) => setWeight(id, 'kg', v)} />
              <NumberField label={`${getExercise(id)?.name}: Wdh.`} unit="×" plain value={weights[id]?.reps || undefined} step={1} start={8} plausible={[1, 30]} onChange={(v) => setWeight(id, 'reps', v)} />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

// ---------- Dein Rahmen ----------

const DURATIONS = [
  { value: '30', label: '30 min' },
  { value: '45', label: '45 min' },
  { value: '60', label: '60 min' },
  { value: '75', label: '75+ min' },
];
const AREAS: { id: BodyArea; label: string }[] = [
  { id: 'shoulder', label: 'Schulter' },
  { id: 'knee', label: 'Knie' },
  { id: 'lower_back', label: 'Unterer Rücken' },
  { id: 'hip', label: 'Hüfte' },
  { id: 'wrist', label: 'Handgelenk' },
  { id: 'elbow', label: 'Ellbogen' },
];
const SEVERITY: { value: ComplaintSeverity; label: string }[] = [
  { value: 'mild', label: 'leicht' },
  { value: 'clear', label: 'deutlich' },
];

function FrameStep({ t }: { t: Training }) {
  const state = useAppState();
  const days = t.weekdays?.value ?? [];
  const places = t.places?.value ?? [];
  const complaints = t.complaints?.value ?? { areas: [] };
  const [note, setNote] = useState(complaints.note ?? '');
  const setComplaints = (next: typeof complaints) => setTrainingAnswer('complaints', next);
  const toggleArea = (a: BodyArea) => {
    const has = complaints.areas.includes(a);
    const severity = { ...complaints.severity };
    if (has) delete severity[a];
    else severity[a] = 'mild';
    setComplaints({ ...complaints, areas: has ? complaints.areas.filter((x) => x !== a) : [...complaints.areas, a], severity });
  };
  const gaps = complaints.areas.length ? complaintGaps(complaints.areas, state.training ? { ...state.training } : { limitations: { areas: complaints.areas, excludedExercises: [], ...(complaints.severity ? { severity: complaints.severity } : {}) } }) : [];

  return (
    <div className={styles.stack}>
      <p className={styles.label}>Trainingstage ({days.length} pro Woche)</p>
      <WeekdayPicker value={days} onChange={(d) => setTrainingAnswer('weekdays', d)} />
      {days.length > 0 && (days.length < 2 || days.length > 6) && <p className={styles.hint}>Empfohlen sind 2–6 Tage pro Woche – mindestens ein Ruhetag.</p>}

      <p className={styles.label}>Dauer pro Einheit</p>
      <Segmented label="Dauer pro Einheit" options={DURATIONS} value={t.sessionMinutes ? String(Math.min(75, t.sessionMinutes.value)) : ''} onChange={(v) => setTrainingAnswer('sessionMinutes', Number(v))} />

      <p className={styles.label}>Ort & Equipment (mehrere möglich)</p>
      <div className={styles.chips} role="group" aria-label="Ort & Equipment">
        {(Object.keys(PLACE_LABEL) as TrainingPlace[]).map((p) => (
          <Chip key={p} selected={places.includes(p)} onClick={() => setTrainingAnswer('places', places.includes(p) ? places.filter((x) => x !== p) : [...places, p])}>
            {PLACE_LABEL[p]}
          </Chip>
        ))}
      </div>

      <p className={styles.label}>Beschwerden (optional)</p>
      <div className={styles.chips} role="group" aria-label="Beschwerden">
        {AREAS.map((a) => (
          <Chip key={a.id} selected={complaints.areas.includes(a.id)} onClick={() => toggleArea(a.id)}>
            {a.label}
          </Chip>
        ))}
      </div>
      {complaints.areas.map((a) => (
        <div key={a} className={styles.pantryRow}>
          <span className={styles.label}>{AREAS.find((x) => x.id === a)!.label}</span>
          <Segmented
            label={`${AREAS.find((x) => x.id === a)!.label}: Stärke`}
            options={SEVERITY}
            value={complaints.severity?.[a] ?? 'clear'}
            onChange={(v) => setComplaints({ ...complaints, severity: { ...complaints.severity, [a]: v } })}
          />
        </div>
      ))}
      {complaints.areas.length > 0 && (
        <>
          <p className={styles.hint}>„leicht“: stark belastende Übungen werden ersetzt. „deutlich“: auch leicht belastende – immer durch gelenkschonende Alternativen, nicht einfach weggelassen.</p>
          <Field
            label="Was noch? (optional)"
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
            onBlur={() => note !== (complaints.note ?? '') && setComplaints({ ...complaints, ...(note.trim() ? { note: note.trim() } : { note: undefined }) })}
          />
          {gaps.length > 0 && (
            <p className={styles.tip} role="status">
              Für {gaps.length === 1 ? '1 Übung' : `${gaps.length} Übungen`} gibt es keine schonende Alternative für denselben Muskel ({gaps.slice(0, 3).map((g) => getExercise(g.exerciseId)?.name).join(', ')}
              {gaps.length > 3 ? ' …' : ''}). Wir weisen dich im Training darauf hin, statt sie still zu streichen.
            </p>
          )}
          <p className={styles.tip} role="note">
            Bei akuten Schmerzen lass das bitte ärztlich abklären. LifeFit stellt keine Diagnose.
          </p>
        </>
      )}
    </div>
  );
}

// ---------- Cardio ----------

const KINDS: { id: CardioKind; title: string; description: string }[] = [
  { id: 'none', title: 'Kein zusätzliches Cardio', description: 'Nur Krafttraining und Alltag.' },
  { id: 'steps', title: 'Schrittziel', description: `Ca. ${CARDIO.steps.toLocaleString('de-CH')} Schritte am Tag.` },
  { id: 'zone2', title: 'Zone 2', description: `Locker, Sprechen möglich – 2–3× ${CARDIO.zone2.minutes - 10}–${CARDIO.zone2.minutes + 10} min pro Woche.` },
  { id: 'hiit', title: 'HIIT', description: '1–2× kurz und intensiv pro Woche.' },
  { id: 'mix', title: 'Kombination', description: `Schrittziel + ${CARDIO.zone2.perWeek}× Zone 2.` },
];
const TYPES: { id: CardioType; label: string }[] = [
  { id: 'walking', label: 'Gehen' },
  { id: 'cycling', label: 'Rad' },
  { id: 'running', label: 'Laufen' },
  { id: 'rowing', label: 'Rudern' },
  { id: 'swimming', label: 'Schwimmen' },
  { id: 'crosstrainer', label: 'Crosstrainer' },
];

function CardioStep({ profile, t }: { profile: OnboardingProfile | undefined; t: Training }) {
  const state = useAppState();
  const [why, setWhy] = useState(false);
  const goal = profile?.goal.type?.value ?? state.goal?.type;
  const rec = recommendCardio(goal);
  const plan = t.cardio?.value ?? rec.plan;
  const weight = currentWeight(state.weights) ?? profile?.body.weightKg?.value;
  const extra = weight ? Math.round(cardioSurcharge(weight, plan) / 10) * 10 : 0;
  // A changed surcharge becomes a new target version only on confirmation (E10).
  const recalc = () => {
    if (!state.profile || !state.goal || !state.training || !weight) return undefined;
    const options = targetOptionsFor({ ...state, training: { ...state.training, cardio: plan } });
    return calculateTargets(state.profile, state.goal.type, weight, state.training.weekdays.length, options);
  };
  const next = recalc();
  const now = targetForDate(state.targets, today());
  const differs = next && now && Math.abs(next.kcal - now.kcal) >= 30;

  return (
    <div className={styles.stack}>
      <Card className={styles.recommendation} aria-label="Cardio-Empfehlung">
        <p className={styles.eyebrow}>Empfehlung für dein Ziel</p>
        <p className={styles.recommendationTitle}>{rec.label}</p>
        <button type="button" className={styles.whyLink} onClick={() => setWhy(true)}>
          Warum?
        </button>
      </Card>
      <div className={styles.stack} role="group" aria-label="Cardio">
        {KINDS.map((k) => (
          <OptionCard
            key={k.id}
            title={`${k.title}${k.id === rec.plan.kind ? ' (empfohlen)' : ''}`}
            description={k.description}
            selected={plan.kind === k.id}
            onClick={() => setTrainingAnswer('cardio', { kind: k.id, types: plan.types })}
          />
        ))}
      </div>
      {goal === 'muscle_gain' && <p className={styles.hint}>Leichtes Cardio für die Gesundheit – nicht direkt vor dem Beintraining.</p>}
      {plan.kind !== 'none' && (
        <>
          <p className={styles.label}>Was machst du gern?</p>
          <div className={styles.chips} role="group" aria-label="Bevorzugte Art">
            {TYPES.map((ty) => (
              <Chip key={ty.id} selected={plan.types.includes(ty.id)} onClick={() => setTrainingAnswer('cardio', { kind: plan.kind, types: plan.types.includes(ty.id) ? plan.types.filter((x) => x !== ty.id) : [...plan.types, ty.id] })}>
                {ty.label}
              </Chip>
            ))}
          </div>
        </>
      )}
      {extra > 0 && <p className={styles.hint}>Cardio-Einheiten erhöhen deinen Gesamtumsatz um ca. {extra} kcal pro Tag (Schritte stecken schon in deiner Alltagsaktivität).</p>}
      {differs && (
        <Button variant="secondary" onClick={() => withUndo('Neues Tagesziel gespeichert', () => applyGoalAsTarget({ type: state.goal!.type, ...(state.goal!.targetWeightKg ? { targetWeightKg: state.goal!.targetWeightKg } : {}) }, next!))}>
          Tagesziel anpassen ({next!.kcal.toLocaleString('de-CH')} kcal)
        </Button>
      )}
      <Sheet open={why} onClose={() => setWhy(false)} title="Warum diese Empfehlung?">
        <div className={styles.whySheet}>
          {rec.reasons.map((r) => (
            <p key={r}>{r}</p>
          ))}
          <p>Zone 2 heißt locker: Du kannst dabei noch in ganzen Sätzen sprechen.</p>
        </div>
      </Sheet>
    </div>
  );
}

// ---------- Fokus ----------

const FOCUS_GROUPS: MuscleGroup[] = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'core', 'glutes', 'quads', 'hamstrings', 'calves', 'forearms'];

function FocusStep({ t }: { t: Training }) {
  const focus = t.focusMuscles?.value ?? [];
  const toggle = (g: MuscleGroup) => {
    if (focus.includes(g)) return setTrainingAnswer('focusMuscles', focus.filter((x) => x !== g));
    if (focus.length >= 2) return; // at most two
    setTrainingAnswer('focusMuscles', [...focus, g]);
  };
  const figure = (zones: Zone[], dx: number, caption: string) => (
    <g transform={`translate(${dx} 0)`}>
      <circle cx="45" cy="18" r="11" className={styles.mapZone} data-state="none" />
      {zones.map((z, i) =>
        z.group ? (
          <rect key={i} x={z.x} y={z.y} width={z.w} height={z.h} rx={z.r ?? 4} className={styles.mapZone} data-state={focus.includes(z.group) ? 'on' : 'off'} data-group={z.group} onClick={() => toggle(z.group!)}>
            <title>{MUSCLE_LABEL[z.group]}</title>
          </rect>
        ) : (
          <rect key={i} x={z.x} y={z.y} width={z.w} height={z.h} rx={z.r ?? 4} className={styles.mapZone} data-state="none" />
        ),
      )}
      <text x="45" y="196" textAnchor="middle" className={styles.mapCaption}>
        {caption}
      </text>
    </g>
  );

  return (
    <div className={styles.stack}>
      <p className={styles.tip}>Fokus heißt etwas mehr Volumen für diese Muskeln, der Rest wird weiter trainiert.</p>
      <svg viewBox="0 0 190 200" className={styles.focusMap} role="img" aria-label={`Körperkarte, vorne und hinten – gewählt: ${focus.map((g) => MUSCLE_LABEL[g]).join(', ') || 'nichts'}`}>
        {figure(FRONT, 0, 'vorne')}
        {figure(BACK, 100, 'hinten')}
      </svg>
      <p className={styles.label}>Oder aus der Liste wählen (höchstens zwei)</p>
      <div className={styles.chips} role="group" aria-label="Fokus-Muskelgruppen">
        {FOCUS_GROUPS.map((g) => (
          <Chip key={g} selected={focus.includes(g)} onClick={() => toggle(g)}>
            {MUSCLE_LABEL[g]}
          </Chip>
        ))}
      </div>
      {focus.length >= 2 && <p className={styles.hint}>Zwei sind gewählt – tippe eine an, um sie zu tauschen.</p>}
    </div>
  );
}
