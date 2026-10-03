import { useMemo, useState } from 'react';
import { CATEGORIES, getFood } from '../../data/foods';
import { atHome, cookableRecipes, cookIngredients } from '../../domain/cookable';
import { formatCostRange, priceLookup, recipeCostRange } from '../../domain/costs';
import { recipeMicros } from '../../domain/nutrition';
import type { ISODate } from '../../domain/types';
import { celebrate } from '../../lib/celebrate';
import { fmt, SLOT_LABEL } from '../../lib/format';
import { withUndo } from '../../lib/undo';
import { matchesQuery } from '../../services/foodDatabase';
import { addPlannedMeal, eatSuggestion } from '../../store/actions';
import { useAppState } from '../../store/store';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Controls';
import { Icon } from '../../components/ui/Icon';
import { Sheet } from '../../components/ui/Sheet';
import { runLog } from './logFeedback';
import { useEnergyText } from './useEnergyText';
import styles from './nutrition.module.css';

/**
 * "Was kann ich kochen?" – tap what is at home (the pantry is preselected),
 * get recipes ranked by fewest missing ingredients, time and open calories
 * (domain/cookable.ts). One tap plans it – missing ingredients land on the
 * shopping list by themselves – or logs it as eaten now.
 */
export function CookSheet({ date, open, onClose }: { date: ISODate; open: boolean; onClose: () => void }) {
  if (!open) return <Sheet open={false} onClose={onClose} title="" children={null} />;
  return <CookSheetInner date={date} onClose={onClose} />;
}

function CookSheetInner({ date, onClose }: { date: ISODate; onClose: () => void }) {
  const state = useAppState();
  const energy = useEnergyText(date);
  const [have, setHave] = useState<Set<string>>(() => new Set(atHome(state)));
  const [filter, setFilter] = useState('');
  const choices = useMemo(() => cookIngredients(state), [state.nutritionProfile]);
  const options = useMemo(() => cookableRecipes(state, date, have), [state, date, have]);
  const price = useMemo(() => priceLookup(state.products), [state.products]);

  const toggle = (id: string) =>
    setHave((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const shown = filter.trim() ? choices.filter((id) => matchesQuery(getFood(id)!.name, filter)) : choices;
  const groups = CATEGORIES.map((c) => ({ ...c, ids: shown.filter((id) => getFood(id)!.category === c.id) })).filter((g) => g.ids.length);

  return (
    <Sheet open onClose={onClose} title="Was kann ich kochen?" subtitle={have.size ? `${have.size} Zutaten zuhause` : 'Wähle, was du zuhause hast'}>
      <p className={styles.searchHint}>Tippe an, was du zuhause hast – dein Vorrat ist schon ausgewählt.</p>
      <label className={styles.search}>
        <Icon name="search" size={18} />
        <span className="visually-hidden">Zutat filtern</span>
        <input type="search" placeholder="Zutat filtern, z. B. Eier" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </label>
      <div className={styles.cookChoices} aria-label="Zutaten zuhause">
        {groups.map((g) => (
          <div key={g.id}>
            <p className={styles.fieldLabel}>{g.label}</p>
            <div className={styles.chipRow}>
              {g.ids.map((id) => (
                <Chip key={id} selected={have.has(id)} onClick={() => toggle(id)}>
                  {getFood(id)!.name}
                </Chip>
              ))}
            </div>
          </div>
        ))}
      </div>

      <h3 className={styles.listCaption}>Passende Rezepte</h3>
      {!have.size ? (
        <p className={styles.searchHint}>Wähle mindestens eine Zutat.</p>
      ) : !options.length ? (
        <p className={styles.searchHint}>Mit diesen Zutaten passt kein Rezept zu deinen Vorlieben – wähle weitere.</p>
      ) : (
        <ul className={styles.cookList} aria-label="Passende Rezepte">
          {options.map((o) => {
            const cost = recipeCostRange(o.recipe, o.servings, price);
            return (
              <li key={o.recipe.id} className={styles.cookItem}>
                <span className={styles.mealEmoji} aria-hidden>
                  {o.recipe.emoji}
                </span>
                <span className={styles.mealText}>
                  <span className={styles.mealTitle}>{o.recipe.title}</span>
                  <span className={o.missing.length ? styles.cookMissing : styles.cookAll}>
                    {o.missing.length
                      ? `${o.have.length} von ${o.have.length + o.missing.length} Zutaten da · fehlt: ${o.missing.map((id) => getFood(id)?.name ?? id).join(', ')}`
                      : 'Alle Zutaten da ✓'}
                  </span>
                  <span className={styles.mealMeta}>
                    {[energy.kcal(o.macros.kcal), `${fmt.int(o.macros.protein)} g Protein`, `${o.recipe.prepMin} min${o.fitsTime ? '' : ' (länger als heute geplant)'}`, cost && formatCostRange(cost)].filter(Boolean).join(' · ')}
                  </span>
                  {o.because.map((b) => (
                    <span key={b} className={styles.cookAll}>
                      {b}
                    </span>
                  ))}
                </span>
                <span className={styles.cookActions}>
                  <Button
                    size="sm"
                    variant="secondary"
                    className={styles.tapTarget}
                    onClick={() => {
                      if (withUndo(`${o.recipe.title} für ${SLOT_LABEL[o.slot]} eingeplant`, () => !!addPlannedMeal(date, o.slot, o.recipe.id, o.servings))) {
                        celebrate({ kind: 'check', icon: '✓', title: 'Eingeplant', detail: o.missing.length ? `${o.missing.length} Zutat${o.missing.length === 1 ? '' : 'en'} auf der Einkaufsliste` : 'Alles zuhause', level: 1 });
                      }
                      onClose();
                    }}
                  >
                    Einplanen
                  </Button>
                  <Button
                    size="sm"
                    icon="check"
                    className={styles.tapTarget}
                    onClick={() => {
                      runLog(date, `${o.recipe.title} erfasst`, { macros: o.macros, micros: recipeMicros(o.recipe, o.servings) }, () => eatSuggestion(date, o.slot, o.recipe.id, o.servings));
                      onClose();
                    }}
                  >
                    Gegessen
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
