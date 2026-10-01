import { useState } from 'react';
import { ageFromBirthYear, energyEstimate } from '../../../domain/body';
import { GOAL_BODY_FAT, KCAL_PER_KG, MAX_DEFICIT_SHARE, PACE } from '../../../domain/constants';
import { today } from '../../../domain/dates';
import { calorieFloorFor, forecast, GOAL_LABEL, GOAL_SUBTITLE, goalCalories, isMinor, macroTargets, recommendGoal, type Pace } from '../../../domain/goal';
import { asksPregnancy } from '../../../domain/onboarding/flow';
import { isSetupComplete } from '../../../domain/onboarding/migrate';
import type { GoalType, Sex } from '../../../domain/types';
import { fmt } from '../../../lib/format';
import { withUndo } from '../../../lib/undo';
import { applyGoalAsTarget, setOnboardingAnswer } from '../../../store/onboardingActions';
import { useAppState } from '../../../store/store';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { OptionCard, Segmented } from '../../../components/ui/Controls';
import { Sheet } from '../../../components/ui/Sheet';
import { NumberField } from './NumberField';
import styles from './onboardingV2.module.css';

const pct = (n: number) => `${n.toLocaleString('de-DE', { maximumFractionDigits: 3 })} %`;

/** What section A knows so far – the inputs of the goal step. */
function useAnswers() {
  const state = useAppState();
  const p = state.onboarding;
  const b = p?.body ?? {};
  const sex = (b.sex?.value ?? 'unspecified') as Sex;
  const age = b.birthYear ? ageFromBirthYear(b.birthYear.value, today()) : undefined;
  return {
    state,
    sex,
    sexKnown: !!b.sex,
    age,
    pregnancy: p?.health.pregnancy?.value,
    numberFree: p?.health.numberFree?.value ?? false,
    weightKg: b.weightKg?.value,
    heightCm: b.heightCm?.value,
    waistCm: b.waistCm?.value,
    bodyFat: b.bodyFat?.value,
    experience: b.trainingExperience?.value,
    paused: b.trainingPaused?.value,
    activity: b.activity?.value,
    goal: p?.goal.type?.value,
    pace: (p?.goal.pace?.value ?? 'normal') as Pace,
    targetWeightKg: p?.goal.targetWeightKg?.value,
    targetBodyFat: p?.goal.targetBodyFat?.value,
    level: p?.training.level?.value ?? state.profile?.experience,
    weekdays: p?.training.weekdays?.value ?? state.training?.weekdays ?? [],
    sessionMinutes: p?.training.sessionMinutes?.value,
  };
}

// ---------- Gesundheit ----------

export function HealthStep() {
  const a = useAnswers();
  const ask = asksPregnancy(a.sexKnown ? a.sex : undefined, a.age);
  const pregnant = a.pregnancy === 'pregnant' || a.pregnancy === 'breastfeeding';
  return (
    <div className={styles.stack}>
      {ask && (
        <div className={styles.stack} role="group" aria-label="Schwangerschaft oder Stillzeit">
          <span className={styles.label}>Bist du schwanger oder stillst du?</span>
          {(
            [
              ['no', 'Nein'],
              ['pregnant', 'Ja, ich bin schwanger'],
              ['breastfeeding', 'Ja, ich stille'],
            ] as const
          ).map(([value, title]) => (
            <OptionCard key={value} title={title} selected={a.pregnancy === value} onClick={() => setOnboardingAnswer('health', 'pregnancy', value)} />
          ))}
          {pregnant && (
            <p className={styles.tip}>
              Dann plant LifeFit kein Kaloriendefizit und berechnet keinen Mehrbedarf – den besprichst du am besten mit deiner Hebamme oder Ärztin bzw. deinem Arzt. Wenn du möchtest, kannst du unten ohne Kalorienzahlen arbeiten. Wir fragen in ein
              paar Monaten kurz nach, ob das noch gilt.
            </p>
          )}
        </div>
      )}
      {isMinor(a.age) && <p className={styles.tip}>Unter 18 plant LifeFit automatisch kein Kaloriendefizit – dein Körper braucht die Energie für die Entwicklung.</p>}

      <div className={styles.stack} role="group" aria-label="Kalorienzahlen">
        <span className={styles.label}>Möchtest du lieber ohne Kalorienzahlen arbeiten?</span>
        <OptionCard title="Mit Zahlen" description="Kalorien und Makros wie gewohnt" selected={!a.numberFree} onClick={() => setOnboardingAnswer('health', 'numberFree', false)} />
        <OptionCard title="Ohne Kalorienzahlen" description="Portionen und Fortschrittsringe statt kcal – jederzeit änderbar" selected={a.numberFree} onClick={() => setOnboardingAnswer('health', 'numberFree', true)} />
      </div>
      <p className={styles.hint}>Das ist eine Einstellung, keine Diagnose. LifeFit ersetzt keinen ärztlichen Rat.</p>
    </div>
  );
}

