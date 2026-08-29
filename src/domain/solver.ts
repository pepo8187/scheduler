import { slotDuringLunch } from './lunch';
import { eventsOverlap } from './overlap';
import { resolveAssignment, scoreResolved, WEIGHTS } from './score';
import type { Assignment, CourseEvent, Day, LunchPrefs, Prefs, Selection, Solution, Timetable } from './types';

export interface SolveOptions {
  /** How many best solutions to keep for the alternatives strip. */
  topK?: number;
  /** DFS node budget before falling back to randomised local search. */
  nodeBudget?: number;
  /** Injectable RNG so the fallback path is deterministic in tests. */
  random?: () => number;
}

export interface SolveResult {
  /** Best-first; length <= topK. Never empty once at least the empty assignment exists. */
  solutions: Solution[];
  /** False once the node budget was exceeded — result is "best found", not proven optimal. */
  provenOptimal: boolean;
}

interface VariableValue {
  /** The seminar CourseEvent this domain value picks, or null for "no seminar chosen". */
  event: CourseEvent | null;
  /** Collisions against the fixed (always-present) lectures of *other* subjects — constant
   *  for the whole search, precomputed once so the DFS never recomputes it per node. */
  fixedCollisions: number;
}

interface Variable {
  subjectCode: string;
  domain: VariableValue[];
}

/**
 * Non-★ lectures are dropped exactly when a day off touches them — this is the only
 * situation the plan ever exercises the keep/drop choice for, so it is derived rather
 * than searched. ★ lectures are never dropped: a day off blocked by one is caught
 * earlier, in analysis.ts, before the solver ever runs.
 */
export function deriveDroppedLectures(timetable: Timetable, selection: Selection, daysOff: Day[]): Set<string> {
  const dropped = new Set<string>();
  for (const subject of timetable.subjects) {
    const subjectSelection = selection[subject.code];
    if (!subjectSelection?.enabled) continue;
    for (const lecture of subject.lectures) {
      const lectureSelection = subjectSelection.lectures[lecture.id];
      if (!lectureSelection?.enabled || lectureSelection.required) continue;
      if (lecture.slots.some((slot) => daysOff.includes(slot.day))) dropped.add(lecture.id);
    }
  }
  return dropped;
}

function fixedLectures(timetable: Timetable, selection: Selection, dropped: Set<string>): CourseEvent[] {
  const events: CourseEvent[] = [];
  for (const subject of timetable.subjects) {
    const subjectSelection = selection[subject.code];
    if (!subjectSelection?.enabled) continue;
    for (const lecture of subject.lectures) {
      if (!subjectSelection.lectures[lecture.id]?.enabled) continue;
      if (dropped.has(lecture.id)) continue;
      events.push(lecture);
    }
  }
  return events;
}

/** Same day/time signature for every slot, order-independent — groups sharing one are
 *  interchangeable for search purposes (the score never looks at who teaches a group). */
function slotSignature(event: CourseEvent): string {
  return event.slots
    .map((s) => `${s.day}:${s.start}-${s.end}`)
    .sort()
    .join(',');
}

/**
 * Upfront domain construction. Folds in everything that's constant for the whole search, so
 * none of it has to be recomputed per DFS node:
 *  - hard filtering (day off / lunch),
 *  - collapsing groups that meet at the exact same day/time into a single representative
 *    (real exports routinely have many — e.g. one lab slot taught by several TAs),
 *  - forward checking against the fixed (always-present) lectures of *other* subjects: a
 *    value that collides with one is dropped whenever the same variable has a clean
 *    alternative, since a clean option always strictly dominates a colliding one here
 *    (its collision penalty alone outweighs any comfort-term difference) regardless of what
 *    the rest of the search does. Own-subject lectures are excluded from this check, same
 *    as `findOverlaps`: only one of a subject's groups is ever selected, so a lecture
 *    overlapping its own subject's group is never actually penalised.
 * Surviving values are ordered by ascending fixed-collision count so the branch-and-bound in
 * `solve` finds a strong incumbent — and starts pruning — as early as possible.
 */
