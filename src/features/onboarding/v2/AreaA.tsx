import { useEffect, useState } from 'react';
import {
  ageFromBirthYear,
  bmi,
  bmiClass,
  energyEstimate,
  ffmi,
  ffmiClass,
  formatBodyFat,
  measuredEstimate,
  navyEstimate,
  rfmEstimate,
  visualEstimate,
  visualStages,
  whtr,
  whtrClass,
  type BodyFatEstimate,
  type BodyFatMethod,
} from '../../../domain/body';
import { ACTIVITY_FACTOR, ACTIVITY_STEPS, BMI_HIGHLIGHT_FROM, MEASURED_ACCURACY, NAVY, PLAUSIBLE, RFM, VISUAL_ACCURACY } from '../../../domain/constants';
import { today } from '../../../domain/dates';
import type { OnboardingProfile, OnboardingStepId } from '../../../domain/onboarding/types';
import type { ActivityLevel, Sex } from '../../../domain/types';
import { fmt } from '../../../lib/format';
import { setOnboardingAnswer } from '../../../store/onboardingActions';
import { useAppState } from '../../../store/store';
import { Card } from '../../../components/ui/Card';
import { Chip, OptionCard } from '../../../components/ui/Controls';
import { Sheet } from '../../../components/ui/Sheet';
import { GoalStep, HealthStep } from './AreaAGoal';
import { NumberField } from './NumberField';
import styles from './onboardingV2.module.css';

/** Steps of section A that have their content (Prompt 2). */
export const AREA_A_STEPS: OnboardingStepId[] = ['weight', 'height', 'birthYear', 'sex', 'experience', 'activity', 'waist', 'analysis', 'bodyFat', 'health', 'goal'];

const dec = (n: number, digits = 1) => n.toLocaleString('de-DE', { maximumFractionDigits: digits, minimumFractionDigits: digits });
/** 1,375 / 1,5 / 1,2 – factors without trailing zeros. */
const factor = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 3 });

/** Answers of section A with their fall-backs for the calculations ("keine Angabe" when the sex is unknown). */
function bodyOf(p: OnboardingProfile | undefined) {
  const b = p?.body ?? {};
  return {
    weightKg: b.weightKg?.value,
    heightCm: b.heightCm?.value,
    birthYear: b.birthYear?.value,
    sex: (b.sex?.value ?? 'unspecified') as Sex,
    sexKnown: !!b.sex,
    experience: b.trainingExperience?.value,
    paused: b.trainingPaused?.value ?? false,
    activity: b.activity?.value,
    waistCm: b.waistCm?.value,
    neckCm: b.neckCm?.value,
    hipCm: b.hipCm?.value,
    bodyFat: b.bodyFat?.value,
  };
}

