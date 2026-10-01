import { useEffect, useMemo, useState } from 'react';
import { PROGRAMS, getExercise } from '../../data/exercises';
import { programsFor, recommendationReason, recommendProgram } from '../../domain/programs';
import { today } from '../../domain/dates';
import { calculateTargets } from '../../domain/nutrition';
import { slotsFor } from '../../domain/planner';
import { formatLitres, waterStartValue } from '../../domain/water';
import type { ActivityLevel, Allergen, DietType, EquipmentItem, GoalType, MealStyle, Sex, TrainingEquipment } from '../../domain/types';
import { DEFAULT_ITEMS, defaultFocus, experienceFrom } from '../../domain/trainingProfile';
import { EquipmentItemsField, TrainingProfileFields, type TrainingProfileDraft } from '../training/TrainingProfileFields';
import { fmt } from '../../lib/format';
import { navigate } from '../../lib/router';
import { showToast } from '../../lib/toast';
import { completeOnboarding } from '../../store/actions';
import { Button, IconButton } from '../../components/ui/Button';
import { Chip, Field, OptionCard, Segmented, Stepper, WeekdayPicker, parseNumber } from '../../components/ui/Controls';
import { ProgressBar } from '../../components/ui/Progress';
import { estimateMinutes } from '../training/trainingUtils';
import { defaultMealStyle, MealStylePicker, TastePicker } from '../nutrition/TastePicker';
import styles from './onboarding.module.css';

type Step = 'welcome' | 'goal' | 'body' | 'training' | 'nutrition' | 'tastes' | 'style' | 'program' | 'result' | 'creating';
const STEPS: Step[] = ['welcome', 'goal', 'body', 'training', 'nutrition', 'tastes', 'style', 'program', 'result', 'creating'];

const DEFAULT_DAYS: Record<number, number[]> = {
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 3, 4],
  6: [0, 1, 2, 3, 4, 5],
};


interface BodyForm {
  name: string;
  sex: Sex;
  age: string;
  height: string;
  weight: string;
  targetWeight: string;
  /** Optional, in %; an estimate is stored as such (shown as a range). */
  bodyFat: string;
  bodyFatEstimate: boolean;
}

