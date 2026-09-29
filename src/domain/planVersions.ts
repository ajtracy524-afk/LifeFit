import { findTemplate, getExercise, getProgram } from '../data/exercises';
import { weekdayShort } from '../lib/format';
import { addDays, fromISODate, today as todayISO } from './dates';
import { isOwnProgramId } from './trainingPersonal';
import type { AppState, ISODate, PlanChangeReason, PlanVersion, TemplateExercise, WorkoutTemplate } from './types';

/**
 * Plan versions – the training plan's history for "Was hat sich geändert /
 * Warum". A version is written only when the plan really changes (program,
 * training days, the exercises of its sessions); several changes on one day
 * are one version. The end of a version is derived from the next one, never
 * stored. Older data without versions gets a derived v1 – nothing breaks,
 * and scheduling never reads from here.
 */

export type PlanSnapshot = Pick<PlanVersion, 'programId' | 'programName' | 'weekdays' | 'sessions'>;

type PlanSource = Pick<AppState, 'training' | 'routines' | 'customPrograms'>;

/** Sessions of a program, resolved from the given state (own routines / programs too – also inside a draft). */
function sessionsOf(s: PlanSource, programId: string): { name: string; sessions: WorkoutTemplate[] } | undefined {
  if (isOwnProgramId(programId)) {
    const p = s.customPrograms[programId];
    if (!p) return undefined;
    const sessions = p.routineIds
      .map((id) => {
        const r = s.routines[id];
        return r ? { id: r.id, name: r.name, focus: r.focus, exercises: r.exercises } : findTemplate(id);
      })
      .filter((t): t is WorkoutTemplate => !!t);
    return { name: p.name, sessions };
  }
  const p = getProgram(programId);
  return p ? { name: p.name, sessions: p.templates } : undefined;
}

export function planSnapshot(s: PlanSource): PlanSnapshot | undefined {
  if (!s.training) return undefined;
  const resolved = sessionsOf(s, s.training.programId);
  return {
    programId: s.training.programId,
    programName: resolved?.name ?? 'Programm',
    weekdays: [...s.training.weekdays].sort((a, b) => a - b),
    sessions: (resolved?.sessions ?? []).map((t) => ({ id: t.id, name: t.name, focus: t.focus, exercises: structuredClone(t.exercises) })),
  };
}

const planKey = (x: PlanSnapshot) =>
  JSON.stringify([x.programId, x.weekdays, x.sessions.map((t) => [t.id, t.exercises.map((e) => [e.exerciseId, e.sets, e.repMin, e.repMax, e.durationMin ?? 0])])]);

/** Where v1 starts for data without versions: the program start, else the first workout, else today. */
function baselineDate(s: Pick<AppState, 'training' | 'workouts'>, fallback: ISODate): ISODate {
  if (s.training?.startedAt) return s.training.startedAt;
  const first = s.workouts.map((w) => w.date).sort()[0];
  return first && first < fallback ? first : fallback;
}

/** Call inside `update` BEFORE a plan change: freezes the plan as it was, if it has no version yet. */
export function ensurePlanBaseline(s: AppState, date: ISODate = todayISO()): void {
  if (s.planVersions?.length) return;
  const snap = planSnapshot(s);
  if (!snap) return;
  const from = baselineDate(s, date);
  s.planVersions = [{ id: `plan:${from}`, validFrom: from, reason: 'start', ...snap }];
}

/**
 * Call inside `update` AFTER a possible plan change: writes a new version when
 * the plan differs from the current one. Same day → the day's version is
 * updated (and dropped when the plan is back to the one before). Returns
 * whether anything was written.
 */
export function recordPlanVersion(s: AppState, reason: PlanChangeReason, date: ISODate = todayISO(), why?: string): boolean {
  const snap = planSnapshot(s);
  if (!snap) return false;
  const list = [...(s.planVersions ?? [])];
  const current = list[list.length - 1];
  if (current && planKey(current) === planKey(snap)) return false;
  if (current && current.validFrom >= date) {
    const before = list[list.length - 2];
    if (before && planKey(before) === planKey(snap)) list.pop();
    // The first version of a plan stays its "Start", even when adjusted on day one.
    else list[list.length - 1] = { id: current.id, validFrom: current.validFrom, reason: current.reason === 'start' ? 'start' : reason, ...snap, ...(why ? { why } : {}) };
  } else {
    list.push({ id: `plan:${date}`, validFrom: date, reason: current ? reason : 'start', ...snap, ...(why ? { why } : {}) });
  }
  s.planVersions = list;
  return true;
}

