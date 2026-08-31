import { resolveAssignment, scoreResolved } from './score';
import type { Prefs, Selection, Solution, Timetable } from './types';

/**
 * What it would cost to swap one subject's seminar group for another.
 *
 * The grid already draws every enabled-but-unchosen group as a faint "ghost" strip, so the
 * timetable shows what the optimizer passed over. Until now that was all it showed: you could
 * see that PB154/07 exists on Thursday morning and learn nothing about why you didn't get it.
 * The one number that answers that is the score difference — and it is cheap, because switching
 * a single group changes nothing the solver has to search for. Resolve the same assignment with
 * one value replaced, score it, subtract.
 *
 * Deliberately *not* a solve. Re-solving with a group forced would answer a different and much
 * more expensive question ("what is the best week containing this group?"); this answers "what
 * happens to the week I am looking at if I take this instead", which is the question a hover
 * over a specific strip is asking.
 *
 * Dropped lectures carry over untouched: they are derived from days off and lectures alone
 * (`deriveDroppedLectures`), so no seminar choice can change them.
 */
export interface SwitchCost {
  /** The group this would switch to. */
  groupId: string;
  subjectCode: string;
  /** Points the week would gain — positive is worse, 0 is a free swap, negative is better. */
  delta: number;
  /** True when the switch would put a seminar on top of something else. Its own tier: the
   *  penalty dwarfs every comfort term, so the raw delta says little beyond "no". */
  collides: boolean;
}

/** How much attention a ghost deserves. `blocked` is the only one the UI hides away. */
export type SwitchTier = 'free' | 'costly' | 'blocked';

export function switchTier(cost: SwitchCost): SwitchTier {
  if (cost.collides) return 'blocked';
  return cost.delta <= 0 ? 'free' : 'costly';
}

/** The hover line: what taking this group would do to the week, in points. */
export function describeSwitchCost(cost: SwitchCost): string {
  if (cost.collides) return 'would collide with another class';
  const points = Math.round(cost.delta);
  if (points === 0) return 'same score as your current group';
  if (points < 0) return `${points} points — better than your current group`;
  return `+${points} points if you switched to this`;
}

/**
 * Prices every switch available from the displayed solution, keyed by group id.
 *
 * One pass over every enabled, unchosen, non-reclassified group of every enabled subject — a
 * few hundred at most, each a `resolveAssignment` + `scoreResolved`, so it is a `useMemo`'s
 * worth of work rather than a solve's. Reclassified groups are excluded: they are fixed input
 * attended alongside the lecture, not a candidate to switch *to*.
 */
export function switchCosts(
  timetable: Timetable,
  selection: Selection,
  prefs: Prefs,
  solution: Solution,
): Map<string, SwitchCost> {
  const costs = new Map<string, SwitchCost>();
  const { droppedLectures, seminarChoice } = solution.assignment;

  for (const subject of timetable.subjects) {
    const subjectSelection = selection[subject.code];
    if (!subjectSelection?.enabled || subject.seminars.length === 0) continue;
    const chosenId = seminarChoice[subject.code];

    for (const seminar of subject.seminars) {
      if (seminar.id === chosenId) continue;
      if (!subjectSelection.seminars[seminar.id]) continue;
      if (subjectSelection.reclassified[seminar.id]) continue;

      const assignment = {
        seminarChoice: { ...seminarChoice, [subject.code]: seminar.id },
        droppedLectures,
      };
      const { events, overlaps } = resolveAssignment(timetable, selection, assignment);
      const score = scoreResolved(prefs, droppedLectures, events, overlaps);
      costs.set(seminar.id, {
        groupId: seminar.id,
        subjectCode: subject.code,
        delta: score.total - solution.score.total,
        collides: overlaps.some((o) => o.kind === 'seminar'),
      });
    }
  }

  return costs;
}
