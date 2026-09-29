import { AREA_LABEL } from '../../domain/adaptive/sessionAdapt';
import { MUSCLE_FILTERS } from '../../domain/exerciseLibrary';
import { EQUIPMENT_ITEM_LABEL, FOCUS_LABEL, TRAINING_YEARS } from '../../domain/trainingProfile';
import type { BodyArea, EquipmentItem, FreeWeightSkill, MuscleGroup, TrainingFocus } from '../../domain/types';
import { Chip, Segmented } from '../../components/ui/Controls';
import styles from './training.module.css';

/** The editable part of the training profile – the same fields in onboarding and settings. */
export interface TrainingProfileDraft {
  trainingYears: number;
  freeWeights: FreeWeightSkill;
  sessionMinutes?: number;
  focus: TrainingFocus[];
  musclePriorities: MuscleGroup[];
  limitationAreas: BodyArea[];
}

const MINUTES = [30, 45, 60, 75, 90];
const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
/** Priority chips use the library groups; "Beine" stands for the upper legs. */
const PRIORITY_GROUPS: Array<{ id: MuscleGroup; label: string }> = MUSCLE_FILTERS.filter((m) => m.id !== 'cardio').map((m) => ({ id: m.groups[0]!, label: m.label === 'Core' ? 'Bauch' : m.label === 'Po' ? 'Gesäß' : m.label }));

/**
 * Training profile – short answers, all optional except the training age:
 * training age, free-weight skill, time per session, focus (several = a
 * combination), muscle priorities, lasting limitations and (optionally) the
 * single pieces of equipment. The level follows from age and skill.
 */
export function TrainingProfileFields({ value, onChange }: { value: TrainingProfileDraft; onChange: (next: TrainingProfileDraft) => void }) {
  const set = <K extends keyof TrainingProfileDraft>(k: K, v: TrainingProfileDraft[K]) => onChange({ ...value, [k]: v });
  return (
    <div className={styles.profileFields}>
      <p className={styles.planLabel}>Wie lange trainierst du schon regelmäßig Kraft?</p>
      <div className={styles.planDays} role="group" aria-label="Trainingsalter">
        {TRAINING_YEARS.map((y) => (
          <Chip key={y.value} selected={value.trainingYears === y.value} onClick={() => set('trainingYears', y.value)}>
            {y.label}
          </Chip>
        ))}
      </div>
      <Segmented<FreeWeightSkill>
        label="Erfahrung mit freien Gewichten"
        value={value.freeWeights}
        onChange={(v) => set('freeWeights', v)}
        options={[
          { value: 'none', label: 'Keine' },
          { value: 'some', label: 'Etwas' },
          { value: 'confident', label: 'Sicher' },
        ]}
      />
      <p className={styles.planLabel}>Zeit pro Training</p>
      <div className={styles.planDays} role="group" aria-label="Zeit pro Training">
        {MINUTES.map((m) => (
          <Chip key={m} selected={value.sessionMinutes === m} onClick={() => set('sessionMinutes', value.sessionMinutes === m ? undefined : m)}>
            {m} min
          </Chip>
        ))}
      </div>
      <p className={styles.planLabel}>Worauf soll dein Training einzahlen? (mehrere möglich)</p>
      <div className={styles.planDays} role="group" aria-label="Trainingsschwerpunkt">
        {(Object.keys(FOCUS_LABEL) as TrainingFocus[]).map((f) => (
          <Chip key={f} selected={value.focus.includes(f)} onClick={() => set('focus', toggle(value.focus, f).length ? toggle(value.focus, f) : value.focus)}>
            {FOCUS_LABEL[f]}
          </Chip>
        ))}
      </div>
      <p className={styles.planLabel}>Welche Muskelgruppen möchtest du besonders entwickeln? (optional)</p>
      <div className={styles.planDays} role="group" aria-label="Muskelgruppen-Prioritäten">
        {PRIORITY_GROUPS.map((g) => (
          <Chip key={g.id} selected={value.musclePriorities.includes(g.id)} onClick={() => set('musclePriorities', toggle(value.musclePriorities, g.id))}>
            {g.label}
          </Chip>
        ))}
      </div>
      <p className={styles.planLabel}>Dauerhafte Einschränkungen? (optional)</p>
      <div className={styles.planDays} role="group" aria-label="Dauerhafte Einschränkungen">
        {(Object.keys(AREA_LABEL) as BodyArea[]).map((a) => (
          <Chip key={a} selected={value.limitationAreas.includes(a)} onClick={() => set('limitationAreas', toggle(value.limitationAreas, a))}>
            {AREA_LABEL[a]}
          </Chip>
        ))}
      </div>
      {value.limitationAreas.length > 0 && <p className={styles.note}>LifeFit bietet für diese Bereiche Alternativen an – keine Diagnose. Bei Schmerzen lass dich ärztlich oder physiotherapeutisch beraten.</p>}
    </div>
  );
}

/** Single pieces of equipment (starting from the gym / home profile, editable). */
export function EquipmentItemsField({ items, onChange }: { items: EquipmentItem[]; onChange: (next: EquipmentItem[]) => void }) {
  return (
    <>
      <p className={styles.planLabel}>Was hast du zur Verfügung?</p>
      <div className={styles.planDays} role="group" aria-label="Equipment">
        {(Object.keys(EQUIPMENT_ITEM_LABEL) as EquipmentItem[]).map((i) => (
          <Chip key={i} selected={items.includes(i)} onClick={() => onChange(toggle(items, i))}>
            {EQUIPMENT_ITEM_LABEL[i]}
          </Chip>
        ))}
      </div>
    </>
  );
}
