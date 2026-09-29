import { useMemo, useState } from 'react';
import { AREA_LABEL, applyAdaptations, DISCOMFORT_NOTE, proposeAdaptations, type AdaptationProposal } from '../../domain/adaptive/sessionAdapt';
import { addDays, today } from '../../domain/dates';
import { estimateMinutes } from '../../domain/training';
import type { BodyArea, Energy, SessionCheckIn, WorkoutTemplate } from '../../domain/types';
import { navigate } from '../../lib/router';
import { showToast } from '../../lib/toast';
import { startWorkoutFrom } from '../../store/actions';
import { useAppState } from '../../store/store';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Controls';
import { Sheet } from '../../components/ui/Sheet';
import styles from './training.module.css';

const AREAS = Object.keys(AREA_LABEL) as BodyArea[];
const ENERGY: Array<{ value: Energy; label: string }> = [
  { value: 'low', label: 'Müde' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'Fit' },
];

/**
 * "Kurzer Check" before a session: time, discomfort, energy. From that and
 * the last session LifeFit proposes changes – each with its reason and
 * [Übernehmen] / [Überspringen]. Nothing changes unless accepted; everything
 * else can still be changed in the session.
 */
export function StartSheet({ template, onClose }: { template: WorkoutTemplate | null; onClose: () => void }) {
  return template ? <StartSheetInner key={template.id} template={template} onClose={onClose} /> : <Sheet open={false} onClose={onClose} title="" children={null} />;
}

function StartSheetInner({ template, onClose }: { template: WorkoutTemplate; onClose: () => void }) {
  const state = useAppState();
  const planned = estimateMinutes(template);
  const [minutes, setMinutes] = useState<number | undefined>(undefined);
  // Discomfort from the feedback of a session in the last 7 days is preselected – visible and removable.
  const carried = useMemo(() => {
    const last = state.workouts.filter((w) => w.status === 'completed' && w.date >= addDays(today(), -7)).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    return last?.feedback?.discomfort ?? [];
  }, []);
  const [areas, setAreas] = useState<BodyArea[]>(carried);
  const [energy, setEnergy] = useState<Energy | undefined>(undefined);
  const [decisions, setDecisions] = useState<Record<string, 'accepted' | 'skipped'>>({});
  const checkIn: SessionCheckIn = { ...(minutes ? { minutes } : {}), ...(areas.length ? { discomfort: areas } : {}), ...(energy ? { energy } : {}) };
  const proposals = useMemo(() => proposeAdaptations(template, checkIn, { history: state.workouts, equipment: state.training?.equipment }), [template, minutes, areas, energy, state.workouts]);
  const accepted = proposals.filter((p) => decisions[p.id] === 'accepted');
  const options = [...new Set([25, 35, 45, 60, 75, planned].filter((m) => m <= planned + 30))].sort((a, b) => a - b);

  const start = () => {
    const adapted = applyAdaptations(template, accepted);
    const id = startWorkoutFrom(adapted, undefined, { checkIn, adaptations: accepted });
    onClose();
    if (id) navigate('session');
    else showToast('Training konnte nicht gestartet werden.', { tone: 'error' });
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={template.name}
      subtitle={`Kurzer Check · geplant ~${planned} min`}
      footer={
        <Button block size="lg" icon="play" onClick={start}>
          {accepted.length ? `Starten · ${accepted.length} ${accepted.length === 1 ? 'Anpassung' : 'Anpassungen'}` : 'Training starten'}
        </Button>
      }
    >
      <div className={styles.menu}>
        <p className={styles.planLabel}>Wie viel Zeit hast du?</p>
        <div className={styles.planDays} role="group" aria-label="Zeit heute">
          {options.map((m) => (
            <Chip key={m} selected={(minutes ?? planned) === m} onClick={() => setMinutes(m === planned ? undefined : m)}>
              {m === planned ? `~${m} min (geplant)` : `${m} min`}
            </Chip>
          ))}
        </div>
        <p className={styles.planLabel}>Beschwerden?</p>
        <div className={styles.planDays} role="group" aria-label="Beschwerden">
          <Chip selected={areas.length === 0} onClick={() => setAreas([])}>
            Keine
          </Chip>
          {AREAS.map((a) => (
            <Chip key={a} selected={areas.includes(a)} onClick={() => setAreas((xs) => (xs.includes(a) ? xs.filter((x) => x !== a) : [...xs, a]))}>
              {AREA_LABEL[a]}
            </Chip>
          ))}
        </div>
        <p className={styles.planLabel}>Wie fühlst du dich?</p>
        <div className={styles.planDays} role="group" aria-label="Energie heute">
          {ENERGY.map((e) => (
            <Chip key={e.value} selected={energy === e.value} onClick={() => setEnergy(energy === e.value ? undefined : e.value)}>
              {e.label}
            </Chip>
          ))}
        </div>

        {proposals.length > 0 && (
          <section className={styles.proposals} aria-label="Vorschläge für heute">
            <p className={styles.planLabel}>Vorschläge für heute</p>
            {proposals.map((p) => (
              <Proposal key={p.id} p={p} decision={decisions[p.id]} onDecide={(d) => setDecisions((x) => ({ ...x, [p.id]: d }))} />
            ))}
          </section>
        )}
        {carried.length > 0 && <p className={styles.note}>Beschwerden vom letzten Training übernommen – tipp auf „Keine“, wenn es wieder passt.</p>}
        {areas.length > 0 && <p className={styles.note}>{DISCOMFORT_NOTE}</p>}
      </div>
    </Sheet>
  );
}

function Proposal({ p, decision, onDecide }: { p: AdaptationProposal; decision?: 'accepted' | 'skipped'; onDecide: (d: 'accepted' | 'skipped') => void }) {
  return (
    <div className={styles.proposal} data-decision={decision ?? 'open'} role="group" aria-label={p.title}>
      <strong>{p.title}</strong>
      <p className={styles.muted}>{p.reason}</p>
      {p.details && p.details.length > 0 && (
        <ul className={styles.proposalDetails}>
          {p.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
      <div className={styles.proposalActions}>
        <Button size="sm" variant={decision === 'accepted' ? 'primary' : 'secondary'} icon={decision === 'accepted' ? 'check' : undefined} aria-pressed={decision === 'accepted'} onClick={() => onDecide('accepted')}>
          Übernehmen
        </Button>
        <Button size="sm" variant="ghost" aria-pressed={decision === 'skipped'} onClick={() => onDecide('skipped')}>
          Überspringen
        </Button>
      </div>
    </div>
  );
}
