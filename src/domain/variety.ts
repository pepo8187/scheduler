import { dayAffinity, unitFrom, type DayAffinity } from './random';
import { dayLoad, dayLoadKey } from './shape';
import type { Assignment, CourseEvent, Prefs, Solution } from './types';

/**
 * Variation across a cohort, priced honestly.
 *
 * Two of the three sources of sameness are free to fix — interchangeable groups and score ties
 * are handled inside the solver, and cost the student literally nothing. This module is the
 * third, the one that isn't free: a Monday-heavy week usually scores genuinely *better*, so
 * moving off it means accepting a slightly worse schedule. That has to be opt-in, bounded, and
 * visible in points.
 *
 * The mechanism deliberately isn't "perturb the score". Jittering the objective would corrupt
 * the number shown to the user and break the solver's branch-and-bound lower bound, which
 * assumes the score terms are exactly what `score.ts` says they are. Instead the search runs
 * untouched and this re-ranks *afterwards*, inside a tolerance band: among schedules within
 * `variety × varietyToleranceMax` points of the best one, the seed decides which is presented
 * first. Every solution keeps its true score, the strict optimum stays one click away in the
 * alternatives strip, and the price of the pick is stated on screen.
 */

/** How much the day-affinity match matters when ranking the band. */
const AFFINITY_WEIGHT = 1;
/**
 * …and how much pure per-seed jitter matters. Small on purpose: affinity is what spreads the
 * week, jitter only separates candidates that lean the same way.
 */
const JITTER_WEIGHT = 0.1;

/** Clamps a possibly-absent or NaN number into [min, max]. Prefs can arrive from old storage. */
function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

/** The width of the near-optimal band, in score points. Zero when variety is off. */
export function varietyTolerance(prefs: Prefs): number {
  return clamp(prefs.variety, 0, 1) * clamp(prefs.tuning.varietyToleranceMax, 0, Number.MAX_SAFE_INTEGER);
}

/**
 * Week-shape identity now lives in `domain/shape.ts`, which answers the same question at two
 * altitudes. Re-exported under the old names so nothing that only needs the coarse one has to
 * care about the split.
 */
export { dayLoad, dayLoadKey as weekShapeKey } from './shape';

/**
 * 0 when every class minute lands on this seed's best weekday, 1 when every minute lands on its
 * worst. Weighted by minutes rather than by day count, so a day carrying one seminar doesn't
 * pull as hard as a day carrying four.
 */
export function affinityMismatch(events: CourseEvent[], affinity: DayAffinity): number {
  const load = dayLoad(events);
  let minutes = 0;
  let weighted = 0;
  for (const [day, dayMinutes] of load) {
    minutes += dayMinutes;
    weighted += dayMinutes * (affinity.weight[day] ?? 0.5);
  }
  if (minutes === 0) return 0; // an empty week has nothing to lean either way
  return 1 - weighted / minutes;
}

/** Stable identity for an assignment, used as the coordinate for per-seed jitter. */
export function assignmentKey(assignment: Assignment): string {
  return Object.keys(assignment.seminarChoice)
    .sort()
    .map((code) => `${code}=${assignment.seminarChoice[code] ?? '-'}`)
    .join('|');
}

/**
 * Narrows the collapsed sets to those that actually shaped the week on screen.
 *
 * `SolveResult.interchangeable` records what the search collapsed, which is not the same as
 * what got scheduled: a representative can be dropped by forward checking, and only one value
 * per subject is ever chosen. Reporting the raw list to the user would occasionally name a group
 * that isn't on their grid.
 */
export function interchangeableFor<T extends { subjectCode: string; representativeId: string }>(
  groups: T[],
  solution: Solution | null | undefined,
): T[] {
  if (!solution) return [];
  return groups.filter((group) => solution.assignment.seminarChoice[group.subjectCode] === group.representativeId);
}

export interface VarietyPick {
  /** Index into the presented solutions that this seed landed on. 0 when variety is off. */
  index: number;
  /** Points given up against the strictly-best solution — the honest price of the pick. */
  cost: number;
  /** How many presented solutions sat within tolerance: the room variety had to work in. */
  bandSize: number;
  /** The band's width in points, so the UI can say what was on offer. */
  tolerance: number;
  /** This seed's weekday ranking, shown as "your week leans…". */
  affinity: DayAffinity;
}

