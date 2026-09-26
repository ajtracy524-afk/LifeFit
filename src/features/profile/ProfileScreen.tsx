import { useState, type ReactNode } from 'react';
import { PROGRAMS, getProgram } from '../../data/exercises';
import { today, weekStart } from '../../domain/dates';
import { calculateTargets } from '../../domain/nutrition';
import { currentWeight } from '../../domain/progress';
import { slotsFor } from '../../domain/planner';
import type { ActivityLevel, Allergen, DietType, GoalType, Macros, PlanPriority } from '../../domain/types';
import { getFood } from '../../data/foods';
import { learnedInsights } from '../../domain/explain';
import { trainingTimeFor } from '../../domain/schedule';
import { fmt, SLOT_LABEL, weekdayShort } from '../../lib/format';
import { applyWithUndo, withUndo } from '../../lib/undo';
import { navigate, useRoute } from '../../lib/router';
import { showToast } from '../../lib/toast';
import {
  exportData,
  removeFuturePlannedMeals,
  resetLearning,
  setTargets,
  suggestMealsForWeek,
  updateGoal,
  updateNutritionProfile,
  updatePlannerSettings,
  updateProfile,
  updateTraining,
} from '../../store/actions';
import { resetAll, useAppState } from '../../store/store';
import { Screen, Section } from '../../components/Screen';
import { Button, IconButton } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Chip, Field, OptionCard, Segmented, Stepper, WeekdayPicker, parseNumber } from '../../components/ui/Controls';
import { Icon, type IconName } from '../../components/ui/Icon';
import { Sheet } from '../../components/ui/Sheet';
import styles from './profile.module.css';

type Panel = 'goal' | 'nutrition' | 'training' | 'body' | 'budget' | 'schedule' | 'reset' | null;

const PRIORITY_LABEL: Record<PlanPriority, string> = { save: 'Sparen', balanced: 'Ausgewogen', protein: 'Protein', health: 'Gesundheit' };
const PRIORITY_HINT: Record<PlanPriority, string> = {
  save: 'Günstigere Wochen, Kalorien und Protein bleiben erfüllt.',
  balanced: 'Ernährung, Kosten und deine Vorlieben gleich gewichtet.',
  protein: 'Mehr Protein, besonders nach dem Training.',
  health: 'Mehr Ballaststoffe (Gemüse, Hülsenfrüchte, Vollkorn).',
};

const GOAL_LABEL: Record<GoalType, string> = { muscle_gain: 'Muskelaufbau', fat_loss: 'Fett verlieren', maintain: 'Fit bleiben' };
const DIET_LABEL: Record<DietType, string> = { omnivore: 'Alles', vegetarian: 'Vegetarisch', vegan: 'Vegan' };
const ALLERGENS: [Allergen, string][] = [
  ['lactose', 'Laktose'],
  ['gluten', 'Gluten'],
  ['nuts', 'Nüsse'],
  ['fish', 'Fisch'],
];