export function AreaAStep({ step }: { step: OnboardingStepId }) {
  const profile = useAppState().onboarding;
  const b = bodyOf(profile);
  const year = Number(today().slice(0, 4));

  switch (step) {
    case 'weight':
      return (
        <NumberField
          label="Gewicht"
          unit="kg"
          value={b.weightKg}
          decimals={1}
          step={0.5}
          start={70}
          plausible={PLAUSIBLE.weightKg}
          onChange={(v) => setOnboardingAnswer('body', 'weightKg', v)}
          hint="Am besten morgens, nüchtern, vor dem Frühstück."
        />
      );
    case 'height':
      return <NumberField label="Größe" unit="cm" value={b.heightCm} step={1} start={170} plausible={PLAUSIBLE.heightCm} onChange={(v) => setOnboardingAnswer('body', 'heightCm', v)} />;
    case 'birthYear': {
      const [minAge, maxAge] = PLAUSIBLE.age;
      return (
        <NumberField
          label="Geburtsjahr"
          value={b.birthYear}
          step={1}
          start={year - 35}
          plausible={[year - maxAge, year - minAge]}
          plain
          onChange={(v) => setOnboardingAnswer('body', 'birthYear', v)}
          hint={b.birthYear ? `Das sind ${ageFromBirthYear(b.birthYear, today())} Jahre.` : 'Daraus berechnen wir dein Alter – es bleibt automatisch aktuell.'}
        />
      );
    }
    case 'sex':
      return (
        <div className={styles.stack} role="group" aria-label="Geschlecht">
          {(
            [
              ['male', 'Männlich'],
              ['female', 'Weiblich'],
              ['unspecified', 'Keine Angabe'],
            ] as const
          ).map(([value, title]) => (
            <OptionCard key={value} title={title} selected={b.sexKnown && b.sex === value} onClick={() => setOnboardingAnswer('body', 'sex', value)} />
          ))}
          <p className={styles.hint}>Die Formeln für den Energiebedarf unterscheiden nach biologischem Geschlecht. Ohne Angabe rechnen wir mit einem Mittelwert.</p>
        </div>
      );
    case 'experience':
      return (
        <div className={styles.stack} role="group" aria-label="Kraftsport-Erfahrung">
          {(
            [
              ['never', 'Nie'],
              ['lt1', 'Unter 1 Jahr'],
              ['1to2', '1–2 Jahre'],
              ['3to5', '3–5 Jahre'],
              ['gt5', 'Über 5 Jahre'],
            ] as const
          ).map(([value, title]) => (
            <OptionCard key={value} title={title} selected={b.experience === value} onClick={() => setOnboardingAnswer('body', 'trainingExperience', value)} />
          ))}
          <div>
            <Chip selected={b.paused} onClick={() => setOnboardingAnswer('body', 'trainingPaused', !b.paused)}>
              Ich pausiere gerade (länger als 3 Monate)
            </Chip>
          </div>
        </div>
      );
    case 'activity':
      return (
        <div className={styles.stack} role="group" aria-label="Alltagsaktivität">
          {(
            [
              ['sedentary', 'Überwiegend sitzend'],
              ['light', 'Leicht aktiv'],
              ['moderate', 'Aktiv'],
              ['active', 'Sehr aktiv'],
            ] as [ActivityLevel, string][]
          ).map(([value, title]) => (
            <OptionCard key={value} title={title} description={ACTIVITY_STEPS[value]} selected={b.activity === value} onClick={() => setOnboardingAnswer('body', 'activity', value)} />
          ))}
          <p className={styles.hint}>Gemeint ist dein Alltag ohne geplantes Training – das rechnen wir separat dazu.</p>
        </div>
      );
    case 'waist':
      return (
        <div className={styles.stack}>
          <NumberField label="Taillenumfang (optional)" unit="cm" value={b.waistCm} step={1} start={85} plausible={PLAUSIBLE.waistCm} onChange={(v) => setOnboardingAnswer('body', 'waistCm', v)} hint="Auf Bauchnabelhöhe, entspannt ausgeatmet, Massband waagrecht." />
          <StringTip />
        </div>
      );
    case 'analysis':
      return <Analysis />;
    case 'bodyFat':
      return <BodyFat />;
    case 'health':
      return <HealthStep />;
    case 'goal':
      return <GoalStep />;
    default:
      return null;
  }
}

function StringTip() {
  return (
    <p className={styles.tip}>
      <strong>Ohne Massband:</strong> Schneide eine Schnur in deiner Körpergröße ab und falte sie in der Mitte. Passt sie um deine Taille, liegt dein WHtR unter 0,5.
    </p>
  );
}

// ---------- Analysis ----------

/** The energy start value from what is known so far (needs weight, height, birth year). */
function useEnergy(fat?: BodyFatEstimate) {
  const state = useAppState();
  const b = bodyOf(state.onboarding);
  if (!b.weightKg || !b.heightCm || !b.birthYear) return undefined;
  const weekdays = state.onboarding?.training.weekdays?.value ?? state.training?.weekdays ?? [];
  return {
    sessions: weekdays.length,
    ...energyEstimate({
      sex: b.sex,
      age: ageFromBirthYear(b.birthYear, today()),
      heightCm: b.heightCm,
      weightKg: b.weightKg,
      activity: b.activity ?? 'light',
      sessionsPerWeek: weekdays.length,
      ...(state.onboarding?.training.sessionMinutes ? { sessionMinutes: state.onboarding.training.sessionMinutes.value } : {}),
      ...(fat ? { bodyFat: fat } : b.bodyFat ? { bodyFat: b.bodyFat } : {}),
    }),
    activityKnown: !!b.activity,
  };
}

