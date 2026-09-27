import { useState } from 'react';
import { builtInTemplates, personalPrograms } from '../../data/exercises';
import { today } from '../../domain/dates';
import { programPreview, programsFor, programWeek, recommendationReason, recommendProgram } from '../../domain/programs';
import type { TrainingEquipment, WorkoutProgram } from '../../domain/types';
import { weekdayShort } from '../../lib/format';
import { navigate } from '../../lib/router';
import { showToast } from '../../lib/toast';
import { deleteProgram, saveProgram, updateTraining } from '../../store/actions';
import { useAppState } from '../../store/store';
import { Screen, Section } from '../../components/Screen';
import { Button, IconButton } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field, Segmented } from '../../components/ui/Controls';
import { EmptyState } from '../../components/ui/Feedback';
import { Sheet } from '../../components/ui/Sheet';
import styles from './training.module.css';

/**
 * Programs: a program is a rotation of routines over the training days, with
 * a planned duration. The plan (this screen, the week) and what was really
 * trained (history) stay separate – switching the program never touches
 * completed workouts.
 */
export function ProgramsScreen() {
  const state = useAppState();
  const setup = state.training;
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  if (!setup) {
    return (
      <Screen title="Programme">
        <EmptyState icon="dumbbell" title="Noch kein Trainingsplan" text="Wähle zuerst deine Trainingstage." action={<Button onClick={() => navigate('profile', { section: 'training' })}>Trainingstage wählen</Button>} />
      </Screen>
    );
  }
  const equipment = setup.equipment ?? 'gym';
  const fit = { days: setup.weekdays.length, experience: state.profile?.experience ?? 'beginner', goal: state.goal?.type, equipment } as const;
  const recommended = recommendProgram(fit);
  const programs: WorkoutProgram[] = [...programsFor(equipment), ...personalPrograms()];
  const week = programWeek(setup, today());

  const choose = (p: WorkoutProgram) => {
    updateTraining({ ...setup, programId: p.id, startedAt: undefined });
    showToast(`${p.name} ist jetzt dein Programm`);
  };

  return (
    <Screen title="Programme" eyebrow="Training" actions={<IconButton icon="close" label="Zurück zum Training" onClick={() => navigate('training')} />}>
      <Segmented<TrainingEquipment>
        label="Wo trainierst du?"
        value={equipment}
        onChange={(v) => updateTraining({ ...setup, equipment: v, startedAt: setup.startedAt })}
        options={[
          { value: 'gym', label: 'Studio' },
          { value: 'home', label: 'Zuhause (KH)' },
          { value: 'bodyweight', label: 'Ohne Geräte' },
        ]}
      />
      <p className={styles.muted}>
        {setup.weekdays.length} Trainingstage · {fit.experience === 'beginner' ? 'Einsteiger' : 'Fortgeschritten'}. Empfohlen: {recommendationReason(fit)}
      </p>

      {programs.map((p) => {
        const active = p.id === setup.programId;
        const expanded = open === p.id || active;
        return (
          <Card key={p.id} tone={active ? 'accent' : undefined} aria-label={p.name}>
            <div className={styles.programHead}>
              <div className={styles.exerciseHeading}>
                <div className={styles.badges}>
                  {active && <span className={styles.badge}>Aktiv{week && active ? ` · Woche ${Math.min(week.week, week.of)} von ${week.of}` : ''}</span>}
                  {p.id === recommended && <span className={styles.badge}>Empfohlen</span>}
                </div>
                <h2 className={styles.cardTitle}>{p.name}</h2>
                <p className={styles.muted}>
                  {p.templates.length} {p.templates.length === 1 ? 'Einheit' : 'Einheiten'} im Wechsel{p.weeks ? ` · ${p.weeks} Wochen` : ''}
                </p>
              </div>
              {!active && <IconButton icon="chevronDown" label={expanded ? 'Weniger' : 'Wochenplan zeigen'} className={expanded ? styles.up : undefined} onClick={() => setOpen(expanded ? null : p.id)} />}
            </div>
            <p className={styles.programText}>{p.description}</p>
            {expanded && (
              <ul className={styles.previewWeeks}>
                {programPreview(p.id, setup.weekdays, today()).map((w) => (
                  <li key={w.week}>
                    <strong>Woche {w.week}</strong>
                    <span>{w.days.map((d) => `${weekdayShort(d.weekday)} ${d.name}`).join(' · ') || '–'}</span>
                  </li>
                ))}
              </ul>
            )}
            {!active && expanded && (
              <div className={styles.planActions}>
                <Button block onClick={() => choose(p)}>
                  Dieses Programm wählen
                </Button>
                {p.id.startsWith('program:') && (
                  <Button variant="ghost" block icon="trash" onClick={() => deleteProgram(p.id) && showToast('Programm gelöscht')}>
                    Programm löschen
                  </Button>
                )}
              </div>
            )}
          </Card>
        );
      })}

      <Section title="Eigenes Programm">
        <Card>
          <p className={styles.muted}>Stell Routinen zusammen, die sich an deinen Trainingstagen abwechseln – deine eigenen oder die fertigen Einheiten.</p>
          <Button variant="secondary" icon="plus" onClick={() => setCreating(true)}>
            Programm erstellen
          </Button>
        </Card>
      </Section>
      <ProgramSheet open={creating} onClose={() => setCreating(false)} />
    </Screen>
  );
}

function ProgramSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const state = useAppState();
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [weeks, setWeeks] = useState('');
  const options = [...Object.values(state.routines), ...builtInTemplates()];
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const valid = name.trim() && picked.length > 0;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Programm erstellen"
      subtitle="Die Reihenfolge der Auswahl ist die Reihenfolge im Wechsel."
      footer={
        <Button
          block
          disabled={!valid}
          onClick={() => {
            const id = saveProgram({ name, routineIds: picked, weeks: Number(weeks) || undefined });
            if (!id) return;
            showToast('Programm erstellt – du findest es in der Liste');
            setName('');
            setPicked([]);
            setWeeks('');
            onClose();
          }}
        >
          Speichern
        </Button>
      }
    >
      <div className={styles.menu}>
        <Field label="Name" value={name} placeholder="z. B. Mein Push / Pull" onChange={(e) => setName(e.target.value)} />
        <Field label="Dauer in Wochen (optional)" inputMode="numeric" value={weeks} onChange={(e) => setWeeks(e.target.value.replace(/\D/g, '').slice(0, 2))} />
        <p className={styles.planLabel}>Routinen</p>
        {options.map((t) => {
          const n = picked.indexOf(t.id);
          return (
            <button key={t.id} type="button" className={n >= 0 ? styles.typeOptionActive : styles.typeOption} aria-pressed={n >= 0} onClick={() => toggle(t.id)}>
              <span className={styles.typeBadge}>{n >= 0 ? n + 1 : ''}</span>
              {t.name}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