export function ProfileScreen() {
  const state = useAppState();
  const { params } = useRoute();
  const [panel, setPanel] = useState<Panel>((params.get('section') as Panel) ?? null);
  const close = () => setPanel(null);

  const { profile, goal, nutritionProfile, training } = state;
  if (!profile || !goal || !nutritionProfile || !training) return null;
  const target = [...state.targets].sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
  const program = getProgram(training.programId);
  const insights = learnedInsights(state);
  const disliked = (nutritionProfile.dislikedFoods ?? []).map((id) => getFood(id)).filter((f): f is NonNullable<typeof f> => !!f);

  const download = () => {
    try {
      const blob = new Blob([exportData()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lifefit-export-${today()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      showToast('Export ist gerade nicht möglich.', { tone: 'error' });
    }
  };

  return (
    <Screen title="Profil" actions={<IconButton icon="close" label="Schließen" onClick={() => navigate('today')} />}>
      <Card className={styles.hero}>
        <span className={styles.avatar}>{profile.name?.[0]?.toUpperCase() ?? <Icon name="user" />}</span>
        <div>
          <strong className={styles.name}>{profile.name || 'Dein Profil'}</strong>
          <p className={styles.muted}>
            {GOAL_LABEL[goal.type]} · {target ? fmt.kcal(target.kcal) : '–'}
          </p>
        </div>
      </Card>

      <Section title="Mein Plan">
        <Card padded={false}>
          <Row icon="flame" label="Ziel & Kalorien" value={`${GOAL_LABEL[goal.type]} · ${target ? `${fmt.int(target.kcal)} kcal · ${target.protein} g P` : ''}`} onClick={() => setPanel('goal')} />
          <Row
            icon="food"
            label="Ernährung"
            value={[DIET_LABEL[nutritionProfile.diet], ...nutritionProfile.excluded.map((a) => `ohne ${ALLERGENS.find(([id]) => id === a)?.[1]}`), `${nutritionProfile.slots.length} Mahlzeiten`].join(' · ')}
            onClick={() => setPanel('nutrition')}
          />
          <Row icon="dumbbell" label="Training" value={`${program?.name ?? '–'} · ${training.weekdays.map(weekdayShort).join(', ')}`} onClick={() => setPanel('training')} />
          <Row icon="user" label="Körperdaten" value={`${profile.age} Jahre · ${profile.heightCm} cm`} onClick={() => setPanel('body')} />
          <Row
            icon="cart"
            label="Budget & Schwerpunkt"
            value={`${PRIORITY_LABEL[state.plannerSettings.priority]}${state.plannerSettings.weeklyBudgetEur ? ` · ${state.plannerSettings.weeklyBudgetEur} € pro Woche` : ' · kein Budget'}`}
            onClick={() => setPanel('budget')}
          />
          <Row
            icon="clock"
            label="Tagesablauf"
            value={`Frühstück ${state.plannerSettings.mealTimes.breakfast} · Training ${trainingTimeFor(state).time}`}
            onClick={() => setPanel('schedule')}
          />
        </Card>
      </Section>

      <Section title="Was LifeFit gelernt hat">
        <Card>
          {insights.length > 0 ? (
            <ul className={styles.insights}>
              {insights.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>Noch nichts. LifeFit lernt aus dem, was du isst, tauschst, überspringst und trainierst – langsam und nur aus echtem Verhalten.</p>
          )}
          {disliked.length > 0 && (
            <div className={styles.dislikes}>
              <p className={styles.muted}>Wird nie eingeplant (von dir festgelegt):</p>
              <div className={styles.chips}>
                {disliked.map((f) => (
                  <Chip key={f.id} selected onClick={() => applyWithUndo({ type: 'setDislike', foodId: f.id, disliked: false })}>
                    {f.name}
                  </Chip>
                ))}
              </div>
            </div>
          )}
          {Object.keys(state.learning.preferences).length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => withUndo('Gelerntes zurückgesetzt', resetLearning)}>
              Gelerntes zurücksetzen
            </Button>
          )}
        </Card>
        <p className={styles.note}>Alles Gelernte bleibt auf diesem Gerät. Keine KI, keine Übertragung – nur gezähltes Verhalten.</p>
      </Section>

      <Section title="Daten & Datenschutz">
        <Card padded={false}>
          <Row icon="download" label="Daten exportieren" value="Alle Einträge als JSON-Datei" onClick={download} />
          <Row icon="trash" label="Alle Daten löschen" value="App zurücksetzen" onClick={() => setPanel('reset')} danger />
        </Card>
        <p className={styles.note}>🔒 Deine Daten werden ausschließlich auf diesem Gerät gespeichert. Es gibt kein Konto und keine Übertragung an Server.</p>
      </Section>

      <p className={styles.version}>LifeFit · Version 0.1 (MVP)</p>

      <GoalSheet open={panel === 'goal'} onClose={close} />
      <NutritionSheet open={panel === 'nutrition'} onClose={close} />
      <TrainingSheet open={panel === 'training'} onClose={close} />
      <BodySheet open={panel === 'body'} onClose={close} />
      <BudgetSheet open={panel === 'budget'} onClose={close} />
      <ScheduleSheet open={panel === 'schedule'} onClose={close} />
      <ResetSheet open={panel === 'reset'} onClose={close} />
    </Screen>
  );
}

function BudgetSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const state = useAppState();
  const [budget, setBudget] = useState(state.plannerSettings.weeklyBudgetEur ? String(state.plannerSettings.weeklyBudgetEur) : '');
  const [priority, setPriority] = useState<PlanPriority>(state.plannerSettings.priority);
  const value = parseNumber(budget);
  const valid = budget.trim() === '' || (Number.isFinite(value) && value >= 10 && value <= 1000);
  const save = () => {
    updatePlannerSettings({ priority, weeklyBudgetEur: budget.trim() === '' ? undefined : Math.round(value) });
    showToast('Gespeichert – gilt für die nächste Planung');
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Budget & Schwerpunkt" subtitle="Kosten sind Schätzungen, keine Supermarktpreise.">
      <SheetForm>
        <Field
          label="Wochenbudget für Lebensmittel"
          inputMode="numeric"
          suffix="€"
          placeholder="kein Budget"
          value={budget}
          error={valid ? undefined : 'Bitte einen Betrag zwischen 10 und 1000 € angeben.'}
          onChange={(e) => setBudget(e.target.value)}
        />
        <Segmented<PlanPriority>
          label="Schwerpunkt"
          value={priority}
          onChange={setPriority}
          options={(['save', 'balanced', 'protein', 'health'] as PlanPriority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
        />
        <p className={styles.muted}>{PRIORITY_HINT[priority]}</p>
        <Button block disabled={!valid} onClick={save}>
          Speichern
        </Button>
      </SheetForm>
    </Sheet>
  );
}

function ScheduleSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const state = useAppState();
  const slots = state.nutritionProfile?.slots ?? [];
  const [times, setTimes] = useState(state.plannerSettings.mealTimes);
  const training = trainingTimeFor(state);
  const [trainingTime, setTrainingTime] = useState(state.plannerSettings.trainingTime ?? '');
  const save = () => {
    updatePlannerSettings({ mealTimes: times, trainingTime: trainingTime || undefined });
    showToast('Tagesablauf gespeichert');
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Tagesablauf" subtitle="Für „Dein Plan“ und die Mahlzeit nach dem Training.">
      <SheetForm>
        {slots.map((slot) => (
          <Field key={slot} label={SLOT_LABEL[slot]} type="time" value={times[slot]} onChange={(e) => setTimes({ ...times, [slot]: e.target.value || times[slot] })} />
        ))}
        <Field
          label="Training"
          type="time"
          value={trainingTime}
          hint={training.source === 'learned' && !trainingTime ? `Gelernt: meist ${training.time}` : training.source === 'default' && !trainingTime ? `Ohne Angabe: ${training.time}` : undefined}
          onChange={(e) => setTrainingTime(e.target.value)}
        />
        <Button block onClick={save}>
          Speichern
        </Button>
      </SheetForm>
    </Sheet>
  );
}

function Row({ icon, label, value, onClick, danger }: { icon: IconName; label: string; value?: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" className={styles.row} onClick={onClick}>
      <span className={danger ? styles.rowIconDanger : styles.rowIcon}>
        <Icon name={icon} size={18} />
      </span>
      <span className={styles.rowText}>
        <strong className={danger ? styles.danger : undefined}>{label}</strong>
        {value && <span>{value}</span>}
      </span>
      <Icon name="chevronRight" size={18} className={styles.chevron} />
    </button>
  );
}

function SheetForm({ children }: { children: ReactNode }) {
  return <div className={styles.form}>{children}</div>;
}

// ---------------------------------------------------------------------------

function GoalSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const state = useAppState();
  return (
    <Sheet open={open} onClose={onClose} title="Ziel & Kalorien" subtitle="Änderungen gelten ab heute">
      {open && state.goal && <GoalForm onDone={onClose} />}
    </Sheet>
  );
}

function GoalForm({ onDone }: { onDone: () => void }) {
  const state = useAppState();
  const goal = state.goal!;
  const current = [...state.targets].sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0]!;
  const [type, setType] = useState<GoalType>(goal.type);
  const [targetWeight, setTargetWeight] = useState(goal.targetWeightKg ? String(goal.targetWeightKg).replace('.', ',') : '');
  const [macros, setMacros] = useState<Macros>({ kcal: current.kcal, protein: current.protein, carbs: current.carbs, fat: current.fat });
  const [method, setMethod] = useState<'formula' | 'manual'>(current.method);
  const [error, setError] = useState<string | null>(null);

  const recalc = (goalType: GoalType) => {
    if (!state.profile || !state.training) return;
    const weight = currentWeight(state.weights) ?? goal.startWeightKg;
    const c = calculateTargets(state.profile, goalType, weight, state.training.weekdays.length);
    setMacros({ kcal: c.kcal, protein: c.protein, carbs: c.carbs, fat: c.fat });
    setMethod('formula');
  };

  const setKcal = (kcal: number) => {
    setMacros((m) => ({ ...m, kcal, carbs: Math.max(0, Math.round((kcal - m.protein * 4 - m.fat * 9) / 4)) }));
    setMethod('manual');
  };
  const setProtein = (protein: number) => {
    setMacros((m) => ({ ...m, protein, carbs: Math.max(0, Math.round((m.kcal - protein * 4 - m.fat * 9) / 4)) }));
    setMethod('manual');
  };

  const save = () => {
    const tw = targetWeight ? parseNumber(targetWeight) : undefined;
    if (tw !== undefined && (!Number.isFinite(tw) || tw < 30 || tw > 300)) {
      setError('Bitte prüfe dein Zielgewicht.');
      return;
    }
    const goalChanged = type !== goal.type;
    updateGoal({
      type,
      targetWeightKg: type === 'maintain' ? undefined : tw,
      // A new goal starts from today's weight.
      ...(goalChanged ? { startWeightKg: currentWeight(state.weights) ?? goal.startWeightKg, startedAt: today() } : {}),
    });
    setTargets(macros, method);
    showToast('Ziele gespeichert');
    onDone();
  };

  return (
    <SheetForm>
      <Segmented
        label="Ziel"
        value={type}
        onChange={(t) => {
          setType(t);
          recalc(t);
        }}
        options={[
          { value: 'muscle_gain', label: 'Aufbau' },
          { value: 'fat_loss', label: 'Abnehmen' },
          { value: 'maintain', label: 'Halten' },
        ]}
      />
      {type !== 'maintain' && (
        <Field
          label="Zielgewicht"
          inputMode="decimal"
          suffix="kg"
          placeholder="optional"
          value={targetWeight}
          error={error ?? undefined}
          onChange={(e) => {
            setTargetWeight(e.target.value);
            setError(null);
          }}
        />
      )}
      <div className={styles.stepRow}>
        <span>Kalorien</span>
        <Stepper label="Kalorien" value={macros.kcal} onChange={setKcal} step={50} min={1200} max={5000} format={(v) => `${fmt.int(v)} kcal`} />
      </div>
      <div className={styles.stepRow}>
        <span>Protein</span>
        <Stepper label="Protein" value={macros.protein} onChange={setProtein} step={5} min={40} max={300} format={(v) => `${v} g`} />
      </div>
      <p className={styles.muted}>
        Kohlenhydrate {macros.carbs} g · Fett {macros.fat} g
      </p>
      <Button variant="secondary" icon="sparkle" onClick={() => recalc(type)}>
        Mit aktuellem Gewicht neu berechnen
      </Button>
      <Button block size="lg" onClick={save}>
        Speichern
      </Button>
    </SheetForm>
  );
}