function Analysis() {
  const b = bodyOf(useAppState().onboarding);
  const value = bmi(b.weightKg, b.heightCm);
  const ratio = whtr(b.waistCm, b.heightCm);
  const experienced = b.experience === '1to2' || b.experience === '3to5' || b.experience === 'gt5';
  const highlight = experienced || (value !== undefined && value >= BMI_HIGHLIGHT_FROM);
  const [why, setWhy] = useState(false);
  return (
    <div className={styles.stack}>
      {value !== undefined ? (
        <Card className={styles.result} aria-label="BMI">
          <span className={styles.resultLabel}>BMI</span>
          <strong className={styles.resultValue}>{dec(value)}</strong>
          <span>{bmiClass(value).label}</span>
        </Card>
      ) : (
        <p className={styles.hint}>Mit Gewicht und Größe siehst du hier deinen BMI.</p>
      )}
      <Card className={highlight ? styles.infoHighlight : styles.info} data-highlight={highlight || undefined}>
        <p>
          Der BMI unterscheidet nicht zwischen Muskeln und Fett. Wer Kraftsport macht, wird oft als ‚übergewichtig‘ eingestuft, obwohl der Körperfettanteil niedrig ist. Aussagekräftiger ist dein Körperfettanteil.
        </p>
      </Card>
      {ratio !== undefined ? (
        <Card className={styles.result} aria-label="Taille-zu-Größe-Verhältnis">
          <span className={styles.resultLabel}>Taille-zu-Größe (WHtR)</span>
          <strong className={styles.resultValue}>{dec(ratio, 2)}</strong>
          <span>{whtrClass(ratio).label}</span>
        </Card>
      ) : (
        <StringTip />
      )}
      <EnergyCard />
      <button type="button" className={styles.whyLink} onClick={() => setWhy(true)}>
        Warum? Formeln und Quellen
      </button>
      <Sheet open={why} onClose={() => setWhy(false)} title="So rechnen wir">
        <div className={styles.whySheet}>
          <p>
            <strong>BMI</strong> = Gewicht (kg) / Größe (m)². Einordnung nach WHO (2000): unter 18,5 · 18,5–24,9 · 25–29,9 · ab 30. Für Kraftsportler wenig aussagekräftig, weil Muskeln schwer sind.
          </p>
          <p>
            <strong>WHtR</strong> = Taille / Größe. Richtwert unter 0,5 (Ashwell, Gunn &amp; Gibson, Obesity Reviews 2012) – ein einfacher Hinweis auf Bauchfett.
          </p>
          <EnergyWhy />
        </div>
      </Sheet>
    </div>
  );
}

function EnergyCard({ fat }: { fat?: BodyFatEstimate }) {
  const e = useEnergy(fat);
  if (!e) return <p className={styles.hint}>Mit Gewicht, Größe und Geburtsjahr berechnen wir deinen Energiebedarf.</p>;
  const same = (r: [number, number]) => r[0] === r[1];
  const range = (r: [number, number]) => (same(r) ? `ca. ${fmt.int(r[0])} kcal` : `ca. ${fmt.int(r[0])}–${fmt.int(r[1])} kcal`);
  return (
    <Card className={styles.result} aria-label="Energiebedarf">
      <span className={styles.resultLabel}>Startwert Energiebedarf pro Tag</span>
      <strong className={styles.resultValue}>{range(e.tdeeRange)}</strong>
      <span className={styles.hint}>
        Grundumsatz {range(e.bmrRange)} · Alltag × {factor(e.activityFactor)}
        {e.sessions ? ` · Training ca. ${fmt.int(Math.round(e.training / 10) * 10)} kcal/Tag (${e.sessions}× pro Woche)` : ' · noch ohne geplantes Training'}
      </span>
      <span className={styles.hint}>Wir passen ihn anhand deines Gewichtsverlaufs automatisch an.{e.activityKnown ? '' : ' Alltag: „leicht aktiv“ angenommen.'}</span>
    </Card>
  );
}