export function Onboarding() {
  const [step, setStep] = useState<Step>('welcome');
  const [goal, setGoal] = useState<GoalType>('muscle_gain');
  const [body, setBody] = useState<BodyForm>({ name: '', sex: 'male', age: '', height: '', weight: '', targetWeight: '', bodyFat: '', bodyFatEstimate: false });
  const [errors, setErrors] = useState<Partial<Record<keyof BodyForm, string>>>({});
  const [activity, setActivity] = useState<ActivityLevel>('sedentary');
  const [weekdays, setWeekdays] = useState<number[]>(DEFAULT_DAYS[3]!);
  const [tp, setTp] = useState<TrainingProfileDraft>({ trainingYears: 0, freeWeights: 'some', focus: defaultFocus('muscle_gain'), musclePriorities: [], limitationAreas: [] });
  // The level follows from training age and free-weight skill (one source: domain/trainingProfile).
  const experience = experienceFrom(tp.trainingYears, tp.freeWeights);
  const [diet, setDiet] = useState<DietType>('omnivore');
  const [excluded, setExcluded] = useState<Allergen[]>([]);
  const [mealsPerDay, setMealsPerDay] = useState<'3' | '4'>('4');
  // Water goal in litres – null = untouched, then the start value from the body weight is offered.
  const [waterLitres, setWaterLitres] = useState<string | null>(null);
  const [tastes, setTastes] = useState<{ favorites: string[]; avoided: string[] }>({ favorites: [], avoided: [] });
  const [mealStyle, setMealStyle] = useState<MealStyle | null>(null);
  const [programId, setProgramId] = useState<string | null>(null);
  const [equipment, setEquipmentProfile] = useState<TrainingEquipment>('gym');
  const [items, setItems] = useState<EquipmentItem[]>(DEFAULT_ITEMS.gym);
  const setEquipment = (v: TrainingEquipment) => {
    setEquipmentProfile(v);
    setItems(DEFAULT_ITEMS[v]);
  };
  const [adjust, setAdjust] = useState({ kcal: 0, protein: 0 });

  // The focus proposal follows the goal (the training step comes later and can change it).
  const pickGoal = (g: GoalType) => {
    setGoal(g);
    setTp((t) => ({ ...t, focus: defaultFocus(g) }));
  };
  const bodyFat = body.bodyFat.trim() && parseNumber(body.bodyFat) >= 3 && parseNumber(body.bodyFat) <= 60 ? { value: parseNumber(body.bodyFat), method: body.bodyFatEstimate ? ('estimate' as const) : ('measured' as const) } : undefined;

  const index = STEPS.indexOf(step);
  // Block body on purpose: newer browsers return a Promise from scrollTo(),
  // and React would treat any returned value as the effect's cleanup.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step]);
  const next = () => setStep(STEPS[index + 1]!);
  const back = () => setStep(STEPS[index - 1]!);

  const weight = parseNumber(body.weight);
  const waterStart = waterStartValue(Number.isFinite(weight) ? weight : undefined);
  const waterText = waterLitres ?? (waterStart ? String(waterStart / 1000).replace('.', ',') : '');
  const waterValue = parseNumber(waterText);
  const waterValid = waterText.trim() === '' || (Number.isFinite(waterValue) && waterValue >= 0.5 && waterValue <= 6);
  const waterGoalMl = waterText.trim() && waterValid ? Math.round((waterValue * 1000) / 50) * 50 : undefined;
  const fit = { days: weekdays.length, experience, goal, equipment };
  const recommended = recommendProgram(fit);
  // A program chosen for other equipment does not stay selected.
  const effectiveProgram = programId && programsFor(equipment).some((p) => p.id === programId) ? programId : recommended;

  const calc = useMemo(() => {
    if (!Number.isFinite(weight)) return null;
    return calculateTargets(
      { sex: body.sex, age: parseNumber(body.age), heightCm: parseNumber(body.height), activity },
      goal,
      weight,
      weekdays.length,
      { ...(bodyFat ? { bodyFat: { method: bodyFat.method === 'measured' ? 'measured' : 'visual', percent: bodyFat.value } } : {}), ...(tp.sessionMinutes ? { sessionMinutes: tp.sessionMinutes } : {}) },
    );
  }, [body, activity, goal, weight, weekdays.length, bodyFat?.value, bodyFat?.method, tp.sessionMinutes]);

  const suggestedStyle = defaultMealStyle(goal, calc?.kcal);
  const effectiveStyle = mealStyle ?? suggestedStyle;

  const finalTarget = useMemo(() => {
    if (!calc) return null;
    const kcal = calc.kcal + adjust.kcal;
    const protein = calc.protein + adjust.protein;
    const fat = calc.fat;
    const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
    return { kcal, protein, carbs, fat };
  }, [calc, adjust]);

  const validateBody = (): boolean => {
    const e: typeof errors = {};
    const age = parseNumber(body.age);
    const height = parseNumber(body.height);
    const target = body.targetWeight ? parseNumber(body.targetWeight) : undefined;
    if (!Number.isFinite(age) || age < 14 || age > 100) e.age = 'Bitte gib ein Alter zwischen 14 und 100 an.';
    if (!Number.isFinite(height) || height < 120 || height > 230) e.height = 'Bitte gib deine Größe in cm an (120–230).';
    if (!Number.isFinite(weight) || weight < 30 || weight > 300) e.weight = 'Bitte gib dein Gewicht in kg an (30–300).';
    if (body.bodyFat.trim() && !(parseNumber(body.bodyFat) >= 3 && parseNumber(body.bodyFat) <= 60)) e.bodyFat = 'Bitte einen Wert zwischen 3 und 60 % angeben – oder leer lassen.';
    if (target !== undefined) {
      if (!Number.isFinite(target) || target < 30 || target > 300) e.targetWeight = 'Bitte prüfe dein Zielgewicht.';
      else if (goal === 'muscle_gain' && target <= weight) e.targetWeight = 'Für Muskelaufbau sollte das Ziel über deinem Gewicht liegen.';
      else if (goal === 'fat_loss' && target >= weight) e.targetWeight = 'Zum Abnehmen sollte das Ziel unter deinem Gewicht liegen.';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const finish = () => {
    if (!finalTarget) return;
    setStep('creating');
  };

  // The "creating" step saves and shows a short, honest progress animation.
  useEffect(() => {
    if (step !== 'creating' || !finalTarget) return;
    const target = body.targetWeight ? parseNumber(body.targetWeight) : undefined;
    const timer = window.setTimeout(() => {
      try {
        completeOnboarding({
          profile: {
            name: body.name.trim(),
            sex: body.sex,
            age: parseNumber(body.age),
            heightCm: parseNumber(body.height),
            activity,
            experience,
            createdAt: new Date().toISOString(),
          },
          goal: { type: goal, startWeightKg: weight, targetWeightKg: goal === 'maintain' || goal === 'recomp' ? undefined : target, startedAt: today() },
          nutritionProfile: {
            diet,
            excluded,
            slots: slotsFor(mealsPerDay === '3' ? 3 : 4),
            ...(waterGoalMl ? { waterGoalMl } : {}),
            favorites: tastes.favorites,
            avoided: tastes.avoided,
            mealStyle: effectiveStyle,
          },
          training: {
            programId: effectiveProgram,
            weekdays: [...weekdays].sort((a, b) => a - b),
            equipment,
            startedAt: today(),
            trainingYears: tp.trainingYears,
            freeWeights: tp.freeWeights,
            ...(tp.sessionMinutes ? { sessionMinutes: tp.sessionMinutes } : {}),
            equipmentItems: items,
            focus: tp.focus,
            ...(tp.musclePriorities.length ? { musclePriorities: tp.musclePriorities } : {}),
            ...(tp.limitationAreas.length ? { limitations: { areas: tp.limitationAreas, excludedExercises: [] } } : {}),
          },
          ...(bodyFat ? { bodyFat } : {}),
          target: finalTarget,
          weightKg: weight,
        });
        navigate('today', undefined, { replace: true });
        showToast('Deine Woche steht – inklusive Einkaufsliste.');
      } catch (err) {
        console.error(err);
        showToast('Das hat nicht geklappt. Bitte versuch es noch einmal.', { tone: 'error' });
        setStep('result');
      }
    }, 1400);
    return () => window.clearTimeout(timer);
    // Intentionally keyed on the step only: runs once when entering "creating".
  }, [step]);

  const program = PROGRAMS.find((p) => p.id === effectiveProgram)!;

  return (
    <div className={styles.shell}>
      {step !== 'welcome' && step !== 'creating' && (
        <header className={styles.top}>
          <IconButton icon="chevronLeft" label="Zurück" onClick={back} />
          <ProgressBar value={index} max={STEPS.length - 2} height={4} label="Fortschritt der Einrichtung" />
          <span className={styles.stepCount}>
            {index}/{STEPS.length - 2}
          </span>
        </header>
      )}

      <main className={styles.content}>
        {step === 'welcome' && (
          <div className={styles.welcome}>
            <div className={styles.logo} aria-hidden>
              <svg viewBox="0 0 64 64" width="72" height="72">
                <rect width="64" height="64" rx="18" fill="var(--accent)" />
                <circle cx="32" cy="32" r="17" fill="none" stroke="var(--on-accent)" strokeOpacity="0.3" strokeWidth="6" />
                <path d="M32 15a17 17 0 0 1 16.2 22.2" fill="none" stroke="var(--on-accent)" strokeWidth="6" strokeLinecap="round" />
              </svg>
            </div>
            <h1 className={styles.hero}>Plane deine Woche.<br />Wir kümmern uns um den Rest.</h1>
            <ul className={styles.pillars}>
              <li>
                <span>🍽️</span>
                <div>
                  <strong>Essensplan passend zu deinem Ziel</strong>
                  <p>Kalorien & Protein ohne Rechnen</p>
                </div>
              </li>
              <li>
                <span>🛒</span>
                <div>
                  <strong>Einkaufsliste entsteht automatisch</strong>
                  <p>Zusammengefasst und nach Supermarkt sortiert</p>
                </div>
              </li>
              <li>
                <span>🏋️</span>
                <div>
                  <strong>Training mit einem Tap tracken</strong>
                  <p>Mit deinen Werten vom letzten Mal</p>
                </div>
              </li>
            </ul>
          </div>
        )}

        {step === 'goal' && (
          <>
            <StepTitle title="Was ist dein Ziel?" text="Danach richten wir Kalorien, Protein und Training aus." />
            <div className={styles.stack}>
              <OptionCard emoji="💪" title="Muskelaufbau" description="Stärker werden, sauber zunehmen" selected={goal === 'muscle_gain'} onClick={() => pickGoal('muscle_gain')} />
              <OptionCard emoji="🔥" title="Fett verlieren" description="Abnehmen und Muskeln erhalten" selected={goal === 'fat_loss'} onClick={() => pickGoal('fat_loss')} />
              <OptionCard emoji="🔄" title="Recomposition" description="Muskeln aufbauen und Fett verlieren – Gewicht bleibt etwa gleich" selected={goal === 'recomp'} onClick={() => pickGoal('recomp')} />
              <OptionCard emoji="⚖️" title="Fit bleiben" description="Gewicht halten, fitter werden" selected={goal === 'maintain'} onClick={() => pickGoal('maintain')} />
            </div>
          </>
        )}

        {step === 'body' && (
          <>
            <StepTitle title="Ein paar Eckdaten" text="Damit berechnen wir deinen Energiebedarf." />
            <div className={styles.stack}>
              <Field label="Wie dürfen wir dich nennen?" placeholder="Vorname (optional)" value={body.name} onChange={(e) => setBody({ ...body, name: e.target.value })} autoComplete="given-name" />
              <div>
                <p className={styles.label}>Für die Berechnung</p>
                <Segmented
                  label="Geschlecht"
                  value={body.sex}
                  onChange={(sex) => setBody({ ...body, sex })}
                  options={[
                    { value: 'male', label: 'Männlich' },
                    { value: 'female', label: 'Weiblich' },
                  ]}
                />
              </div>
              <div className={styles.row}>
                <Field label="Alter" inputMode="numeric" suffix="Jahre" value={body.age} error={errors.age} onChange={(e) => setBody({ ...body, age: e.target.value })} />
                <Field label="Größe" inputMode="numeric" suffix="cm" value={body.height} error={errors.height} onChange={(e) => setBody({ ...body, height: e.target.value })} />
              </div>
              <div className={styles.row}>
                <Field label="Gewicht" inputMode="decimal" suffix="kg" value={body.weight} error={errors.weight} onChange={(e) => setBody({ ...body, weight: e.target.value })} />
                {goal !== 'maintain' && goal !== 'recomp' && (
                  <Field
                    label="Zielgewicht"
                    inputMode="decimal"
                    suffix="kg"
                    placeholder="optional"
                    value={body.targetWeight}
                    error={errors.targetWeight}
                    onChange={(e) => setBody({ ...body, targetWeight: e.target.value })}
                  />
                )}
              </div>
              <Field
                label="Körperfett (optional)"
                inputMode="decimal"
                suffix="%"
                placeholder="leer lassen, wenn unbekannt"
                value={body.bodyFat}
                error={errors.bodyFat}
                hint={body.bodyFatEstimate ? 'Grobe Schätzung – LifeFit zeigt dafür nur einen Bereich an.' : 'Z. B. aus einer Messung (Waage, Caliper, DEXA).'}
                onChange={(e) => setBody({ ...body, bodyFat: e.target.value })}
              />
              {body.bodyFat.trim() && (
                <Chip selected={body.bodyFatEstimate} onClick={() => setBody({ ...body, bodyFatEstimate: !body.bodyFatEstimate })}>
                  Nur geschätzt
                </Chip>
              )}
              <p className={styles.privacy}>🔒 Deine Daten bleiben auf diesem Gerät und werden nicht geteilt.</p>
            </div>
          </>
        )}

        {step === 'training' && (
          <>
            <StepTitle title="Dein Alltag & Training" />
            <div className={styles.stack}>
              <p className={styles.label}>Wie aktiv ist dein Alltag (ohne Sport)?</p>
              <OptionCard title="Überwiegend sitzend" description="Büro, Studium, Homeoffice" selected={activity === 'sedentary'} onClick={() => setActivity('sedentary')} />
              <OptionCard title="Leicht aktiv" description="Viel zu Fuß, Stehen im Job" selected={activity === 'light'} onClick={() => setActivity('light')} />
              <OptionCard title="Aktiv" description="Körperlich im Job, z. B. Pflege, Handel" selected={activity === 'moderate'} onClick={() => setActivity('moderate')} />
              <OptionCard title="Sehr aktiv" description="Schwere körperliche Arbeit" selected={activity === 'active'} onClick={() => setActivity('active')} />

              <p className={styles.label}>Wie oft willst du trainieren?</p>
              <div className={styles.chips}>
                {[2, 3, 4, 5, 6].map((n) => (
                  <Chip key={n} selected={weekdays.length === n} onClick={() => setWeekdays(DEFAULT_DAYS[n]!)}>
                    {n}× pro Woche
                  </Chip>
                ))}
              </div>
              <p className={styles.label}>An welchen Tagen?</p>
              <WeekdayPicker value={weekdays} onChange={setWeekdays} />
              <TrainingProfileFields value={tp} onChange={setTp} />
            </div>
          </>
        )}

        {step === 'nutrition' && (
          <>
            <StepTitle title="Wie isst du?" text="Wir schlagen nur Rezepte vor, die dazu passen." />
            <div className={styles.stack}>
              <OptionCard emoji="🍗" title="Alles" selected={diet === 'omnivore'} onClick={() => setDiet('omnivore')} />
              <OptionCard emoji="🥚" title="Vegetarisch" selected={diet === 'vegetarian'} onClick={() => setDiet('vegetarian')} />
              <OptionCard emoji="🌱" title="Vegan" selected={diet === 'vegan'} onClick={() => setDiet('vegan')} />
              <p className={styles.label}>Unverträglichkeiten oder No-Gos</p>
              <div className={styles.chips}>
                {(
                  [
                    ['lactose', 'Laktose'],
                    ['gluten', 'Gluten'],
                    ['nuts', 'Nüsse'],
                    ['fish', 'Fisch'],
                  ] as [Allergen, string][]
                ).map(([id, label]) => (
                  <Chip key={id} selected={excluded.includes(id)} onClick={() => setExcluded(excluded.includes(id) ? excluded.filter((a) => a !== id) : [...excluded, id])}>
                    {label}
                  </Chip>
                ))}
              </div>
              <p className={styles.label}>Mahlzeiten pro Tag</p>
              <Segmented
                label="Mahlzeiten pro Tag"
                value={mealsPerDay}
                onChange={setMealsPerDay}
                options={[
                  { value: '3', label: '3 Mahlzeiten' },
                  { value: '4', label: '3 + Snack' },
                ]}
              />
              <Field
                label="Wasser pro Tag"
                inputMode="decimal"
                suffix="L"
                placeholder="kein Ziel"
                value={waterText}
                error={waterValid ? undefined : 'Bitte einen Wert zwischen 0,5 und 6 L angeben – oder leer lassen.'}
                hint={`Zählt als Tagesziel.${waterStart ? ` Startwert ${formatLitres(waterStart)} (Faustregel ca. 35 ml pro kg) – keine medizinische Empfehlung, passe ihn frei an.` : ''}`}
                onChange={(e) => setWaterLitres(e.target.value)}
              />
            </div>
          </>
        )}

        {step === 'tastes' && (
          <>
            <StepTitle title="Was würdest du gern häufiger essen?" text="Wähle so viele du magst. LifeFit plant davon öfter – und lernt später aus dem, was du wirklich isst." />
            <TastePicker filter={{ diet, excluded }} favorites={tastes.favorites} avoided={tastes.avoided} onChange={setTastes} />
          </>
        )}

        {step === 'style' && (
          <>
            <StepTitle title="Welche Mahlzeiten passen zu dir?" />
            <MealStylePicker filter={{ diet, excluded }} avoided={tastes.avoided} value={effectiveStyle} suggested={suggestedStyle} kcal={calc?.kcal} onChange={setMealStyle} />
          </>
        )}

        {step === 'program' && (
          <>
            <StepTitle title="Dein Trainingsplan" text={`Für ${weekdays.length} Tage pro Woche empfehlen wir:`} />
            <div className={styles.stack}>
              <Segmented<TrainingEquipment>
                label="Wo trainierst du?"
                value={equipment}
                onChange={setEquipment}
                options={[
                  { value: 'gym', label: 'Studio' },
                  { value: 'home', label: 'Zuhause (KH)' },
                  { value: 'bodyweight', label: 'Ohne Geräte' },
                ]}
              />
              <EquipmentItemsField items={items} onChange={setItems} />
              {programsFor(equipment).map((p) => (
                <OptionCard
                  key={p.id}
                  title={p.id === recommended ? `${p.name} · Empfohlen` : p.name}
                  description={p.id === recommended ? `${recommendationReason(fit)} ${p.description}` : p.description}
                  selected={effectiveProgram === p.id}
                  onClick={() => setProgramId(p.id)}
                />
              ))}
              <div className={styles.preview}>
                {program.templates.map((t) => (
                  <div key={t.id} className={styles.previewItem}>
                    <strong>{t.name}</strong>
                    <span>
                      {t.exercises
                        .slice(0, 3)
                        .map((e) => getExercise(e.exerciseId)?.name)
                        .join(', ')}{' '}
                      … · ~{estimateMinutes(t)} min
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {step === 'result' && calc && finalTarget && (
          <>
            <StepTitle title="Dein Tagesziel" text={resultText(goal)} />
            <div className={styles.result}>
              <div className={styles.resultKcal}>
                <strong>{fmt.int(finalTarget.kcal)}</strong>
                <span>kcal pro Tag</span>
              </div>
              <div className={styles.resultMacros}>
                <div>
                  <strong>{finalTarget.protein} g</strong>
                  <span>Protein</span>
                </div>
                <div>
                  <strong>{finalTarget.carbs} g</strong>
                  <span>Kohlenhydrate</span>
                </div>
                <div>
                  <strong>{finalTarget.fat} g</strong>
                  <span>Fett</span>
                </div>
              </div>
              <p className={styles.explain}>
                Grundumsatz {fmt.kcal(calc.bmr)} · Gesamtbedarf ca. {fmt.kcal(calc.tdee)}
              </p>
            </div>
            <div className={styles.adjust}>
              <div className={styles.adjustRow}>
                <span>Kalorien anpassen</span>
                <Stepper
                  label="Kalorien"
                  value={adjust.kcal}
                  onChange={(v) => setAdjust({ ...adjust, kcal: v })}
                  step={50}
                  min={-400}
                  max={400}
                  format={(v) => (v === 0 ? '±0' : `${v > 0 ? '+' : '−'}${Math.abs(v)}`)}
                />
              </div>
              <div className={styles.adjustRow}>
                <span>Protein anpassen</span>
                <Stepper
                  label="Protein"
                  value={adjust.protein}
                  onChange={(v) => setAdjust({ ...adjust, protein: v })}
                  step={5}
                  min={-40}
                  max={40}
                  format={(v) => (v === 0 ? '±0 g' : `${v > 0 ? '+' : '−'}${Math.abs(v)} g`)}
                />
              </div>
              <p className={styles.explain}>Du kannst deine Ziele jederzeit im Profil ändern.</p>
            </div>
          </>
        )}

        {step === 'creating' && (
          <div className={styles.creating} role="status">
            <div className={styles.spinner} aria-hidden />
            <h1 className={styles.title}>Deine Woche wird erstellt …</h1>
            <p className={styles.text}>Mahlzeiten planen · Portionen anpassen · Einkaufsliste zusammenstellen</p>
          </div>
        )}
      </main>

      {step !== 'creating' && (
        <footer className={styles.footer}>
          {step === 'welcome' && (
            <Button block size="lg" onClick={next}>
              Los geht’s
            </Button>
          )}
          {step === 'goal' && (
            <Button block size="lg" onClick={next}>
              Weiter
            </Button>
          )}
          {step === 'body' && (
            <Button block size="lg" onClick={() => validateBody() && next()}>
              Weiter
            </Button>
          )}
          {step === 'training' && (
            <Button block size="lg" disabled={weekdays.length === 0} onClick={next}>
              {weekdays.length === 0 ? 'Wähle mindestens einen Tag' : 'Weiter'}
            </Button>
          )}
          {step === 'nutrition' && (
            <Button block size="lg" disabled={!waterValid} onClick={next}>
              Weiter
            </Button>
          )}
          {step === 'tastes' && (
            <Button block size="lg" onClick={next}>
              {tastes.favorites.length || tastes.avoided.length ? 'Weiter' : 'Überspringen – Weiter'}
            </Button>
          )}
          {step === 'style' && (
            <Button block size="lg" onClick={next}>
              Weiter
            </Button>
          )}
          {step === 'program' && (
            <Button block size="lg" onClick={next}>
              {program.name} übernehmen
            </Button>
          )}
          {step === 'result' && (
            <Button block size="lg" icon="sparkle" onClick={finish}>
              Meine Woche erstellen
            </Button>
          )}
        </footer>
      )}
    </div>
  );
}

function StepTitle({ title, text }: { title: string; text?: string }) {
  return (
    <div className={styles.stepTitle}>
      <h1 className={styles.title}>{title}</h1>
      {text && <p className={styles.text}>{text}</p>}
    </div>
  );
}

function resultText(goal: GoalType): string {
  if (goal === 'muscle_gain') return 'Ein leichter Überschuss für sauberen Muskelaufbau – mit viel Protein.';
  if (goal === 'fat_loss') return 'Ein moderates Defizit, damit du Fett verlierst und Muskeln behältst.';
  if (goal === 'recomp') return 'Knapp unter deinem Verbrauch und viel Protein – Muskeln kommen aus dem Training, Fett geht langsam.';
  return 'So viel, wie du verbrauchst – mit genug Protein für dein Training.';
}
