import { slotDuringLunch } from './lunch';
import { eventsOverlap } from './overlap';
import { asLecture } from './reclassify';
import { hashString, mulberry32, pickFrom, unitFrom } from './random';
import { resolveAssignment, scoreResolved } from './score';
import { assignmentKey, pickVariety, selectDiverse, varietyTolerance, type VarietyPick } from './variety';
import type { Assignment, CourseEvent, Day, LunchPrefs, Prefs, Selection, Solution, Timetable } from './types';

/**
 * How much wider than `topK` the internal candidate pool grows once Variety is on. The band has
 * to be searched before it can be chosen from, and the strict top ten of a real timetable is
 * routinely ten permutations of one week. A search parameter, not a scoring constant, so it
 * stays here rather than in the Advanced panel.
 */
const VARIETY_POOL_FACTOR = 4;

export interface SolveOptions {
  /** How many best solutions to keep for the alternatives strip. */
  topK?: number;
  /** DFS node budget before falling back to randomised local search. */
  nodeBudget?: number;
  /** Overrides the seeded RNG on the fallback path; tests use it to pin that walk exactly. */
  random?: () => number;
}

/** One set of seminar groups that meet at the exact same times — interchangeable by definition. */
export interface InterchangeableGroup {
  subjectCode: string;
  /** The shared day/time signature. Also the coordinate the representative was drawn against. */
  signature: string;
  /**
   * The member this seed drew to stand for the set. Standing for the set is not the same as
   * being scheduled: forward checking can still drop a representative that collides with a
   * fixed lecture, and the search picks only one value per subject anyway. Confirm it against
   * the solution being displayed before telling the user it's their group —
   * `interchangeableFor` in `variety.ts` does exactly that.
   */
  representativeId: string;
  /** Every group meeting at these times, the representative included. Sorted, stable. */
  memberIds: string[];
}