function EnergyWhy() {
  return (
    <>
      <p>
        <strong>Grundumsatz</strong> ohne Körperfett: Mifflin-St Jeor (1990) = 10 · kg + 6,25 · cm − 5 · Alter + 5 (Männer) bzw. − 161 (Frauen); ohne Angabe −78 und als Bereich zwischen beiden. Mit gemessenem Körperfett oder Massband: Katch-McArdle = 370 + 21,6 ·
        fettfreie Masse. Mit Taille oder visueller Schätzung: Mittelwert beider Formeln.
      </p>
      <p>
        <strong>Energiebedarf</strong> = Grundumsatz × Alltagsfaktor ({Object.values(ACTIVITY_FACTOR).map(factor).join(' / ')}) + Trainingsaufschlag. Der Alltagsfaktor beschreibt nur deinen Alltag; jede geplante Krafteinheit kommt
        separat dazu (Krafttraining 3,5 MET nach dem Compendium of Physical Activities 2011, abzüglich der Ruheenergie) – so wird nichts doppelt gezählt.
      </p>
      <p>Das ist ein Startwert. LifeFit passt ihn nach einigen Wochen anhand deines Gewichtsverlaufs an.</p>
    </>
  );
}

// ---------- Body fat ----------

const METHODS: { id: BodyFatMethod; title: string; description: string; badge?: string }[] = [
  { id: 'measured', title: 'Ich kenne meinen Wert', description: `Körperfettwaage, DEXA, Caliper · ca. ±${MEASURED_ACCURACY} %` },
  { id: 'navy', title: 'Massband', description: `US-Navy-Methode · ca. ±${dec(NAVY.accuracy - 0.5, 0)}–${dec(NAVY.accuracy + 0.5, 0)} %`, badge: 'Beste Methode ohne Gerät' },
  { id: 'rfm', title: 'Nur Taille', description: `Relative Fat Mass · ca. ±${RFM.accuracy} %` },
  { id: 'visual', title: 'Ohne Hilfsmittel', description: `Visueller Vergleich · ca. ±${VISUAL_ACCURACY} %`, badge: 'Wenn nichts zur Hand ist' },
];

const METHOD_LABEL: Record<BodyFatMethod, string> = { measured: 'eigener Messwert', navy: 'Massband (US-Navy)', rfm: 'Taille (RFM)', visual: 'visueller Vergleich' };