function buildVariables(
  timetable: Timetable,
  selection: Selection,
  daysOff: Day[],
  lunch: LunchPrefs,
  fixed: CourseEvent[],
): Variable[] {
  const variables: Variable[] = [];
  for (const subject of timetable.subjects) {
    const subjectSelection = selection[subject.code];
    if (!subjectSelection?.enabled || subject.seminars.length === 0) continue;

    const enabledGroups = subject.seminars.filter((s) => subjectSelection.seminars[s.id]);
    const survivors = enabledGroups.filter(
      (s) => !s.slots.some((slot) => daysOff.includes(slot.day) || slotDuringLunch(slot, lunch)),
    );

    if (survivors.length === 0) {
      // Never an empty domain: no usable group means "lecture only", not failure.
      variables.push({ subjectCode: subject.code, domain: [{ event: null, fixedCollisions: 0 }] });
      continue;
    }

    const otherFixed = fixed.filter((f) => f.subjectCode !== subject.code);

    const bySignature = new Map<string, CourseEvent>();
    for (const group of survivors) {
      const sig = slotSignature(group);
      const existing = bySignature.get(sig);
      if (!existing || group.id < existing.id) bySignature.set(sig, group); // deterministic representative
    }

    const withCollisions: VariableValue[] = [...bySignature.values()].map((event) => ({
      event,
      fixedCollisions: otherFixed.reduce((n, f) => n + (eventsOverlap(f, event) ? 1 : 0), 0),
    }));
    const clean = withCollisions.filter((v) => v.fixedCollisions === 0);
    const domain = (clean.length > 0 ? clean : withCollisions).sort(
      (a, b) => a.fixedCollisions - b.fixedCollisions || a.event!.id.localeCompare(b.event!.id),
    );

    variables.push({ subjectCode: subject.code, domain });
  }
  // MRV: most-constrained variables first, so bad branches are pruned early.
  return variables.sort((a, b) => a.domain.length - b.domain.length);
}

function latestFinish(events: CourseEvent[]): number {
  let max = 0;
  for (const event of events) for (const slot of event.slots) max = Math.max(max, slot.end);
  return max;
}

function assignmentKey(assignment: Assignment): string {
  return Object.keys(assignment.seminarChoice)
    .sort()
    .map((code) => `${code}=${assignment.seminarChoice[code] ?? '-'}`)
    .join('|');
}

/** Deterministic tie-break: lowest score, then earliest finish, then lexicographic groups. */
function compareSolutions(a: Solution, b: Solution): number {
  if (a.score.total !== b.score.total) return a.score.total - b.score.total;
  const finishDiff = latestFinish(a.events) - latestFinish(b.events);
  if (finishDiff !== 0) return finishDiff;
  return assignmentKey(a.assignment).localeCompare(assignmentKey(b.assignment));
}

function buildSolution(
  timetable: Timetable,
  selection: Selection,
  prefs: Prefs,
  droppedLectures: Set<string>,
  choice: Record<string, string | null>,
): Solution {
  const assignment: Assignment = { seminarChoice: choice, droppedLectures };
  const { events, overlaps } = resolveAssignment(timetable, selection, assignment);
  const score = scoreResolved(prefs, droppedLectures, events, overlaps);
  return { assignment, events, overlaps, score };
}

/** Skips the push/sort/truncate for a candidate that provably can't make the cut. */
function insertRanked(best: Solution[], solution: Solution, topK: number): void {
  if (best.length >= topK && compareSolutions(solution, best[topK - 1]!) >= 0) return;
  best.push(solution);
  best.sort(compareSolutions);
  if (best.length > topK) best.length = topK;
}

function randomChoiceOf(variables: Variable[], random: () => number): Record<string, string | null> {
  const choice: Record<string, string | null> = {};
  for (const variable of variables) {
    const value = variable.domain[Math.floor(random() * variable.domain.length)]!;
    choice[variable.subjectCode] = value.event?.id ?? null;
  }
  return choice;
}

function randomizedFallback(
  timetable: Timetable,
  selection: Selection,
  prefs: Prefs,
  variables: Variable[],
  droppedLectures: Set<string>,
  best: Solution[],
  topK: number,
  random: () => number,
  iterations: number,
): void {
  let current = randomChoiceOf(variables, random);
  let currentSolution = buildSolution(timetable, selection, prefs, droppedLectures, current);
  insertRanked(best, currentSolution, topK);

  for (let i = 0; i < iterations && variables.length > 0; i++) {
    const candidate = { ...current };
    const variable = variables[Math.floor(random() * variables.length)]!;
    const value = variable.domain[Math.floor(random() * variable.domain.length)]!;
    candidate[variable.subjectCode] = value.event?.id ?? null;

    const candidateSolution = buildSolution(timetable, selection, prefs, droppedLectures, candidate);
    insertRanked(best, candidateSolution, topK);

    if (candidateSolution.score.total <= currentSolution.score.total) {
      current = candidate;
      currentSolution = candidateSolution;
    } else if (random() < 0.02) {
      // Occasional restart so the walk doesn't get stuck in a local optimum.
      current = randomChoiceOf(variables, random);
      currentSolution = buildSolution(timetable, selection, prefs, droppedLectures, current);
      insertRanked(best, currentSolution, topK);
    }
  }
}

