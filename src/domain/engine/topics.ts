import { daysBetween } from '../dates';
import type { CoachTopic, ISODate } from '../types';

/**
 * The coach's memory for recurring tips – kept free of heavy imports, so
 * every rule (and the store) can use it without import cycles.
 *
 *   shown on `pauseAfterDays` days while the pattern still holds → pause
 *     `pauseDays`, then come back with another strategy (variant)
 *   the pattern no longer holds after the tip was shown → one "gut umgesetzt"
 *     note, then the topic rests (resolved)
 */
export const TOPIC_RULES = {
  pauseAfterDays: 7,
  pauseDays: 14,
} as const;

export type TopicDecision = { show: true; variant: number } | { show: false; praise?: true };

/** Should a tip of `topic` be shown today, given whether its pattern holds? */
export function topicDecision(topics: Record<string, CoachTopic> | undefined, topic: string, holds: boolean, today: ISODate): TopicDecision {
  const t = topics?.[topic];
  if (!holds) return t?.status === 'active' && t.shownDays > 0 ? { show: false, praise: true } : { show: false };
  if (t?.status === 'paused' && t.since && daysBetween(t.since, today) < TOPIC_RULES.pauseDays) return { show: false };
  return { show: true, variant: t?.variant ?? 0 };
}
