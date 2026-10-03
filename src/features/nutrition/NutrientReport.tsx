import { useMemo, useState } from 'react';
import { FOODS } from '../../data/foods';
import { isDayFinished } from '../../domain/calorieStatus';
import { today } from '../../domain/dates';
import { foodAllowed } from '../../domain/nutrition';
import { nutrientReport, numberFreeReport, type NutrientGroup, type NutrientRow } from '../../domain/nutrientReport';
import { isNumberFree } from '../../domain/numberFree';
import type { ISODate } from '../../domain/types';
import { relativeDay } from '../../lib/format';
import { useAppState } from '../../store/store';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { Sheet } from '../../components/ui/Sheet';
import { Thermometer } from '../../components/ui/Thermometer';
import { changeWater } from './waterActions';
import styles from './nutrition.module.css';

const de = (n: number, digits = 1) => n.toLocaleString('de-DE', { maximumFractionDigits: n >= 100 ? 0 : n >= 10 ? Math.min(digits, 1) : Math.max(digits, 1) });

/** Thousands of mg read better as g ("1,8 / 2 g" for potassium) – value and reference in the same unit. */
function valueText(r: NutrientRow): string {
  const ref = r.reference?.amount;
  if (r.unit === 'ml') return `${de((r.amount ?? 0) / 1000, 2)}${ref ? ` / ${de(ref / 1000, 2)}` : ''} L`;
  // Only a value that is itself in the thousands switches to g – 90 mg sodium stays "90 mg", not "0,1 g".
  const toG = r.unit === 'mg' && (r.amount ?? 0) >= 1000;
  const unit = toG ? 'g' : r.unit;
  const f = toG ? 1000 : 1;
  const amount = r.amount === undefined ? '–' : de(r.amount / f, r.unit === 'kcal' ? 0 : 1);
  return ref ? `${amount} / ${de(ref / f, 1)} ${unit}` : `${amount} ${unit}`;
}

/**
 * Entry on Ernährung and Heute: one line with the most important hint of the
 * day (from the report) and "Nährstoff-Auswertung →". The main pages stay
 * compact; the details live in the sheet.
 */
export function NutrientReportEntry({ date, onLog }: { date: ISODate; onLog?: () => void }) {
  const state = useAppState();
  const [open, setOpen] = useState(false);
  const finished = isDayFinished(date, today(), new Date().getHours());
  const numberFree = isNumberFree(state);
  const report = useMemo(() => {
    const r = nutrientReport(state, date, finished);
    return numberFree ? numberFreeReport(r) : r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.logEntries, state.targets, state.closedDayTargets, state.water, state.nutritionProfile, state.training, state.workoutOverrides, date, finished, numberFree]);
  const alert = report.groups.flatMap((g) => g.rows).find((r) => r.tone === 'red');
  return (
    <>
      <button type="button" className={styles.reportEntry} onClick={() => setOpen(true)}>
        <span className={styles.reportEntryText}>
          <strong>Nährstoff-Auswertung</strong>
          <span className={alert ? styles.reportHintAlert : styles.reportHint}>{alert ? `${alert.label}: ${alert.message}` : report.summary[0] ?? 'Alle Werte im Überblick'}</span>
        </span>
        <Icon name="chevronRight" size={18} />
      </button>
      <NutrientReportSheet
        open={open}
        date={date}
        finished={finished}
        onClose={() => setOpen(false)}
        onLog={
          onLog &&
          (() => {
            setOpen(false);
            onLog();
          })
        }
      />
    </>
  );
}