// ---------------------------------------------------------------------------

function NutritionSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Ernährung">
      {open && <NutritionForm onDone={onClose} />}
    </Sheet>
  );
}

function NutritionForm({ onDone }: { onDone: () => void }) {
  const state = useAppState();
  const np = state.nutritionProfile!;
  const [diet, setDiet] = useState<DietType>(np.diet);
  const [excluded, setExcluded] = useState<Allergen[]>(np.excluded);
  const [meals, setMeals] = useState<'3' | '4'>(np.slots.length === 3 ? '3' : '4');

  const save = (replan: boolean) => {
    updateNutritionProfile({ diet, excluded, slots: slotsFor(meals === '3' ? 3 : 4) });
    if (replan) {
      removeFuturePlannedMeals();
      const added = suggestMealsForWeek(weekStart(today()));
      showToast(`Gespeichert – ${added} Mahlzeiten neu geplant`);
    } else {
      showToast('Gespeichert – gilt für neue Vorschläge');
    }
    onDone();
  };

  return (
    <SheetForm>
      <OptionCard emoji="🍗" title="Alles" selected={diet === 'omnivore'} onClick={() => setDiet('omnivore')} />
      <OptionCard emoji="🥚" title="Vegetarisch" selected={diet === 'vegetarian'} onClick={() => setDiet('vegetarian')} />
      <OptionCard emoji="🌱" title="Vegan" selected={diet === 'vegan'} onClick={() => setDiet('vegan')} />
      <p className={styles.label}>Ohne</p>
      <div className={styles.chips}>
        {ALLERGENS.map(([id, label]) => (
          <Chip key={id} selected={excluded.includes(id)} onClick={() => setExcluded(excluded.includes(id) ? excluded.filter((a) => a !== id) : [...excluded, id])}>
            {label}
          </Chip>
        ))}
      </div>
      <Segmented
        label="Mahlzeiten pro Tag"
        value={meals}
        onChange={setMeals}
        options={[
          { value: '3', label: '3 Mahlzeiten' },
          { value: '4', label: '3 + Snack' },
        ]}
      />
      <Button block size="lg" onClick={() => save(true)}>
        Speichern & Woche neu planen
      </Button>
      <Button block variant="ghost" onClick={() => save(false)}>
        Nur speichern
      </Button>
    </SheetForm>
  );
}