/**
 * Exhaustive DFS with MRV ordering, forward checking and group-collapsing baked into the
 * domain up front (see `buildVariables`), branch-and-bound pruning, and a bounded top-K.
 * The decision space is one variable per enabled subject-with-seminars (which group, or
 * none); ★ lectures and seminar-less subjects are fixed input placed before the search
 * begins, and non-★ lecture drops are derived, not searched (see deriveDroppedLectures).
 *
 * The bound: every score term is non-negative (never a discount for attending more), and a
 * subject's own collision count can only grow as more variables are assigned — so
 * `collisionsSoFar * seminarCollisionPerPair + droppedLectureCost` is a valid lower bound on
 * any completion reachable from the current node, regardless of how the comfort terms
 * (compactness, gaps, day window, max/day) end up moving once the rest of the assignment is
 * filled in. Once the top-K list is full, a branch whose bound already exceeds the current
 * worst-of-top-K can be skipped outright — and because seminarCollisionPerPair dwarfs every
 * comfort weight, a single stray collision is usually enough to prune a whole subtree.
 *
 * For the documented scale (tens of combinations for a normal semester) this always
 * completes well under the node budget and the result is provably optimal; past the budget
 * it falls back to randomised local search and is labelled "best found — not proven
 * optimal".
 */
export function solve(timetable: Timetable, selection: Selection, prefs: Prefs, options: SolveOptions = {}): SolveResult {
  const topK = options.topK ?? 10;
  const nodeBudget = options.nodeBudget ?? 2_000_000;
  const random = options.random ?? Math.random;

  const droppedLectures = deriveDroppedLectures(timetable, selection, prefs.daysOff);
  const fixed = fixedLectures(timetable, selection, droppedLectures);
  const variables = buildVariables(timetable, selection, prefs.daysOff, prefs.lunch, fixed);
  const droppedLectureCost = droppedLectures.size * WEIGHTS.droppedLecturePerEvent;

  const best: Solution[] = [];
  const chosen: (CourseEvent | null)[] = new Array(variables.length).fill(null);
  let nodes = 0;
  let budgetExceeded = false;

  function dfs(index: number, collisionsSoFar: number): void {
    if (budgetExceeded) return;
    nodes++;
    if (nodes > nodeBudget) {
      budgetExceeded = true;
      return;
    }

    if (index === variables.length) {
      const choice: Record<string, string | null> = {};
      for (let i = 0; i < variables.length; i++) choice[variables[i]!.subjectCode] = chosen[i]?.id ?? null;
      insertRanked(best, buildSolution(timetable, selection, prefs, droppedLectures, choice), topK);
      return;
    }

    const variable = variables[index]!;
    for (const value of variable.domain) {
      let collisions = value.fixedCollisions;
      if (value.event) {
        for (let j = 0; j < index; j++) {
          const prior = chosen[j];
          if (prior && eventsOverlap(prior, value.event)) collisions++;
        }
      }
      const total = collisionsSoFar + collisions;

      // Admissible lower bound: every completion from here costs at least this much, so a
      // bound that already beats the current worst-of-top-K can never improve on it, not
      // even as a tie (a genuine tie would need bound === worst, not >).
      if (best.length >= topK && total * WEIGHTS.seminarCollisionPerPair + droppedLectureCost > best[topK - 1]!.score.total) {
        continue;
      }

      chosen[index] = value.event;
      dfs(index + 1, total);
      if (budgetExceeded) return;
    }
  }

  dfs(0, 0);

  if (budgetExceeded) {
    const iterations = Math.min(20_000, Math.max(200, Math.floor(nodeBudget / 100)));
    randomizedFallback(timetable, selection, prefs, variables, droppedLectures, best, topK, random, iterations);
  }

  return { solutions: best, provenOptimal: !budgetExceeded };
}