/**
 * Chooses which of the ranked solutions to present first.
 *
 * `solutions` must already be sorted best-first — the solver's own seeded comparator has run by
 * the time this is called, so at zero tolerance the head of the list is already this seed's
 * choice among the exact ties and there is nothing left to do.
 */
export function pickVariety(solutions: Solution[], prefs: Prefs): VarietyPick {
  const affinity = dayAffinity(prefs.seed ?? '');
  const tolerance = varietyTolerance(prefs);

  if (solutions.length === 0) {
    return { index: 0, cost: 0, bandSize: 0, tolerance, affinity };
  }

  const bestTotal = solutions[0]!.score.total;
  const band = solutions.filter((s) => s.score.total <= bestTotal + tolerance);

  if (tolerance === 0 || band.length <= 1) {
    return { index: 0, cost: 0, bandSize: band.length, tolerance, affinity };
  }

  let bestIndex = 0;
  let bestRank = Infinity;
  for (let i = 0; i < band.length; i++) {
    const solution = band[i]!;
    const rank =
      AFFINITY_WEIGHT * affinityMismatch(solution.events, affinity) +
      JITTER_WEIGHT * unitFrom(prefs.seed ?? '', 'pick', assignmentKey(solution.assignment));
    if (rank < bestRank) {
      bestRank = rank;
      bestIndex = i;
    }
  }

  return {
    index: bestIndex,
    cost: solutions[bestIndex]!.score.total - bestTotal,
    bandSize: band.length,
    tolerance,
    affinity,
  };
}

/**
 * A schedule's identity for de-duplication purposes. See `domain/shape.ts` for the two the
 * strip uses and why neither of them looks at which subject sits in which block.
 */
export type ShapeKey = (solution: Solution) => string;

/**
 * Trims a wide candidate pool down to what the alternatives strip shows, preferring schedules
 * that differ in *shape*.
 *
 * Without this, a widened pool is mostly wasted: the top forty candidates for a real timetable
 * are routinely forty spellings of the same Monday-heavy week, differing only in which
 * interchangeable group filled a slot or which subject took which of two seminar hours.
 *
 * **Coarse to fine, one pass per key.** A single key cannot do this job. `dayLoadKey` alone is
 * too coarse — it merges a Monday-morning week with a Monday-afternoon one — and on a real
 * top ten it yields only three to six distinct values, so it would leave rungs empty.
 * `blockShapeKey` alone is too fine to change anything: nine or ten distinct values out of ten,
 * i.e. today's strip. Running them in order gives the strip a structure instead: the genuinely
 * different weeks first, then finer variations, then whatever is left. The list is re-sorted by
 * `compare` at the end, so the strip stays a truthful ladder in real score order.
 *
 * **The representative of a class is its best member, not a random one.** Sorting the pool by
 * `compare` up front gives that for free, since `compare` is score-first. It matters once times
 * are canonicalised: 15:40 and 15:50 land in the same `blockShapeKey` but do *not* score the
 * same, so picking arbitrarily within a class could hand a student a strictly worse week with
 * the better one invisible inside it.
 */
export function selectDiverse(
  pool: Solution[],
  limit: number,
  compare: (a: Solution, b: Solution) => number,
  keys: ShapeKey[] = [(solution) => dayLoadKey(solution.events)],
): Solution[] {
  const ranked = [...pool].sort(compare);
  const chosen: Solution[] = [];
  const taken = new Set<number>();

  for (const key of keys) {
    // Whatever earlier passes already put on the strip counts as seen for this key too,
    // otherwise pass two would re-offer a finer view of a week pass one already showed.
    const seen = new Set(chosen.map(key));
    for (let i = 0; i < ranked.length && chosen.length < limit; i++) {
      if (taken.has(i)) continue;
      const shape = key(ranked[i]!);
      if (seen.has(shape)) continue;
      seen.add(shape);
      taken.add(i);
      chosen.push(ranked[i]!);
    }
    if (chosen.length >= limit) break;
  }

  for (let i = 0; i < ranked.length && chosen.length < limit; i++) {
    if (taken.has(i)) continue;
    chosen.push(ranked[i]!);
  }

  return chosen.sort(compare);
}
