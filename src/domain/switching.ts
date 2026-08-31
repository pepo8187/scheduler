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

/** A pinned subject whose own siblings hold something better. */
export interface PinRelief {
  subjectCode: string;
  /** The sibling group that would score better. */
  groupId: string;
  /** Points the week would gain back by taking it — always > 0. */
  saves: number;
}

/**
 * What the user's pins are costing them, priced without a second solve.
 *
 * Pinning fights the optimizer by design, and a student who pins three groups can end up with a
 * much worse week and no idea which pin did it. The exact answer — best-with-pins minus
 * best-without — needs a whole extra search, and on the heaviest real export that doubles a
 * fifteen-second solve for a number shown in one line. Measured, not assumed: the bound is
 * dominated by collisions, so even a `topK: 1` baseline solve came back in 14.8 s against the
 * real one's 14.6 s.
 *
 * So this asks the cheap, local question instead: for each pinned subject, is one of its own
 * siblings strictly better *right now*? That is already computed — it is a `switchCosts` entry —
 * and it is a genuine **lower bound** on the pin's cost, since freeing the subject entirely can
 * only do better than this one swap. The UI must say "at least", because it is a floor and not
 * the whole story: un-pinning also lets every other subject move.
 */
export function pinRelief(selection: Selection, costs: Map<string, SwitchCost>): PinRelief[] {
  const relief: PinRelief[] = [];
  for (const [subjectCode, subjectSelection] of Object.entries(selection)) {
    if (!subjectSelection.enabled) continue;
    const pinnedHere = Object.entries(subjectSelection.pinned ?? {}).some(
      ([id, on]) => on && subjectSelection.seminars[id] && !subjectSelection.reclassified[id],
    );
    if (!pinnedHere) continue;

    let best: SwitchCost | undefined;
    for (const cost of costs.values()) {
      if (cost.subjectCode !== subjectCode || cost.collides || cost.delta >= 0) continue;
      if (!best || cost.delta < best.delta) best = cost;
    }
    if (best) relief.push({ subjectCode, groupId: best.groupId, saves: -best.delta });
  }
  return relief.sort((a, b) => b.saves - a.saves || a.subjectCode.localeCompare(b.subjectCode));
}