export interface PlanVersionView extends PlanVersion {
  number: number;
  /** Last day of this version; undefined for the current one. */
  validTo?: ISODate;
  current: boolean;
}

/** All versions, oldest first ("v1 · 01.10.–28.10.", "v2 · seit 29.10."). Without stored versions: one derived v1. */
export function planVersions(s: AppState): PlanVersionView[] {
  let list: PlanVersion[] = s.planVersions ?? [];
  if (!list.length) {
    const snap = planSnapshot(s);
    const from = baselineDate(s, todayISO());
    list = snap ? [{ id: `plan:${from}`, validFrom: from, reason: 'start', ...snap }] : [];
  }
  return list.map((v, i) => {
    const next = list[i + 1];
    return { ...v, number: i + 1, current: !next, ...(next ? { validTo: addDays(next.validFrom, -1) } : {}) };
  });
}

/** The version that was valid on a day (undefined before the first one). */
export function planVersionAt(s: AppState, date: ISODate): PlanVersionView | undefined {
  return planVersions(s)
    .filter((v) => v.validFrom <= date)
    .pop();
}

const shortDate = (iso: ISODate) => {
  const d = fromISODate(iso);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`;
};

/** "v1 · 01.10.–28.10." / "v2 · seit 29.10." */
export function planVersionLabel(v: Pick<PlanVersionView, 'number' | 'validFrom' | 'validTo'>): string {
  return `v${v.number} · ${v.validTo ? `${shortDate(v.validFrom)}–${shortDate(v.validTo)}` : `seit ${shortDate(v.validFrom)}`}`;
}

export const PLAN_REASON_LABEL: Record<PlanChangeReason, string> = {
  start: 'Start',
  program: 'Programm gewechselt',
  days: 'Trainingstage geändert',
  sessions: 'Einheiten angepasst',
  coach: 'Vorschlag des Coachs übernommen',
};

const exName = (id: string) => getExercise(id)?.name ?? id;
const days = (d: number[]) => d.map(weekdayShort).join(', ') || '–';
const dose = (e: TemplateExercise) => (e.durationMin ? `${e.sets} × ${e.durationMin} min` : `${e.sets} × ${e.repMin === e.repMax ? e.repMin : `${e.repMin}–${e.repMax}`}`);

/** What changed from one version to the next – short German lines, read only from the two snapshots. */
export function diffPlans(a: PlanSnapshot, b: PlanSnapshot): string[] {
  const out: string[] = [];
  if (a.programId !== b.programId) out.push(`Programm: ${a.programName} → ${b.programName}`);
  if (days(a.weekdays) !== days(b.weekdays)) out.push(`Trainingstage: ${days(a.weekdays)} → ${days(b.weekdays)}`);
  // A new program changes every session – listing them would only be noise.
  if (a.programId !== b.programId) return out;
  for (const t of b.sessions) {
    const old = a.sessions.find((x) => x.id === t.id);
    if (!old) {
      out.push(`Neue Einheit: ${t.name}`);
      continue;
    }
    for (const e of t.exercises) {
      const o = old.exercises.find((x) => x.exerciseId === e.exerciseId);
      if (!o) out.push(`${t.name}: ${exName(e.exerciseId)} neu (${dose(e)})`);
      else if (dose(o) !== dose(e)) out.push(`${t.name}: ${exName(e.exerciseId)} ${dose(o)} → ${dose(e)}`);
    }
    for (const o of old.exercises) if (!t.exercises.some((e) => e.exerciseId === o.exerciseId)) out.push(`${t.name}: ${exName(o.exerciseId)} entfernt`);
  }
  for (const o of a.sessions) if (!b.sessions.some((t) => t.id === o.id)) out.push(`Einheit entfernt: ${o.name}`);
  return out;
}