// ---------- Ziel ----------

const CONFIDENCE_LABEL = { hoch: 'Sicherheit: hoch', mittel: 'Sicherheit: mittel', niedrig: 'Sicherheit: niedrig' } as const;

/** A short, neutral word when the user picks another goal than recommended – no lecturing. */
const CHOICE_NOTE: Record<GoalType, string> = {
  fat_loss: 'Passt – mit viel Protein und Krafttraining bleiben die Muskeln erhalten.',
  recomp: 'Passt – nah an der Erhaltung, Fortschritt zeigt sich eher im Spiegel als auf der Waage.',
  muscle_gain: 'Passt – ein kleiner Überschuss reicht, langsam ist hier besser als schnell.',
  maintain: 'Passt – Halten ist ein gutes Ziel, Training macht dich trotzdem fitter.',
};

function paceLabel(goal: GoalType, pace: Pace, trained: boolean): string {
  if (goal === 'fat_loss') return `${pct(-PACE.fat_loss[pace])} pro Woche`;
  if (goal === 'muscle_gain') return `+${pct((trained ? PACE.muscle_gain.trained : PACE.muscle_gain.beginner)[pace])} pro Woche`;
  if (goal === 'recomp') return PACE.recomp[pace] === 0 ? 'Erhaltung' : `${pct(PACE.recomp[pace] * 100)} Energie`;
  return '';
}