export interface SolveResult {
  /** Best-first; length <= topK. Never empty once at least the empty assignment exists. */
  solutions: Solution[];
  /** False once the node budget was exceeded — result is "best found", not proven optimal. */
  provenOptimal: boolean;
  /** Which solution this student's seed put forward, and what it cost. */
  variety: VarietyPick;
  /**
   * The interchangeable-group sets the search collapsed, chosen ones included. This is the
   * headroom variation had to work with — and it's worth surfacing regardless, since the
   * collapse otherwise hides perfectly good alternatives from the user entirely.
   */
  interchangeable: InterchangeableGroup[];
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

interface BuiltVariables {
  variables: Variable[];
  interchangeable: InterchangeableGroup[];
}

/**
 * Non-★ lectures are dropped exactly when a day off touches them — this is the only
 * situation the plan ever exercises the keep/drop choice for, so it is derived rather
 * than searched. ★ lectures are never dropped: a day off blocked by one is caught
 * earlier, in analysis.ts, before the solver ever runs.
 *
 * Seminars reclassified as lectures follow the same rule: they're fixed, not searched, so a
 * day off drops them exactly like a non-★ lecture rather than hard-filtering them out of a
 * group choice (there is no group choice left once a seminar is reclassified).
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
    for (const seminar of subject.seminars) {
      if (!subjectSelection.reclassified[seminar.id] || !subjectSelection.seminars[seminar.id]) continue;
      if (seminar.slots.some((slot) => daysOff.includes(slot.day))) dropped.add(seminar.id);
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
    for (const seminar of subject.seminars) {
      if (!subjectSelection.reclassified[seminar.id] || !subjectSelection.seminars[seminar.id]) continue;
      if (dropped.has(seminar.id)) continue;
      events.push(asLecture(seminar));
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
 *    (real exports routinely have many — e.g. one lab slot taught by several TAs), drawn
 *    against the student's seed rather than by lowest group number: see below,
 *  - forward checking against the fixed (always-present) lectures of *other* subjects: a
 *    value that collides with one is dropped whenever the same variable has a clean
 *    alternative, since a clean option always strictly dominates a colliding one here
 *    (its collision penalty alone outweighs any comfort-term difference) regardless of what
 *    the rest of the search does. Own-subject lectures are excluded from this check, same
 *    as `findOverlaps`: only one of a subject's groups is ever selected, so a lecture
 *    overlapping its own subject's group is never actually penalised.
 * Surviving values are ordered by ascending fixed-collision count so the branch-and-bound in
 * `solve` finds a strong incumbent — and starts pruning — as early as possible.
 *
 * The collapse is also the single biggest reason a whole cohort used to receive one identical
 * schedule. Groups sharing a signature are interchangeable *by construction* — the score never
 * looks at who teaches one — so which of them represents the class is a free choice, and taking
 * the lowest group number meant every student in the year was handed group 01 of the same lab.
 * Drawing the representative from the student's seed instead costs exactly zero points and
 * spreads the year evenly across the parallel groups a faculty opened precisely to absorb it.
 * The draw is keyed on the signature, not on call order, so it stays stable across the whole
 * search: otherwise one week could surface twice in the alternatives strip under two different
 * group numbers.
 */
function buildVariables(
  timetable: Timetable,
  selection: Selection,
  daysOff: Day[],
  lunch: LunchPrefs,
  fixed: CourseEvent[],
  seed: string,
): BuiltVariables {
  const variables: Variable[] = [];
  const interchangeable: InterchangeableGroup[] = [];
  for (const subject of timetable.subjects) {
    const subjectSelection = selection[subject.code];
    if (!subjectSelection?.enabled || subject.seminars.length === 0) continue;

    const enabledGroups = subject.seminars.filter(
      (s) => subjectSelection.seminars[s.id] && !subjectSelection.reclassified[s.id],
    );
    const survivors = enabledGroups.filter(
      (s) => !s.slots.some((slot) => daysOff.includes(slot.day) || slotDuringLunch(slot, lunch)),
    );

    if (survivors.length === 0) {
      // Never an empty domain: no usable group means "lecture only", not failure.
      variables.push({ subjectCode: subject.code, domain: [{ event: null, fixedCollisions: 0 }] });
      continue;
    }

    const otherFixed = fixed.filter((f) => f.subjectCode !== subject.code);

    const bySignature = new Map<string, CourseEvent[]>();
    for (const group of survivors) {
      const sig = slotSignature(group);
      const members = bySignature.get(sig);
      if (members) members.push(group);
      else bySignature.set(sig, [group]);
    }

    const representatives: CourseEvent[] = [];
    for (const [signature, members] of bySignature) {
      // Sorted first so the draw doesn't depend on the order the export happened to list
      // groups in — only on the seed and the signature.
      members.sort((a, b) => a.id.localeCompare(b.id));
      const chosen = pickFrom(members, seed, subject.code, signature)!;
      representatives.push(chosen);
      if (members.length > 1) {
        interchangeable.push({
          subjectCode: subject.code,
          signature,
          representativeId: chosen.id,
          memberIds: members.map((m) => m.id),
        });
      }
    }

    const withCollisions: VariableValue[] = representatives.map((event) => ({
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
  variables.sort((a, b) => a.domain.length - b.domain.length);
  return { variables, interchangeable };
}

function latestFinish(events: CourseEvent[]): number {
  let max = 0;
  for (const event of events) for (const slot of event.slots) max = Math.max(max, slot.end);
  return max;
}

/**
 * Deterministic tie-break: lowest score, then earliest finish, then the seed's own order.
 *
 * The first two keys are real preferences — a cheaper week is better, and among equals an
 * earlier finish is better. The third used to be lexicographic on group ids, which is not a
 * preference at all: it just meant that whenever two genuinely equal-cost weeks existed, every
 * student in the year was handed the one with the lower group numbers. Ordering those ties per
 * seed instead costs nobody a single point. `localeCompare` still backs it up, so the ordering
 * stays total even if two keys happen to hash alike.
 */
function makeCompareSolutions(seed: string): (a: Solution, b: Solution) => number {
  const jitter = new Map<string, number>();
  const jitterOf = (key: string): number => {
    let value = jitter.get(key);
    if (value === undefined) {
      value = unitFrom(seed, 'rank', key);
      jitter.set(key, value);
    }
    return value;
  };

  return (a, b) => {
    if (a.score.total !== b.score.total) return a.score.total - b.score.total;
    const finishDiff = latestFinish(a.events) - latestFinish(b.events);
    if (finishDiff !== 0) return finishDiff;
    const keyA = assignmentKey(a.assignment);
    const keyB = assignmentKey(b.assignment);
    const jitterDiff = jitterOf(keyA) - jitterOf(keyB);
    if (jitterDiff !== 0) return jitterDiff;
    return keyA.localeCompare(keyB);
  };
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
function insertRanked(
  best: Solution[],
  solution: Solution,
  limit: number,
  compare: (a: Solution, b: Solution) => number,
): void {
  if (best.length >= limit && compare(solution, best[limit - 1]!) >= 0) return;
  best.push(solution);
  best.sort(compare);
  if (best.length > limit) best.length = limit;
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
  limit: number,
  compare: (a: Solution, b: Solution) => number,
  random: () => number,
  iterations: number,
): void {
  let current = randomChoiceOf(variables, random);
  let currentSolution = buildSolution(timetable, selection, prefs, droppedLectures, current);
  insertRanked(best, currentSolution, limit, compare);

  for (let i = 0; i < iterations && variables.length > 0; i++) {
    const candidate = { ...current };
    const variable = variables[Math.floor(random() * variables.length)]!;
    const value = variable.domain[Math.floor(random() * variable.domain.length)]!;
    candidate[variable.subjectCode] = value.event?.id ?? null;

    const candidateSolution = buildSolution(timetable, selection, prefs, droppedLectures, candidate);
    insertRanked(best, candidateSolution, limit, compare);

    if (candidateSolution.score.total <= currentSolution.score.total) {
      current = candidate;
      currentSolution = candidateSolution;
    } else if (random() < 0.02) {
      // Occasional restart so the walk doesn't get stuck in a local optimum.
      current = randomChoiceOf(variables, random);
      currentSolution = buildSolution(timetable, selection, prefs, droppedLectures, current);
      insertRanked(best, currentSolution, limit, compare);
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
 *
 * Nothing in the search is randomised in the sense of varying run to run: every draw is a pure
 * function of `prefs.seed`, so a given student re-solving after nudging a slider gets a stable
 * week rather than a reshuffled one. What the seed changes is *which* of the equally-good
 * answers is returned — see `buildVariables` and `makeCompareSolutions` for the two free ones,
 * and `variety.ts` for the one that isn't free.
 */
export function solve(timetable: Timetable, selection: Selection, prefs: Prefs, options: SolveOptions = {}): SolveResult {
  const topK = options.topK ?? 10;
  const nodeBudget = options.nodeBudget ?? 2_000_000;
  const seed = prefs.seed ?? '';
  // Seeded, so even the fallback walk is reproducible for a given student; `options.random`
  // still wins, which is how the tests pin that path exactly.
  const random = options.random ?? mulberry32(hashString(`${seed} fallback`));
  const compare = makeCompareSolutions(seed);

  const droppedLectures = deriveDroppedLectures(timetable, selection, prefs.daysOff);
  const fixed = fixedLectures(timetable, selection, droppedLectures);
  const { variables, interchangeable } = buildVariables(timetable, selection, prefs.daysOff, prefs.lunch, fixed, seed);
  const droppedLectureCost = droppedLectures.size * prefs.tuning.droppedLecturePerEvent;

  // Variety chooses from a band of near-optimal weeks, so that band has to survive the search
  // first: widen the pool and let the bound keep anything within tolerance of the worst kept.
  // Both collapse back to today's behaviour at variety 0.
  const tolerance = varietyTolerance(prefs);
  const poolK = tolerance > 0 ? topK * VARIETY_POOL_FACTOR : topK;

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
      insertRanked(best, buildSolution(timetable, selection, prefs, droppedLectures, choice), poolK, compare);
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
      if (
        best.length >= poolK &&
        total * prefs.tuning.seminarCollisionPerPair + droppedLectureCost > best[poolK - 1]!.score.total + tolerance
      ) {
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
    randomizedFallback(timetable, selection, prefs, variables, droppedLectures, best, poolK, compare, random, iterations);
  }

  // The strip stays a truthful ladder — sorted by real score, cheapest first — and variety only
  // decides which rung is put forward. Presenting a re-ordered list instead would have meant
  // showing "#1" above a lower-scoring "#2", and the whole point is that the cost is visible.
  const solutions = tolerance > 0 ? selectDiverse(best, topK, compare) : best.slice(0, topK);

  return { solutions, provenOptimal: !budgetExceeded, variety: pickVariety(solutions, prefs), interchangeable };
}
