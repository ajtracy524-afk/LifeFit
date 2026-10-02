import type { OnboardingProfile } from '../../../domain/onboarding/types';
import type { EatingOutPlace, EatingOutSize, MealSlot, NutritionProfile, SlotPlan, Weekday, WeekTemplate } from '../../../domain/types';
import { copyDay, copySlot, nextPlan, setSlot, setSlotOn, WEEKDAYS, WORKDAYS } from '../../../domain/week/slotPlans';
import { weekdayLong } from '../../../lib/format';
import { withUndo } from '../../../lib/undo';
import { setFoodAnswer } from '../../../store/onboardingActions';
import { Button } from '../../../components/ui/Button';
import { Segmented } from '../../../components/ui/Controls';
import styles from './onboardingV2.module.css';

/**
 * "Deine typische Woche" (Prompt 5): 7 days × the chosen meals, as one list
 * per day (readable at 320 px). Every slot is a button with icon and text;
 * tapping cycles Zuhause → Mitnehmen → Auswärts → Auslassen. The answer is a
 * recurring template – single weeks deviate in the week plan.
 */

const PLAN_STATE: Record<SlotPlan['kind'], { icon: string; label: string; hint: string }> = {
  home: { icon: '🏠', label: 'Zuhause', hint: 'wird geplant und eingekauft' },
  togo: { icon: '🥡', label: 'Mitnehmen', hint: 'geplant und eingekauft – nur transportfähige Rezepte, gut für Meal-Prep' },
  out: { icon: '🍽️', label: 'Auswärts', hint: 'kein Rezept, kein Einkauf – ein Kalorienbudget bleibt reserviert' },
  skip: { icon: '⏭️', label: 'Auslassen', hint: 'die Mahlzeit fällt weg, die Tageswerte verteilen sich auf die übrigen' },
};
const PLACES: { value: EatingOutPlace; label: string }[] = [
  { value: 'canteen', label: 'Kantine' },
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'friends', label: 'bei Freunden' },
];
const SIZES: { value: EatingOutSize; label: string }[] = [
  { value: 'small', label: 'klein' },
  { value: 'normal', label: 'normal' },
  { value: 'large', label: 'groß' },
];
const MEAL_LABEL: Record<MealSlot, string> = { breakfast: 'Frühstück', snack: 'Snack 1', lunch: 'Mittagessen', snack2: 'Snack 2', dinner: 'Abendessen' };

export function WeekStep({ food, np }: { food: OnboardingProfile['food']; np: NutritionProfile }) {
  const template: WeekTemplate = food.weekTemplate?.value ?? {};
  const slots = np.slots;
  const save = (next: WeekTemplate, message?: string) => {
    if (message) withUndo(message, () => setFoodAnswer('weekTemplate', next));
    else setFoodAnswer('weekTemplate', next);
  };
  const planOf = (day: Weekday, slot: MealSlot): SlotPlan => template[day]?.[slot] ?? { kind: 'home' };

  return (
    <div className={styles.stack}>
      <ul className={styles.legend} aria-label="Zustände">
        {(Object.keys(PLAN_STATE) as SlotPlan['kind'][]).map((k) => (
          <li key={k}>
            <span aria-hidden>{PLAN_STATE[k].icon}</span> <strong>{PLAN_STATE[k].label}</strong> – {PLAN_STATE[k].hint}
          </li>
        ))}
      </ul>

      <div className={styles.chips} role="group" aria-label="Schnellaktionen">
        {slots.includes('lunch') && (
          <>
            <Button size="sm" variant="secondary" onClick={() => save(setSlotOn(template, WORKDAYS, 'lunch', { kind: 'out' }), 'Mo–Fr Mittag auswärts')}>
              Mo–Fr Mittag auswärts
            </Button>
            <Button size="sm" variant="secondary" onClick={() => save(setSlotOn(template, WORKDAYS, 'lunch', { kind: 'togo' }), 'Mo–Fr Mittag mitnehmen')}>
              Mo–Fr Mittag mitnehmen
            </Button>
          </>
        )}
        <Button size="sm" variant="ghost" disabled={!Object.keys(template).length} onClick={() => save({}, 'Typische Woche zurückgesetzt')}>
          Alles zurücksetzen
        </Button>
      </div>

      {WEEKDAYS.map((day) => (
        <section key={day} className={styles.weekDayRow} aria-label={weekdayLong(day)}>
          <div className={styles.subgroup}>
            <h2 className={styles.groupTitle}>{weekdayLong(day)}</h2>
            <span className={styles.quick}>
              <Button size="sm" variant="ghost" onClick={() => save(copyDay(template, day, WORKDAYS.filter((d) => d !== day), slots), `${weekdayLong(day)} auf Mo–Fr übertragen`)}>
                Zeile → Mo–Fr
              </Button>
              <Button size="sm" variant="ghost" onClick={() => save(copyDay(template, day, WEEKDAYS.filter((d) => d !== day), slots), `${weekdayLong(day)} auf alle Tage übertragen`)}>
                Zeile → alle
              </Button>
            </span>
          </div>
          <div className={styles.slotGrid}>
            {slots.map((slot) => {
              const plan = planOf(day, slot);
              const st = PLAN_STATE[plan.kind];
              const name = `${weekdayLong(day)}, ${MEAL_LABEL[slot]}`;
              return (
                <div key={slot} className={styles.slotCell}>
                  <button type="button" className={styles.slotButton} data-kind={plan.kind} aria-label={`${name}: ${st.label}`} onClick={() => save(setSlot(template, day, slot, nextPlan(plan)))}>
                    <span className={styles.hint}>{MEAL_LABEL[slot]}</span>
                    <span>
                      <span aria-hidden>{st.icon}</span> {st.label}
                    </span>
                  </button>
                  {plan.kind === 'out' && (
                    <div className={styles.outDetails}>
                      <Segmented label={`${name}: Art`} options={PLACES} value={plan.place ?? ('' as EatingOutPlace)} onChange={(place) => save(setSlot(template, day, slot, { ...plan, place }))} />
                      <Segmented label={`${name}: Größe`} options={SIZES} value={plan.size ?? ('' as EatingOutSize)} onChange={(size) => save(setSlot(template, day, slot, { ...plan, size }))} />
                    </div>
                  )}
                  {day === 0 && (
                    <Button size="sm" variant="ghost" onClick={() => save(copySlot(template, slot, 0, WEEKDAYS.slice(1)), `${MEAL_LABEL[slot]} wie Montag übernommen`)}>
                      Spalte → alle Tage
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <p className={styles.hint}>Das ist deine wiederkehrende Vorlage. Im Wochenplan kannst du einzelne Tage abweichen lassen – die Vorlage bleibt.</p>
    </div>
  );
}