export function GoalStep() {
  const a = useAnswers();
  const [why, setWhy] = useState(false);
  const known = !!(a.weightKg && a.heightCm && a.age !== undefined);
  const energy = known
    ? energyEstimate({
        sex: a.sex,
        age: a.age!,
        heightCm: a.heightCm!,
        weightKg: a.weightKg!,
        activity: a.activity ?? 'light',
        sessionsPerWeek: a.weekdays.length,
        ...(a.sessionMinutes ? { sessionMinutes: a.sessionMinutes } : {}),
        ...(a.bodyFat ? { bodyFat: a.bodyFat } : {}),
      })
    : undefined;
  const floor = energy ? calorieFloorFor(a.sex, energy.bmr) : undefined;
  const rec = recommendGoal({
    sex: a.sex,
    ...(a.age !== undefined ? { age: a.age } : {}),
    ...(a.pregnancy ? { pregnancy: a.pregnancy } : {}),
    ...(a.bodyFat ? { bodyFat: { percent: a.bodyFat.percent, method: a.bodyFat.method } } : {}),
    ...(a.weightKg ? { weightKg: a.weightKg } : {}),
    ...(a.heightCm ? { heightCm: a.heightCm } : {}),
    ...(a.waistCm ? { waistCm: a.waistCm } : {}),
    ...(a.experience ? { experience: a.experience } : {}),
    ...(a.paused ? { paused: a.paused } : {}),
    ...(energy ? { tdee: energy.tdee, floor } : {}),
  });
  const options = [rec.recommended, ...rec.alternatives];
  const chosen: GoalType = a.goal && options.includes(a.goal) ? a.goal : rec.recommended;
  const trained = a.level === 'intermediate' || a.level === 'advanced';
  const noDeficit = rec.locked;

  const calories = energy
    ? goalCalories({ goal: chosen, pace: a.pace, tdee: energy.tdee, bmr: energy.bmr, sex: a.sex, weightKg: a.weightKg!, noDeficit, ...(a.level ? { experience: a.level } : {}) })
    : undefined;
  const macros = calories
    ? macroTargets({ kcal: calories.kcal, weightKg: a.weightKg!, goal: chosen, sex: a.sex, ...(a.bodyFat ? { bodyFatPct: a.bodyFat.percent } : {}), ...(a.targetWeightKg ? { targetWeightKg: a.targetWeightKg } : {}) })
    : undefined;
  const prognosis =
    calories && a.weightKg
      ? forecast({
          weightKg: a.weightKg,
          weeklyChangeKg: calories.weeklyChangeKg,
          today: today(),
          ...(a.targetWeightKg ? { targetWeightKg: a.targetWeightKg } : {}),
          ...(a.targetBodyFat !== undefined && a.bodyFat ? { targetBodyFat: a.targetBodyFat, bodyFatPct: a.bodyFat.percent } : {}),
        })
      : undefined;
  const existing = isSetupComplete(a.state);

  return (
    <div className={styles.stack}>
      <Card className={styles.recommendation} aria-label="Empfehlung">
        <span className={styles.resultLabel}>{rec.locked ? 'Dein Ziel' : 'Unsere Empfehlung'}</span>
        <strong className={styles.recommendationTitle}>{GOAL_LABEL[rec.recommended]}</strong>
        <span>{GOAL_SUBTITLE[rec.recommended]}</span>
        <span className={styles.badge} data-confidence={rec.confidence}>
          {CONFIDENCE_LABEL[rec.confidence]}
        </span>
        <ul className={styles.reasons}>
          {rec.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        {rec.note && <p className={styles.hint}>{rec.note}</p>}
        <button type="button" className={styles.whyLink} onClick={() => setWhy(true)}>
          Warum?
        </button>
      </Card>

      {!rec.locked && (
        <div className={styles.stack} role="group" aria-label="Ziel wählen">
          {options.map((g) => (
            <OptionCard key={g} title={g === rec.recommended ? `${GOAL_LABEL[g]} (empfohlen)` : GOAL_LABEL[g]} description={GOAL_SUBTITLE[g]} selected={chosen === g} onClick={() => setOnboardingAnswer('goal', 'type', g)} />
          ))}
        </div>
      )}
      {chosen !== rec.recommended && <p className={styles.hint}>{CHOICE_NOTE[chosen]}</p>}
      {rec.blocked.length > 0 && !rec.locked && (
        <p className={styles.tip}>
          <strong>Nicht angeboten: {rec.blocked.map((b) => GOAL_LABEL[b.goal]).join(', ')}.</strong> {rec.blocked[0]!.reason}
        </p>
      )}

      {chosen !== 'maintain' && !noDeficit && (
        <div className={styles.stack}>
          <span className={styles.label}>Tempo</span>
          <Segmented<Pace>
            label="Tempo"
            value={a.pace}
            onChange={(v) => setOnboardingAnswer('goal', 'pace', v)}
            options={[
              { value: 'gentle', label: 'Sanft' },
              { value: 'normal', label: 'Normal' },
              { value: 'brisk', label: 'Zügig' },
            ]}
          />
          <p className={styles.hint}>{paceLabel(chosen, a.pace, trained)}</p>
        </div>
      )}

      {(chosen === 'fat_loss' || chosen === 'muscle_gain') && !noDeficit && a.weightKg && (
        <>
          <NumberField
            label="Zielgewicht (optional)"
            unit="kg"
            value={a.targetWeightKg}
            decimals={1}
            step={0.5}
            start={Math.round(a.weightKg + (chosen === 'fat_loss' ? -5 : 3))}
            plausible={[30, 300]}
            onChange={(v) => setOnboardingAnswer('goal', 'targetWeightKg', v)}
          />
          {a.bodyFat && chosen === 'fat_loss' && (
            <NumberField label="Oder Ziel-Körperfett (optional)" unit="%" value={a.targetBodyFat} step={1} start={Math.max(GOAL_BODY_FAT[a.sex === 'female' ? 'female' : 'male'].low, a.bodyFat.percent - 5)} plausible={[5, 50]} onChange={(v) => setOnboardingAnswer('goal', 'targetBodyFat', v)} />
          )}
          {prognosis && (
            <p className={styles.tip} aria-live="polite">
              Prognose für {fmt.kg(prognosis.targetWeightKg)}: <strong>{prognosis.label}</strong> – ein Zeitraum, weil der Körper nicht linear reagiert.
            </p>
          )}
        </>
      )}

      {calories && macros ? (
        <Card className={styles.result} aria-label="Tagesziel">
          <span className={styles.resultLabel}>Dein Tagesziel (Startwert)</span>
          {a.numberFree ? (
            <strong className={styles.resultValue}>Portionen statt Zahlen</strong>
          ) : (
            <strong className={styles.resultValue}>{fmt.kcal(calories.kcal)}</strong>
          )}
          <span>
            Protein {fmt.int(macros.protein)} g · Kohlenhydrate {fmt.int(macros.carbs)} g · Fett {fmt.int(macros.fat)} g
          </span>
          {calories.capped && <span className={styles.hint}>Das Defizit ist auf höchstens {MAX_DEFICIT_SHARE * 100} % deines Energiebedarfs begrenzt.</span>}
          {calories.floored && <span className={styles.hint}>Wir bleiben bei der Untergrenze – weniger empfehlen wir nicht.</span>}
          <span className={styles.hint}>Wir passen es anhand deines Gewichtsverlaufs automatisch an.</span>
          {existing && (
            <Button
              variant="secondary"
              onClick={() =>
                withUndo('Neues Tagesziel gespeichert', () => applyGoalAsTarget({ type: chosen, ...(a.targetWeightKg ? { targetWeightKg: a.targetWeightKg } : {}) }, macros))
              }
            >
              Als neues Tagesziel übernehmen
            </Button>
          )}
        </Card>
      ) : (
        <p className={styles.hint}>Mit Gewicht, Größe und Geburtsjahr berechnen wir dein Tagesziel.</p>
      )}

      <Sheet open={why} onClose={() => setWhy(false)} title="So entsteht die Empfehlung">
        <div className={styles.whySheet}>
          <p>
            <strong>Körperfett</strong> (Männer / Frauen): ab {GOAL_BODY_FAT.male.high} / {GOAL_BODY_FAT.female.high} % → Fett verlieren (Einsteiger auch Recomposition); {GOAL_BODY_FAT.male.low}–{GOAL_BODY_FAT.male.high} /{' '}
            {GOAL_BODY_FAT.female.low}–{GOAL_BODY_FAT.female.high} % → Einsteiger Recomposition, Erfahrene erst Fett verlieren; darunter → Muskelaufbau. Orientierung an den ACE-Körperfett-Kategorien. Recomposition gelingt vor allem
            Einsteigern und Wiedereinsteigern (Barakat et al. 2020).
          </p>
          <p>
            <strong>Ohne Körperfett</strong> schätzen wir es aus dem Taillenumfang (RFM) oder nutzen BMI und Erfahrung – deshalb ist die Sicherheit dann niedriger.
          </p>
          <p>
            <strong>Tempo:</strong> Fett verlieren 0,5–1 % des Körpergewichts pro Woche (Helms et al. 2014), Muskelaufbau +0,25–0,5 % (Einsteiger) bzw. +0,1–0,25 % (Erfahrene) pro Woche (Iraki et al. 2019). Umrechnung mit ca.{' '}
            {fmt.int(KCAL_PER_KG)} kcal pro kg – eine Näherung.
          </p>
          <p>
            <strong>Sicherheit:</strong> nie unter Grundumsatz × 1,1 und nie unter 1'200 kcal (Frauen) bzw. 1'500 kcal (Männer, keine Angabe); Defizit höchstens 25 %. Unter 18 sowie in Schwangerschaft und Stillzeit kein Defizit.
          </p>
          <p>
            <strong>Makros:</strong> Protein 1,6–2,2 g/kg (Morton et al. 2018; im Defizit oberer Bereich), bei viel Körperfett bezogen auf ein Referenzgewicht; Fett mindestens 0,8 g/kg und 20 % der Energie; der Rest Kohlenhydrate.
          </p>
        </div>
      </Sheet>
    </div>
  );
}
