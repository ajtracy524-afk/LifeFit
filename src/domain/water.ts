import { weekDays } from './dates';
import { minutesOf } from './schedule';
import type { AppState, ISODate, WaterReminderState } from './types';

/**
 * Water tracking – deliberately tiny: one number per day (ml). A new day has
 * no entry, so it starts at 0 by itself. The goal is a personal tracking
 * value the user sets; LifeFit never states how much someone "must" drink.
 */

export const WATER_QUICK_ML = [250, 500, 750, 1000] as const;
/** Upper bound per day – protects against accidental taps, not a health statement. */
export const WATER_MAX_ML = 10_000;

export function waterOn(state: Pick<AppState, 'water'>, date: ISODate): number {
  return state.water?.[date] ?? 0;
}

/** Adds (or with negative ml removes) water on a draft; never below 0. */
export function addWater(draft: Pick<AppState, 'water'>, date: ISODate, ml: number): void {
  draft.water ??= {};
  const next = Math.min(WATER_MAX_ML, Math.max(0, waterOn(draft, date) + ml));
  if (next === 0) delete draft.water[date];
  else draft.water[date] = next;
}

/**
 * Optional starting value for the goal, offered to the user to adjust:
 * the widespread rule of thumb of about 35 ml per kg body weight, rounded to
 * 250 ml. Shown as "Startwert", never as a recommendation.
 */
export function waterStartValue(weightKg: number | undefined): number | undefined {
  if (!weightKg || weightKg <= 0) return undefined;
  return Math.round((weightKg * 35) / 250) * 250;
}

/** "1,5 L" – water is read in litres. */
export function formatLitres(ml: number): string {
  return `${(ml / 1000).toLocaleString('de-DE', { minimumFractionDigits: ml % 1000 === 0 ? 0 : 1, maximumFractionDigits: 2 })} L`;
}

/** THE rule for "Wasserziel erreicht" – day goals, the week and the progress view read it. Undefined without a goal. */
export function waterGoalReached(state: Pick<AppState, 'water' | 'nutritionProfile'>, date: ISODate): boolean | undefined {
  const goal = state.nutritionProfile?.waterGoalMl;
  return goal ? waterOn(state, date) >= goal : undefined;
}

export interface WaterDay {
  date: ISODate;
  ml: number;
  /** Share of the goal (0 … 1), undefined without a goal. */
  share?: number;
  reached?: boolean;
  /** Days after today – nothing to show yet. */
  future: boolean;
}

/** Water of every day of a week (Mo–So): amount, share of the goal, reached – for "Diese Woche" and the progress view. */
export function waterWeek(state: Pick<AppState, 'water' | 'nutritionProfile'>, week: ISODate, today: ISODate): WaterDay[] {
  const goal = state.nutritionProfile?.waterGoalMl;
  return weekDays(week).map((date) => {
    const ml = waterOn(state, date);
    const reached = waterGoalReached(state, date);
    return { date, ml, future: date > today, ...(goal ? { share: Math.min(1, ml / goal), reached } : {}) };
  });
}

/** Average over the days (up to today) that have a water entry – days without one are unknown, not 0. */
export function waterAverage(days: WaterDay[]): number | undefined {
  const logged = days.filter((d) => !d.future && d.ml > 0);
  return logged.length ? Math.round(logged.reduce((s, d) => s + d.ml, 0) / logged.length) : undefined;
}

/** Simple history: ml per given day. */
export function waterHistory(state: Pick<AppState, 'water'>, dates: ISODate[]): { date: ISODate; ml: number }[] {
  return dates.map((date) => ({ date, ml: waterOn(state, date) }));
}

// ---------- Pace & reminders ----------

/**
 * Water over the day: the goal is spread evenly over the drinking window
 * (breakfast − 30 min … dinner + 90 min, from the user's meal times). A
 * reminder comes only when the user is clearly behind that pace – never when
 * on track or done, never in the first or last hour of the window (no evening
 * catch-up), with pauses after a drink or a reminder, at most a few per day,
 * and with changing wording. One rule for the hint in the app and for
 * notifications.
 */
