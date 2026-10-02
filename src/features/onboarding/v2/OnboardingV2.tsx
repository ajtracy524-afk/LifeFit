import { useEffect, useRef, useState } from 'react';
import {
  answersOf,
  back,
  canGoBack,
  flowStateOf,
  initialState,
  jumpTo,
  next,
  SECTION_LABEL,
  sectionProgress,
  SECTIONS,
  skipSection,
  skipStep,
  stepDef,
  stepsFor,
  type FlowResult,
} from '../../../domain/onboarding/flow';
import type { Field, OnboardingMode, OnboardingProfile, OnboardingStepId } from '../../../domain/onboarding/types';
import { navigate } from '../../../lib/router';
import { showToast } from '../../../lib/toast';
import { closeOnboardingSection, finishOnboarding, pauseOnboarding, saveOnboardingFlow } from '../../../store/onboardingActions';
import { useAppState } from '../../../store/store';
import { Button, IconButton } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { OptionCard } from '../../../components/ui/Controls';
import { AREA_A_STEPS, AreaAStep } from './AreaA';
import { AREA_B_STEPS, AreaBStep } from './AreaB';
import { AREA_C_STEPS, AreaCStep } from './AreaC';
import styles from './onboardingV2.module.css';

/**
 * The new onboarding (behind `?onboarding=v2` until Prompt 9). Prompt 1 is the
 * frame: sections A/B/C with progress, "Warum fragen wir das?", Weiter /
 * Überspringen, resume and re-open per section. The steps are placeholders
 * that show the answers already known (pre-filled when re-opened).
 */
