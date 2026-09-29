/**
 * Effort of a set – stored ONCE as RPE (6–10, halves allowed), shown to the
 * user as RIR ("Wiederholungen in Reserve"): RIR = 10 − RPE, "4+" = RPE 6 or
 * lower. Both scales describe the same thing, so there is no second field.
 */

/** RIR choices after a set: 0 / 1 / 2 / 3 / 4+ (4 stands for "4 or more"). */
export const RIR_OPTIONS = [0, 1, 2, 3, 4] as const;
export type Rir = (typeof RIR_OPTIONS)[number];

export const rpeFromRir = (rir: Rir): number => 10 - rir;

/** 0 … 4 (4 = "4+"); halves stay halves (RPE 9.5 → RIR 0.5). */
export function rirFromRpe(rpe: number): number {
  return Math.min(4, Math.max(0, Math.round((10 - rpe) * 2) / 2));
}

/** The RIR chip that matches a stored RPE, if it is one of the choices. */
export function rirChoice(rpe: number | undefined): Rir | undefined {
  if (rpe === undefined) return undefined;
  const rir = rirFromRpe(rpe);
  return Number.isInteger(rir) ? (rir as Rir) : undefined;
}

export const rirLabel = (rir: Rir): string => (rir === 4 ? '4+' : String(rir));

/** "RIR 2" / "RIR 0–1" (from RPE 9.5) / "RIR 4+" – for reasons and history. */
export function effortText(rpe: number): string {
  const rir = rirFromRpe(rpe);
  if (rir >= 4) return 'RIR 4+';
  if (!Number.isInteger(rir)) return `RIR ${Math.floor(rir)}–${Math.ceil(rir)}`;
  return `RIR ${rir}`;
}