export const WATER_REMINDER = {
  startBeforeBreakfastMin: 30,
  endAfterDinnerMin: 90,
  /** No reminder in the first and the last hour of the window. */
  quietEdgeMin: 60,
  /** Behind the pace by at least this share of the goal … */
  behindShare: 0.15,
  /** … and at least one glass. */
  minBehindMl: 250,
  /** Pause after a drink. */
  afterDrinkMin: 45,
  /** Pause after a reminder (and length of "Später"). */
  gapMin: 90,
  maxPerDay: 5,
} as const;

export interface WaterPace {
  goal: number;
  ml: number;
  /** What an even spread would have reached by now. */
  expected: number;
  behind: number;
  /** Window in minutes of the day. */
  start: number;
  end: number;
}

type WaterState = Pick<AppState, 'water' | 'nutritionProfile' | 'plannerSettings' | 'coach'>;

export function waterPace(state: WaterState, date: ISODate, nowMin: number): WaterPace | undefined {
  const goal = state.nutritionProfile?.waterGoalMl;
  if (!goal) return undefined;
  const R = WATER_REMINDER;
  const start = minutesOf(state.plannerSettings.mealTimes.breakfast) - R.startBeforeBreakfastMin;
  const end = Math.max(start + 6 * 60, minutesOf(state.plannerSettings.mealTimes.dinner) + R.endAfterDinnerMin);
  const ml = waterOn(state, date);
  const share = Math.min(1, Math.max(0, (nowMin - start) / (end - start)));
  const expected = Math.round(goal * share);
  return { goal, ml, expected, behind: Math.max(0, expected - ml), start, end };
}

/** Today's reminder memory (empty on a new day). */
export function waterReminderState(state: Pick<AppState, 'coach'>, date: ISODate): WaterReminderState {
  const w = state.coach?.water;
  return w && w.date === date ? w : { date };
}

export interface WaterReminder {
  text: string;
  behindMl: number;
}

const minutesSince = (iso: string | undefined, now: Date) => (iso ? (now.getTime() - new Date(iso).getTime()) / 60000 : Number.POSITIVE_INFINITY);

/** Id of today's water reminder as a recommendation – dismissing it ends the reminders for the day. */
export const waterReminderId = (date: ISODate) => `water_pace:${date}`;

/** The reminder due right now – or undefined (on track, done, paused, quiet hours, limit). */
export function waterReminder(state: WaterState, date: ISODate, now: Date): WaterReminder | undefined {
  if ((state.nutritionProfile?.waterReminders ?? 'app') === 'off') return undefined;
  // Hidden for today in "Dein nächster sinnvoller Schritt" – no notification either.
  if (state.coach?.dismissed?.[waterReminderId(date)]) return undefined;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const pace = waterPace(state, date, nowMin);
  if (!pace || pace.ml >= pace.goal) return undefined;
  const R = WATER_REMINDER;
  if (nowMin < pace.start + R.quietEdgeMin || nowMin > pace.end - R.quietEdgeMin) return undefined;
  if (pace.behind < Math.max(R.minBehindMl, pace.goal * R.behindShare)) return undefined;
  const memory = waterReminderState(state, date);
  const sent = memory.sent ?? [];
  if (sent.length >= R.maxPerDay) return undefined;
  if (minutesSince(memory.lastDrinkAt, now) < R.afterDrinkMin) return undefined;
  if (memory.snoozedUntil && now.getTime() < new Date(memory.snoozedUntil).getTime()) return undefined;
  if (minutesSince(sent[sent.length - 1], now) < R.gapMin) return undefined;
  const left = pace.goal - pace.ml;
  const texts = [
    `Zeit für ein Glas Wasser – bisher ${formatLitres(pace.ml)} von ${formatLitres(pace.goal)}.`,
    `Ein Glas zwischendurch hält dich im Takt: noch ${formatLitres(left)} bis zu deinem Ziel.`,
    'Kurze Wasserpause? Über den Tag verteilt ist dein Ziel leichter als am Abend.',
    `${formatLitres(pace.ml)} bisher – ein Glas jetzt bringt dich näher an deinen Tagesplan.`,
    `Wasser nicht vergessen: noch ${formatLitres(left)}, ein Glas sind 250 ml.`,
  ];
  // Different wording with every reminder and time of day – never the same line all day.
  return { text: texts[(sent.length + Math.floor(nowMin / R.gapMin)) % texts.length]!, behindMl: pace.behind };
}