// ---------------------------------------------------------------------------

function TrainingSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Training" subtitle="Programm und Trainingstage">
      {open && <TrainingForm onDone={onClose} />}
    </Sheet>
  );
}

function TrainingForm({ onDone }: { onDone: () => void }) {
  const state = useAppState();
  const current = state.training ?? { programId: 'full-body', weekdays: [0, 2, 4] };
  const [programId, setProgramId] = useState(current.programId);
  const [weekdays, setWeekdays] = useState<number[]>(current.weekdays);

  return (
    <SheetForm>
      {PROGRAMS.map((p) => (
        <OptionCard key={p.id} title={p.name} description={p.description} selected={programId === p.id} onClick={() => setProgramId(p.id)} />
      ))}
      <p className={styles.label}>Trainingstage</p>
      <WeekdayPicker value={weekdays} onChange={setWeekdays} />
      <Button
        block
        size="lg"
        disabled={weekdays.length === 0}
        onClick={() => {
          updateTraining({ programId, weekdays });
          showToast('Trainingsplan aktualisiert');
          onDone();
        }}
      >
        {weekdays.length === 0 ? 'Wähle mindestens einen Tag' : 'Speichern'}
      </Button>
    </SheetForm>
  );
}

// ---------------------------------------------------------------------------

function BodySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Körperdaten" subtitle="Dein Gewicht trägst du unter Fortschritt ein">
      {open && <BodyForm onDone={onClose} />}
    </Sheet>
  );
}

