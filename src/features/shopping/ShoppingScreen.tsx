import { useMemo, useState, type FormEvent } from 'react';
import { addDays, isoWeekNumber, today, weekStart } from '../../domain/dates';
import { groupByCategory, shoppingRange, type ShoppingListItem } from '../../domain/shopping';
import { pantryEstimate, weekShopping } from '../../domain/week';
import { formatGrams, relativeDay, SLOT_LABEL } from '../../lib/format';
import { href, navigate, useRoute } from '../../lib/router';
import { showToast } from '../../lib/toast';
import { applyWithUndo, withUndo } from '../../lib/undo';
import { addManualItem, removeManualItem, setShoppingStatus, toggleManualItem } from '../../store/actions';
import { useAppState } from '../../store/store';
import { Screen, Section } from '../../components/Screen';
import { Button, IconButton } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field, Segmented, parseNumber } from '../../components/ui/Controls';
import { EmptyState } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/Icon';
import { ProgressBar } from '../../components/ui/Progress';
import { Sheet } from '../../components/ui/Sheet';
import styles from './shopping.module.css';

export function ShoppingScreen() {
  const state = useAppState();
  const { params } = useRoute();
  const thisWeek = weekStart(today());
  const week = params.get('week') ?? thisWeek;
  const t = today();
  const { from, to } = shoppingRange(week, t);
  const weekState = state.shopping[week] ?? { purchased: {}, manual: [] };

  // Derived: plan need minus pantry and purchases – no stored status.
  const items = useMemo(() => weekShopping(state, week, t), [state, week, t]);
  const open = items.filter((i) => i.state === 'open');
  const checked = items.filter((i) => i.state === 'checked');
  const have = items.filter((i) => i.state === 'have');
  const manualOpen = weekState.manual.filter((m) => !m.checked);
  const manualDone = weekState.manual.filter((m) => m.checked);

  const total = items.length + weekState.manual.length;
  const remaining = open.length + manualOpen.length;
  const [detail, setDetail] = useState<ShoppingListItem | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [draft, setDraft] = useState('');

  const setWeek = (w: string) => navigate('shopping', w === thisWeek ? undefined : { week: w }, { replace: true });

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    addManualItem(week, draft);
    setDraft('');
  };

  const share = async () => {
    const lines = [...open.map((i) => `• ${i.name} – ${i.quantity}`), ...manualOpen.map((m) => `• ${m.name}`)];
    const text = `Einkaufsliste\n${lines.join('\n')}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Einkaufsliste', text });
      else {
        await navigator.clipboard.writeText(text);
        showToast('Liste in die Zwischenablage kopiert');
      }
    } catch (err) {
      if ((err as DOMException)?.name !== 'AbortError') showToast('Teilen ist gerade nicht möglich.', { tone: 'error' });
    }
  };

  return (
    <Screen
      title="Einkauf"
      actions={remaining > 0 && <IconButton icon="share" label="Liste teilen" onClick={share} />}
      toolbar={
        <Segmented
          label="Zeitraum"
          value={week}
          onChange={setWeek}
          options={[
            { value: thisWeek, label: 'Diese Woche' },
            { value: addDays(thisWeek, 7), label: 'Nächste Woche' },
            ...(week !== thisWeek && week !== addDays(thisWeek, 7) ? [{ value: week, label: `KW ${isoWeekNumber(week)}` }] : []),
          ]}
        />
      }
    >
      {total > 0 && (
        <div className={styles.summary}>
          <div className={styles.summaryText}>
            <strong>{remaining === 0 ? 'Alles erledigt' : `${remaining} von ${total} offen`}</strong>
            <span>
              {relativeDay(from)} bis {relativeDay(to)}
            </span>
          </div>
          <ProgressBar value={total - remaining} max={total} label="Einkaufsfortschritt" />
        </div>
      )}

      <form className={styles.addForm} onSubmit={add}>
        <Icon name="plus" size={20} />
        <label className="visually-hidden" htmlFor="shopping-add">
          Eigenen Artikel hinzufügen
        </label>
        <input id="shopping-add" placeholder="Eigenen Artikel hinzufügen" value={draft} onChange={(e) => setDraft(e.target.value)} enterKeyHint="done" />
        {draft && (
          <Button size="sm" type="submit">
            Hinzufügen
          </Button>
        )}
      </form>

      {items.length === 0 && weekState.manual.length === 0 ? (
        <Card>
          <EmptyState
            emoji="🛒"
            title="Deine Liste ist leer"
            text="Plane deine Mahlzeiten – alle Zutaten landen dann automatisch hier, zusammengefasst und nach Supermarkt sortiert."
            action={<Button onClick={() => navigate('nutrition', { view: 'week', date: week === thisWeek ? undefined : week })}>Woche planen</Button>}
          />
        </Card>
      ) : remaining === 0 ? (
        <Card tone="accent">
          <EmptyState compact emoji="✅" title="Alles eingekauft" text="Deine Woche kann kommen." />
        </Card>
      ) : null}

      {manualOpen.length > 0 && (
        <Section title="Eigene Artikel">
          <Card padded={false}>
            {manualOpen.map((m) => (
              <div key={m.id} className={styles.row}>
                <button type="button" className={styles.rowMain} onClick={() => toggleManualItem(week, m.id)}>
                  <span className={styles.box} aria-hidden />
                  <span className={styles.name}>{m.name}</span>
                </button>
                <IconButton icon="trash" label={`${m.name} entfernen`} onClick={() => withUndo(`${m.name} entfernt`, () => removeManualItem(week, m.id))} />
              </div>
            ))}
          </Card>
        </Section>
      )}

      {groupByCategory(open).map((group) => (
        <Section key={group.id} title={group.label}>
          <Card padded={false}>
            {group.items.map((item) => (
              <ItemRow key={item.foodId} item={item} onToggle={() => setShoppingStatus(week, item.foodId, 'checked')} onDetail={() => setDetail(item)} />
            ))}
          </Card>
        </Section>
      ))}

      {(checked.length > 0 || manualDone.length > 0 || have.length > 0) && (
        <Section>
          <button type="button" className={styles.doneToggle} onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
            <Icon name={showDone ? 'chevronDown' : 'chevronRight'} size={16} />
            Erledigt ({checked.length + manualDone.length}){have.length > 0 && ` · Hab ich schon (${have.length})`}
          </button>
          {showDone && (
            <Card padded={false}>
              {checked.map((item) => (
                <ItemRow key={item.foodId} item={item} done onToggle={() => setShoppingStatus(week, item.foodId, null)} onDetail={() => setDetail(item)} />
              ))}
              {manualDone.map((m) => (
                <div key={m.id} className={`${styles.row} ${styles.rowDone}`}>
                  <button type="button" className={styles.rowMain} onClick={() => toggleManualItem(week, m.id)}>
                    <span className={styles.boxDone} aria-hidden>
                      <Icon name="check" size={14} strokeWidth={2.8} />
                    </span>
                    <span className={styles.name}>{m.name}</span>
                  </button>
                </div>
              ))}
              {have.map((item) => (
                <ItemRow key={item.foodId} item={item} done haveLabel onToggle={() => setShoppingStatus(week, item.foodId, null)} onDetail={() => setDetail(item)} />
              ))}
            </Card>
          )}
        </Section>
      )}

      <Sheet open={!!detail} onClose={() => setDetail(null)} title={detail?.name ?? ''} subtitle={detail ? `${detail.quantity}${detail.hint ? ` · ${detail.hint}` : ''}` : undefined}>
        {detail && (
          <>
            {detail.sources.length > 0 && (
              <>
                <p className={styles.detailCaption}>Wird gebraucht für</p>
                <ul className={styles.sourceList}>
                  {detail.sources.map((s, i) => (
                    <li key={`${s.mealId}-${i}`}>
                      <a href={href('nutrition', { view: 'day', date: s.date })} onClick={() => setDetail(null)}>
                        <span>
                          <strong>{s.recipeTitle}</strong>
                          <span className={styles.muted}>
                            {relativeDay(s.date)} · {SLOT_LABEL[s.slot]}
                          </span>
                        </span>
                        <span className={styles.muted}>{formatGrams(s.grams)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {detail.restockMinG !== undefined && (
              <p className={styles.detailCaption}>Grundvorrat: mindestens {formatGrams(detail.restockMinG)} im Haus</p>
            )}
            <PantryEditor key={detail.foodId} foodId={detail.foodId} name={detail.name} onDone={() => setDetail(null)} />
            <div className={styles.detailActions}>
              {detail.restockG ? (
                <Button
                  variant="secondary"
                  block
                  onClick={() => {
                    if (applyWithUndo({ type: 'skipRestock', week, foodId: detail.foodId })) setDetail(null);
                  }}
                >
                  Diese Woche nicht nachkaufen
                </Button>
              ) : null}
              {detail.sources.length === 0 ? null : detail.state === 'have' ? (
                <Button
                  variant="secondary"
                  block
                  onClick={() => {
                    setShoppingStatus(week, detail.foodId, null);
                    setDetail(null);
                  }}
                >
                  Wieder auf die Liste
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  block
                  onClick={() => {
                    withUndo(`${detail.name}: hast du schon`, () => setShoppingStatus(week, detail.foodId, 'have'));
                    setDetail(null);
                  }}
                >
                  Hab ich schon zu Hause
                </Button>
              )}
            </div>
          </>
        )}
      </Sheet>
    </Screen>
  );
}

/**
 * F2: the pantry amount is an estimate – here the user corrects it. Goes
 * through the cascade: shopping is recomputed, the plan stays, undo works.
 */
function PantryEditor({ foodId, name, onDone }: { foodId: string; name: string; onDone: () => void }) {
  const state = useAppState();
  const current = pantryEstimate(state)[foodId] ?? 0;
  const [value, setValue] = useState(current ? String(current) : '');
  const grams = parseNumber(value);
  const valid = value.trim() === '' || (Number.isFinite(grams) && grams >= 0 && grams <= 20000);

  const save = (quantityG: number | null) => {
    if (applyWithUndo({ type: 'setPantry', foodId, quantityG })) onDone();
  };

  return (
    <div className={styles.pantry}>
      <p className={styles.detailCaption}>Vorrat{current ? ` · ca. ${formatGrams(current)} da` : ' · nichts erfasst'}</p>
      <div className={styles.pantryRow}>
        <Field
          label={`${name} im Vorrat`}
          inputMode="numeric"
          suffix="g"
          placeholder="0"
          value={value}
          error={valid ? undefined : 'Bitte eine Menge in Gramm angeben.'}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button variant="secondary" disabled={!valid} onClick={() => save(value.trim() === '' ? null : Math.round(grams))}>
          Speichern
        </Button>
      </div>
      {current > 0 && (
        <button type="button" className={styles.pantryEmpty} onClick={() => save(0)}>
          Ist aufgebraucht
        </button>
      )}
    </div>
  );
}

interface ItemRowProps {
  item: ShoppingListItem;
  done?: boolean;
  haveLabel?: boolean;
  onToggle: () => void;
  onDetail: () => void;
}

function ItemRow({ item, done, haveLabel, onToggle, onDetail }: ItemRowProps) {
  const mealCount = new Set(item.sources.map((s) => s.mealId)).size;
  return (
    <div className={done ? `${styles.row} ${styles.rowDone}` : styles.row}>
      <button
        type="button"
        className={styles.rowMain}
        onClick={() => {
          onToggle();
          if (!done) navigator.vibrate?.(8);
        }}
        aria-pressed={!!done}
      >
        <span className={done ? styles.boxDone : styles.box} aria-hidden>
          {done && <Icon name="check" size={14} strokeWidth={2.8} />}
        </span>
        <span className={styles.nameBlock}>
          <span className={styles.name}>{item.name}</span>
          <span className={styles.qty}>
            {haveLabel ? 'Hab ich schon' : item.quantity}
            {!haveLabel && item.hint && <span className={styles.hint}> · {item.hint}</span>}
            {!haveLabel && item.restockG ? (
              <span className={styles.hint}>{item.sources.length ? ' · inkl. Vorrat auffüllen' : ' · Nachkauf – Vorrat niedrig'}</span>
            ) : null}
          </span>
        </span>
      </button>
      <button type="button" className={styles.sourceBtn} onClick={onDetail} aria-label={`Wofür wird ${item.name} gebraucht?`}>
        {mealCount}× <Icon name="info" size={14} />
      </button>
    </div>
  );
}
