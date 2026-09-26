import { useState } from 'react';
import { NUTRIENTS } from '../../data/nutrients';
import { VITAL_NUTRIENTS, type NutritionSummary } from '../../domain/nutrition';
import { ProgressBar } from '../../components/ui/Progress';
import styles from './nutrition.module.css';

const GROUPS = [
  { id: 'vitamin', label: 'Vitamine' },
  { id: 'mineral', label: 'Mineralstoffe' },
] as const;

/** Same number format as all other nutrient values of the app (only CHF amounts use the Swiss point). */
const num = (v: number) => v.toLocaleString('de-DE', { maximumFractionDigits: v < 10 ? 2 : v < 100 ? 1 : 0 });

/** Thousands of mg read better as g ("1,8 / 2 g" for potassium) – value and reference always in the same unit. */
function displayUnit(unit: 'g' | 'mg' | 'µg', scale: number): { unit: string; divide: number } {
  return unit === 'mg' && scale >= 1000 ? { unit: 'g', divide: 1000 } : { unit, divide: 1 };
}

/**
 * Vitamins and minerals of the day – from the eaten entries only (the same
 * summary as the macros). Only values that are really known are shown; a
 * nutrient without data is listed as "keine Daten", never as 0. The bar is
 * measured against the official labelling reference (NRV), not a target.
 */
export function MicronutrientPanel({ summary }: { summary: NutritionSummary }) {
  const [open, setOpen] = useState(false);
  const known = VITAL_NUTRIENTS.filter((k) => summary.micros[k].known > 0);
  const missing = VITAL_NUTRIENTS.filter((k) => summary.micros[k].known === 0);
  // Usually all values come from the same entries – then the coverage is said once, not in every row.
  const coverage = new Set(known.map((k) => summary.micros[k].known));
  const shared = coverage.size === 1 ? summary.micros[known[0]!].known : undefined;
  const partialOnce = shared !== undefined && shared < summary.entries;

  return (
    <div className={styles.micro}>
      <button type="button" className={styles.microToggle} onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? 'Mikronährstoffe ausblenden' : 'Mikronährstoffe anzeigen'}
        <span aria-hidden>{open ? '↑' : '→'}</span>
        {!open && known.length > 0 && <span className={styles.microCount}>{known.length} mit Daten</span>}
      </button>
      {open && (
        <div className={styles.microBody}>
          {known.length === 0 ? (
            <p className={styles.microNote}>
              Für heute liegen keine Angaben vor. Werte kommen aus Rezepten und Lebensmitteln mit vollständigen Nährwertdaten und aus gescannten Produkten, die sie auf der
              Verpackung ausweisen.
            </p>
          ) : (
            <>
              {partialOnce && (
                <p className={styles.microNote}>
                  Werte aus {shared} von {summary.entries} Einträgen – die übrigen haben keine Angabe (nicht 0).
                </p>
              )}
              <div role="group" aria-label="Mikronährstoffe" className={styles.microGroups}>
                {GROUPS.map((group) => {
                  const rows = known.filter((k) => NUTRIENTS[k].group === group.id);
                  if (!rows.length) return null;
                  return (
                    <section key={group.id} className={styles.microGroup} aria-label={group.label}>
                      <h3 className={styles.microGroupTitle}>{group.label}</h3>
                      <ul className={styles.microList}>
                        {rows.map((k) => {
                          const info = NUTRIENTS[k];
                          const m = summary.micros[k];
                          const shown = displayUnit(info.unit, info.nrv ?? m.value);
                          return (
                            <li key={k}>
                              <span className={styles.microName}>{info.label}</span>
                              <span className={styles.microValue}>
                                <strong>
                                  {num(m.value / shown.divide)} {shown.unit}
                                </strong>
                                {info.nrv !== undefined && (
                                  <span className={styles.microRef}>
                                    {' '}
                                    / {num(info.nrv / shown.divide)} {shown.unit}
                                  </span>
                                )}
                              </span>
                              {info.nrv !== undefined ? <ProgressBar value={m.value} max={info.nrv} height={4} label={info.label} /> : <span />}
                              {m.known < m.of && !partialOnce && (
                                <span className={styles.microPartial}>
                                  nur aus {m.known} von {m.of} Einträgen – der Rest hat keine Angabe
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  );
                })}
              </div>
            </>
          )}
          {known.length > 0 && missing.length > 0 && <p className={styles.microNote}>Keine Daten: {missing.map((k) => NUTRIENTS[k].label).join(', ')}</p>}
          {/* The reference note belongs to values – without any it would only be noise. */}
          {known.length > 0 && (
            <p className={styles.microNote}>
              Referenz = Nährstoffbezugswert der Lebensmittelkennzeichnung (NRV) – ein Vergleichswert, kein persönliches Ziel. Quellen: USDA FoodData Central (Rezepte,
              Lebensmittel), Verpackungsangaben via Open Food Facts (gescannte Produkte).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