function BodyFat() {
  const state = useAppState();
  const b = bodyOf(state.onboarding);
  const [method, setMethod] = useState<BodyFatMethod | undefined>(b.bodyFat?.method);
  const [reference, setReference] = useState<'male' | 'female'>(b.sex === 'female' ? 'female' : 'male');
  const [why, setWhy] = useState(false);
  const circ = { heightCm: b.heightCm ?? 0, waistCm: b.waistCm ?? 0, ...(b.neckCm ? { neckCm: b.neckCm } : {}), ...(b.hipCm ? { hipCm: b.hipCm } : {}) };
  const computed = method === 'navy' ? navyEstimate(b.sex, circ) : method === 'rfm' ? rfmEstimate(b.sex, circ) : undefined;

  // Navy / RFM follow the measurements – the estimate is stored as soon as it can be computed.
  const key = computed ? `${computed.method}:${computed.percent}:${computed.range.join('-')}` : '';
  useEffect(() => {
    if (!computed) return;
    const saved = b.bodyFat;
    if (saved && saved.method === computed.method && saved.percent === computed.percent && saved.range.join() === computed.range.join()) return;
    setOnboardingAnswer('body', 'bodyFat', computed, 'estimated');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const shown: BodyFatEstimate | undefined = b.bodyFat && b.bodyFat.method === method ? b.bodyFat : computed;
  const needsHip = b.sex !== 'male';
  return (
    <div className={styles.stack}>
      <div className={styles.stack} role="group" aria-label="Methode">
        {METHODS.map((m) => (
          <OptionCard key={m.id} title={m.title} description={m.badge ? `${m.description} · ${m.badge}` : m.description} selected={method === m.id} onClick={() => setMethod(m.id)} />
        ))}
      </div>

      {method === 'measured' && (
        <NumberField
          label="Körperfett"
          unit="%"
          value={b.bodyFat?.method === 'measured' ? b.bodyFat.percent : undefined}
          decimals={1}
          step={0.5}
          start={20}
          plausible={PLAUSIBLE.bodyFatPct}
          onChange={(v) => {
            const e = measuredEstimate(v);
            if (e) setOnboardingAnswer('body', 'bodyFat', e, 'user');
          }}
        />
      )}

      {method === 'navy' && (
        <>
          <p className={styles.hint}>
            So misst du: <strong>Hals</strong> unterhalb des Kehlkopfs. <strong>Taille</strong> auf Bauchnabelhöhe (Männer) bzw. an der schmalsten Stelle (Frauen).
            {needsHip && (
              <>
                {' '}
                <strong>Hüfte</strong> an der breitesten Stelle.
              </>
            )}{' '}
            Massband waagrecht, entspannt ausgeatmet.
          </p>
          <NumberField label="Hals" unit="cm" value={b.neckCm} step={0.5} decimals={1} start={38} plausible={PLAUSIBLE.neckCm} onChange={(v) => setOnboardingAnswer('body', 'neckCm', v)} />
          <NumberField label="Taille" unit="cm" value={b.waistCm} step={0.5} decimals={1} start={85} plausible={PLAUSIBLE.waistCm} onChange={(v) => setOnboardingAnswer('body', 'waistCm', v)} />
          {needsHip && <NumberField label="Hüfte" unit="cm" value={b.hipCm} step={0.5} decimals={1} start={100} plausible={PLAUSIBLE.hipCm} onChange={(v) => setOnboardingAnswer('body', 'hipCm', v)} />}
          {!b.heightCm && <p className={styles.notice}>Für die Berechnung fehlt noch deine Größe.</p>}
        </>
      )}

      {method === 'rfm' && (
        <>
          <NumberField label="Taille" unit="cm" value={b.waistCm} step={0.5} decimals={1} start={85} plausible={PLAUSIBLE.waistCm} onChange={(v) => setOnboardingAnswer('body', 'waistCm', v)} hint="Auf Bauchnabelhöhe, entspannt ausgeatmet." />
          {!b.heightCm && <p className={styles.notice}>Für die Berechnung fehlt noch deine Größe.</p>}
        </>
      )}

      {method === 'visual' && (
        <>
          {!b.sexKnown || b.sex === 'unspecified' ? (
            <div className={styles.stack}>
              <span className={styles.label}>Vergleichsbilder</span>
              <div className={styles.chips}>
                <Chip selected={reference === 'male'} onClick={() => setReference('male')}>
                  Männliche Referenz
                </Chip>
                <Chip selected={reference === 'female'} onClick={() => setReference('female')}>
                  Weibliche Referenz
                </Chip>
              </div>
            </div>
          ) : null}
          <ul className={styles.stages} aria-label="Welches Bild passt am ehesten?">
            {visualStages(b.sex === 'male' || b.sex === 'female' ? b.sex : reference).map((stage, i) => {
              const e = visualEstimate(stage);
              const selected = b.bodyFat?.method === 'visual' && b.bodyFat.percent === e.percent;
              return (
                <li key={stage.from}>
                  <button type="button" className={styles.stage} aria-pressed={selected} onClick={() => setOnboardingAnswer('body', 'bodyFat', e, 'estimated')}>
                    <Silhouette level={i} reference={b.sex === 'male' || b.sex === 'female' ? b.sex : reference} />
                    <span>
                      <strong>
                        {stage.from}–{stage.to} %
                      </strong>
                      <span className={styles.hint}>{stage.features}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {!method && <StringTip />}

      {shown && <BodyFatResult estimate={shown} />}
      <button type="button" className={styles.whyLink} onClick={() => setWhy(true)}>
        Warum? Formeln und Quellen
      </button>
      <Sheet open={why} onClose={() => setWhy(false)} title="Körperfett schätzen">
        <div className={styles.whySheet}>
          <p>
            <strong>Massband (US-Navy, Hodgdon &amp; Beckett 1984)</strong>, Werte in cm: Männer 495 / (1,0324 − 0,19077 · log10(Taille − Hals) + 0,15456 · log10(Größe)) − 450; Frauen 495 / (1,29579 − 0,35004 · log10(Taille + Hüfte − Hals) + 0,221 · log10(Größe)) − 450. Genauigkeit ca. ±3–4 %.
          </p>
          <p>
            <strong>Nur Taille (Relative Fat Mass, Woolcott &amp; Bergman 2018)</strong>: Männer 64 − 20 · (Größe / Taille), Frauen 76 − 20 · (Größe / Taille). Ca. ±{RFM.accuracy} %.
          </p>
          <p>
            <strong>Visueller Vergleich</strong>: Orientierung, ca. ±{VISUAL_ACCURACY} %. Ohne Angabe des Geschlechts nehmen wir bei den Formeln den Mittelwert und zeigen den Bereich über beide.
          </p>
          <p>
            <strong>FFMI</strong> = fettfreie Masse / Größe (m)², normalisiert auf 1,80 m: + 6,1 · (1,8 − Größe) (Kouri et al. 1995). Ein Hinweis auf deine Muskelmasse – keine Bewertung.
          </p>
        </div>
      </Sheet>
    </div>
  );
}

function BodyFatResult({ estimate }: { estimate: BodyFatEstimate }) {
  const b = bodyOf(useAppState().onboarding);
  const f = b.weightKg && b.heightCm ? ffmi(b.weightKg, b.heightCm, estimate.percent) : undefined;
  return (
    <div className={styles.stack} aria-live="polite">
      <Card className={styles.result} aria-label="Körperfett">
        <span className={styles.resultLabel}>Körperfett · {METHOD_LABEL[estimate.method]}</span>
        <strong className={styles.resultValue}>{formatBodyFat(estimate)}</strong>
        {b.weightKg && <span className={styles.hint}>Fettfreie Masse ca. {fmt.int(b.weightKg * (1 - estimate.range[1] / 100))}–{fmt.int(b.weightKg * (1 - estimate.range[0] / 100))} kg</span>}
        {f && (
          <span className={styles.hint}>
            FFMI (normalisiert) ca. {dec(f.normalized)} · {ffmiClass(f.normalized, b.sex)}
          </span>
        )}
      </Card>
      <EnergyCard fat={estimate} />
    </div>
  );
}

/** A neutral, self-drawn figure: only the outline changes from stage to stage. */
function Silhouette({ level, reference }: { level: number; reference: 'male' | 'female' }) {
  const waist = 30 + level * 6;
  const hip = reference === 'female' ? waist + 14 : waist + 4;
  const shoulders = reference === 'female' ? 50 : 58;
  const x = (w: number) => [50 - w / 2, 50 + w / 2] as const;
  const [sl, sr] = x(shoulders);
  const [wl, wr] = x(waist);
  const [hl, hr] = x(hip);
  const d = `M ${sl} 34 Q ${sl - 2} 52 ${wl} 70 Q ${hl - 2} 86 ${hl} 100 L ${hr} 100 Q ${hr + 2} 86 ${wr} 70 Q ${sr + 2} 52 ${sr} 34 Q 50 27 ${sl} 34 Z`;
  return (
    <svg viewBox="0 0 100 104" width="48" height="50" className={styles.silhouette} aria-hidden>
      <circle cx="50" cy="15" r="10" />
      <path d={d} />
      {level <= 1 && (
        <g className={styles.silhouetteLines}>
          <line x1="44" y1="52" x2="44" y2="78" />
          <line x1="56" y1="52" x2="56" y2="78" />
          <line x1="44" y1="61" x2="56" y2="61" />
          <line x1="44" y1="70" x2="56" y2="70" />
        </g>
      )}
    </svg>
  );
}