function BodyForm({ onDone }: { onDone: () => void }) {
  const profile = useAppState().profile!;
  const [name, setName] = useState(profile.name);
  const [age, setAge] = useState(String(profile.age));
  const [height, setHeight] = useState(String(profile.heightCm));
  const [activity, setActivity] = useState<ActivityLevel>(profile.activity);
  const [errors, setErrors] = useState<{ age?: string; height?: string }>({});

  const save = () => {
    const a = parseNumber(age);
    const h = parseNumber(height);
    const e: typeof errors = {};
    if (!Number.isFinite(a) || a < 14 || a > 100) e.age = 'Alter zwischen 14 und 100';
    if (!Number.isFinite(h) || h < 120 || h > 230) e.height = 'Größe zwischen 120 und 230 cm';
    setErrors(e);
    if (Object.keys(e).length) return;
    updateProfile({ name: name.trim(), age: a, heightCm: h, activity });
    showToast('Gespeichert. Tipp: Unter „Ziel & Kalorien“ kannst du neu berechnen.');
    onDone();
  };

  return (
    <SheetForm>
      <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <div className={styles.fieldRow}>
        <Field label="Alter" inputMode="numeric" suffix="Jahre" value={age} error={errors.age} onChange={(e) => setAge(e.target.value)} />
        <Field label="Größe" inputMode="numeric" suffix="cm" value={height} error={errors.height} onChange={(e) => setHeight(e.target.value)} />
      </div>
      <p className={styles.label}>Aktivität im Alltag</p>
      <Segmented
        label="Aktivität"
        value={activity}
        onChange={setActivity}
        options={[
          { value: 'sedentary', label: 'Sitzend' },
          { value: 'light', label: 'Leicht' },
          { value: 'moderate', label: 'Aktiv' },
          { value: 'active', label: 'Sehr' },
        ]}
      />
      <Button block size="lg" onClick={save}>
        Speichern
      </Button>
    </SheetForm>
  );
}

// ---------------------------------------------------------------------------

function ResetSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [confirm, setConfirm] = useState('');
  const ok = confirm.trim().toLowerCase() === 'löschen';
  return (
    <Sheet
      open={open}
      onClose={() => {
        setConfirm('');
        onClose();
      }}
      title="Alle Daten löschen?"
      subtitle="Plan, Tracking, Trainings und Gewicht werden unwiderruflich entfernt."
    >
      <SheetForm>
        <p className={styles.muted}>Tipp: Exportiere deine Daten vorher. Zum Bestätigen tippe „löschen“.</p>
        <Field label="Bestätigung" placeholder="löschen" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
        <Button
          block
          variant="danger"
          disabled={!ok}
          onClick={() => {
            resetAll();
            navigate('today', undefined, { replace: true });
          }}
        >
          Endgültig löschen
        </Button>
      </SheetForm>
    </Sheet>
  );
}