export function OnboardingV2() {
  const state = useAppState();
  const profile = state.onboarding;
  const answers = answersOf(profile);
  const flow = flowStateOf(profile);
  const def = stepDef(flow.step);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [mode, setMode] = useState<OnboardingMode>(profile?.mode ?? 'full');

  // Focus follows the step (screen readers announce the new title).
  useEffect(() => titleRef.current?.focus({ preventScroll: true }), [flow.step]);

  const finish = () => {
    if (flow.scope) {
      closeOnboardingSection(flow.scope);
      navigate('profile');
      showToast(`${SECTION_LABEL[flow.scope]}: gespeichert`);
      return;
    }
    finishOnboarding();
    navigate('today', undefined, { replace: true });
    showToast('Deine Woche steht – Angaben kannst du jederzeit im Profil ergänzen.');
  };
  const go = (result: FlowResult) => (result.done ? finish() : saveOnboardingFlow(result.state));

  const isWelcome = flow.step === 'welcome';
  const isSummary = flow.step === 'summary';
  const inSection = def.section === 'A' || def.section === 'B' || def.section === 'C';
  const lastOfScope = !!flow.scope && next(flow, answers).done;

  const isAnalysis = flow.step === 'analysis';
  const onNext = () => (isWelcome ? go(next({ ...initialState(mode) }, answers)) : go(next(flow, answers)));
  // The analysis is no question: "Überspringen" there skips the body fat estimate that follows.
  const onSkip = () => {
    if (isWelcome) return finish();
    if (isAnalysis) {
      const toBodyFat = next(flow, answers);
      return go(toBodyFat.done ? toBodyFat : skipStep(toBodyFat.state, answers));
    }
    go(skipStep(flow, answers));
  };
  const later = () => {
    if (flow.scope) return finish();
    pauseOnboarding();
    navigate('today', undefined, { replace: true });
    showToast('Gespeichert – im Profil kannst du später weitermachen.');
  };

  const progress = sectionProgress(flow, answers);

  return (
    <div className={styles.shell}>
      <header className={styles.top}>
        <IconButton icon="chevronLeft" label="Zurück" onClick={() => saveOnboardingFlow(back(flow, answers))} disabled={!canGoBack(flow, answers)} />
        <ol className={styles.segments} aria-label="Fortschritt">
          {progress.map((p) => (
            <li
              key={p.section}
              className={styles.segment}
              data-current={p.current || undefined}
              data-scope={flow.scope === p.section || undefined}
              aria-label={`${SECTION_LABEL[p.section]}: ${p.total ? `${p.done} von ${p.total} Schritten` : 'im Schnellstart mit Standardwerten'}`}
            >
              <span className={styles.segmentBar}>
                <span style={{ width: `${p.total ? (p.done / p.total) * 100 : isSummary ? 100 : 0}%` }} />
              </span>
              <span className={styles.segmentLabel}>{SECTION_LABEL[p.section]}</span>
            </li>
          ))}
        </ol>
        <Button variant="ghost" size="sm" onClick={later}>
          {flow.scope ? 'Schließen' : 'Später fortsetzen'}
        </Button>
      </header>

      <main className={styles.content}>
        <div key={flow.step} className={styles.step}>
          {inSection && <p className={styles.eyebrow}>{SECTION_LABEL[def.section as 'A']}</p>}
          <h1 ref={titleRef} tabIndex={-1} className={styles.title}>
            {def.title}
          </h1>
          <p className={styles.why}>
            <strong>Warum fragen wir das?</strong> {def.why}
          </p>

          {isWelcome && (
            <div className={styles.stack} role="group" aria-label="Wie ausführlich?">
              <OptionCard emoji="⚡" title="Schnellstart (ca. 1 Minute)" description="Gewicht, Größe, Geburtsjahr, Geschlecht, Ziel und Trainingstage. Alles andere ergänzt du später." selected={mode === 'quick'} onClick={() => setMode('quick')} />
              <OptionCard emoji="🧭" title="Ausführlich (ca. 5 Minuten)" description="Körper & Ziel, Essen & Einkauf, Training – für einen Plan, der genau passt." selected={mode === 'full'} onClick={() => setMode('full')} />
            </div>
          )}

          {AREA_A_STEPS.includes(flow.step) ? (
            <AreaAStep step={flow.step} />
          ) : AREA_B_STEPS.includes(flow.step) ? (
            <AreaBStep step={flow.step} />
          ) : AREA_C_STEPS.includes(flow.step) ? (
            <AreaCStep step={flow.step} />
          ) : (
            !isWelcome && !isSummary && <Placeholder step={flow.step} profile={profile} />
          )}

          {isSummary && (
            <div className={styles.stack}>
              {SECTIONS.map((section) => {
                const steps = stepsFor(flow.mode, answers).filter((s) => s.section === section);
                const skipped = steps.filter((s) => flow.skipped.includes(s.id)).length;
                return (
                  <Card key={section} className={styles.summaryRow}>
                    <div>
                      <strong>{SECTION_LABEL[section]}</strong>
                      <p className={styles.hint}>
                        {steps.length === 0 ? 'Standardwerte – im Profil ergänzen' : skipped ? `${skipped} von ${steps.length} übersprungen – Standardwerte` : `${steps.length} ${steps.length === 1 ? 'Schritt' : 'Schritte'} beantwortet`}
                      </p>
                    </div>
                    {steps[0] && (
                      <Button variant="secondary" size="sm" onClick={() => saveOnboardingFlow(jumpTo(flow, steps[0]!.id, answers))}>
                        Ändern
                      </Button>
                    )}
                  </Card>
                );
              })}
              <p className={styles.hint}>LifeFit ersetzt keine ärztliche oder ernährungswissenschaftliche Beratung.</p>
            </div>
          )}
        </div>
      </main>

      <footer className={styles.footer}>
        <Button block size="lg" onClick={onNext}>
          {isSummary ? 'Los geht’s' : isAnalysis ? 'Körperfett ergänzen (empfohlen)' : lastOfScope ? 'Fertig' : 'Weiter'}
        </Button>
        <div className={styles.secondary}>
          <Button variant="secondary" onClick={onSkip}>
            {isWelcome ? 'Ohne Angaben starten' : isSummary ? 'Später ergänzen' : 'Überspringen'}
          </Button>
          {inSection && !flow.scope && (
            <Button variant="ghost" onClick={() => go(skipSection(flow, answers))}>
              Bereich überspringen
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}

/** Which stored answers belong to a step – shown read-only until the step gets its content (Prompts 2–8). */
const STEP_FIELDS: Partial<Record<OnboardingStepId, Array<[keyof OnboardingProfile, string, string]>>> = {
  plan: [['training', 'plan', 'Programm']],
};

const SOURCE_LABEL: Record<Field<unknown>['source'], string> = {
  user: 'eingegeben',
  estimated: 'geschätzt',
  default: 'Standardwert',
  migrated: 'bitte bestätigen',
};

function format(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.join(', ') : '–';
  if (value && typeof value === 'object') return Object.entries(value).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('–') : String(v)}`).join(' · ');
  if (typeof value === 'boolean') return value ? 'ja' : 'nein';
  return String(value);
}

function Placeholder({ step, profile }: { step: OnboardingStepId; profile: OnboardingProfile | undefined }) {
  const fields = (STEP_FIELDS[step] ?? []).map(([group, key, label]) => {
    const f = (profile?.[group] as Record<string, Field<unknown> | undefined> | undefined)?.[key];
    return { label, f };
  });
  const known = fields.filter((x) => x.f);
  return (
    <Card className={styles.placeholder}>
      <p className={styles.hint}>Platzhalter – der Inhalt dieses Schritts folgt in einer späteren Session.</p>
      {known.length > 0 && (
        <dl className={styles.values} aria-label="Bereits bekannt">
          {known.map(({ label, f }) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                {format(f!.value)} <span className={styles.source}>{SOURCE_LABEL[f!.source]}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}
