import { useState } from 'react';
import { NUTRIENTS } from '../../data/nutrients';
import { VITAL_NUTRIENTS, type NutritionSummary } from '../../domain/nutrition';
import { ProgressBar } from '../../components/ui/Progress';
import styles from './nutrition.module.css';

/** Same number format as all other nutrient values of the app (only CHF amounts use the Swiss point). */
const num = (v: number) => v.toLocaleString('de-DE', { maximumFractionDigits: v < 10 ? 2 : v < 100 ? 1 : 0 });

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
              Für heute liegen keine Angaben vor. Vitamine und Mineralstoffe kommen aus gescannten Produkten, die sie auf der Verpackung ausweisen – Rezepte und Katalog-Lebensmittel
              enthalten dazu keine Daten.
            </p>
          ) : (
            <>
            {partialOnce && (
              <p className={styles.microNote}>
                Werte aus {shared} von {summary.entries} Einträgen – die übrigen haben keine Angabe (nicht 0).
              </p>
            )}
            <ul className={styles.microList} aria-label="Mikronährstoffe">
              {known.map((k) => {
                const info = NUTRIENTS[k];
                const m = summary.micros[k];
                return (
                  <li key={k}>
                    <span className={styles.microName}>{info.label}</span>
                    <span className={styles.microValue}>
                      <strong>
                        {num(m.value)} {info.unit}
                      </strong>
                      {info.nrv !== undefined && (
                        <span className={styles.microRef}>
                          {' '}
                          / {num(info.nrv)} {info.unit}
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
            </>
          )}
          {known.length > 0 && missing.length > 0 && <p className={styles.microNote}>Keine Daten: {missing.map((k) => NUTRIENTS[k].label).join(', ')}</p>}
          <p className={styles.microNote}>Referenz = Nährstoffbezugswert der Lebensmittelkennzeichnung (NRV) – ein Vergleichswert, kein persönliches Ziel.</p>
        </div>
      )}
    </div>
  );
}