function NutrientReportSheet({ open, date, finished, onClose, onLog }: { open: boolean; date: ISODate; finished: boolean; onClose: () => void; onLog?: () => void }) {
  const state = useAppState();
  const report = useMemo(() => {
    if (!open) return undefined;
    const r = nutrientReport(state, date, finished);
    return isNumberFree(state) ? numberFreeReport(r) : r;
  }, [open, state, date, finished]);
  if (!open || !report) return <Sheet open={false} onClose={onClose} title="" children={null} />;
  const rows = report.groups.flatMap((g) => g.rows);
  const get = (k: string) => rows.find((r) => r.key === k);
  const protein = get('protein');
  const fiber = get('fiber');
  const water = get('water');
  // Real data only: the catalog foods richest in fiber that fit the user's diet.
  const fiberFoods = FOODS.filter((f) => f.micros?.fiber !== undefined && foodAllowed(f, state.nutritionProfile))
    .sort((a, b) => b.micros!.fiber! - a.micros!.fiber!)
    .slice(0, 3)
    .map((f) => f.name);

  return (
    <Sheet open onClose={onClose} title="Nährstoff-Auswertung" subtitle={`${relativeDay(date)} · aus ${report.entries} ${report.entries === 1 ? 'Eintrag' : 'Einträgen'}`}>
      <section className={styles.reportSummary} aria-label="Zusammenfassung">
        <p className={styles.reportSummaryTitle}>{relativeDay(date)}</p>
        <ul>
          {report.summary.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {/* Next useful step – only where the data says something is open. */}
        <div className={styles.reportActions}>
          {protein?.tone === 'orange' && protein.reference && onLog && (
            <Button size="sm" variant="secondary" icon="plus" className={styles.tapTarget} onClick={onLog}>
              Protein: passende Mahlzeiten
            </Button>
          )}
          {water?.tone === 'orange' && (
            <Button size="sm" variant="secondary" icon="drop" className={styles.tapTarget} onClick={() => changeWater(date, 250)}>
              +250 ml Wasser
            </Button>
          )}
        </div>
        {fiber?.tone === 'orange' && !fiber.partial && fiberFoods.length > 0 && <p className={styles.sourceNote}>Viele Ballaststoffe haben z. B.: {fiberFoods.join(', ')}.</p>}
      </section>

      {report.groups.map((g) => (
        <ReportGroup key={g.id} group={g} />
      ))}

      <p className={styles.microNote}>
        Referenzwerte sind Orientierungswerte, keine medizinische Beurteilung. Kalorien, Makros, Ballaststoffe und Zucker beziehen sich auf dein persönliches Tagesziel; Vitamine und Mineralstoffe auf
        den allgemeinen Referenzwert der Lebensmittelkennzeichnung (NRV).
      </p>
    </Sheet>
  );
}

const GROUP_NOTE: Partial<Record<NutrientGroup['id'], string>> = {
  energy: 'Bezogen auf dein Tagesziel – aus Körperdaten, Aktivität, Training und Ziel',
  limit: 'Obergrenzen: Salz 5 g (WHO), Zucker nach EU-Referenzmenge auf dein Tagesziel umgerechnet',
  vitamin: 'Allgemeiner Referenzwert (NRV) – für alle gleich, nicht individuell berechnet',
  mineral: 'Allgemeiner Referenzwert (NRV); Natrium: Obergrenze 2’000 mg (WHO)',
};

function ReportGroup({ group }: { group: NutrientGroup }) {
  const known = group.rows.filter((r) => r.amount !== undefined);
  const missing = group.rows.filter((r) => r.amount === undefined);
  // Vitamins/minerals without any data are listed once instead of as many empty rows.
  const collapse = group.id === 'vitamin' || group.id === 'mineral';
  const shown = collapse ? known : group.rows;
  return (
    <section className={styles.reportGroup} aria-label={group.label}>
      <h3 className={styles.microGroupTitle}>{group.label}</h3>
      {GROUP_NOTE[group.id] && <p className={styles.reportGroupNote}>{GROUP_NOTE[group.id]}</p>}
      <div className={styles.reportRows}>
        {shown.map((r, i) => (
          <div key={r.key} className={styles.reportRow} style={{ ['--i' as string]: i }}>
            <Thermometer
              label={r.label}
              value={valueText(r)}
              message={r.message}
              tone={r.tone}
              kind={r.reference?.kind}
              ratio={r.amount === undefined || !r.reference ? undefined : r.ratio}
              band={r.reference?.kind === 'range' && r.reference.tolerance ? r.reference.tolerance / r.reference.amount : undefined}
              tag={r.reference?.role}
              note={r.key === 'fiber' ? r.reference?.basis : undefined}
            />
          </div>
        ))}
      </div>
      {collapse && missing.length > 0 && <p className={styles.microNote}>Keine Daten: {missing.map((r) => r.label).join(', ')}</p>}
    </section>
  );
}
