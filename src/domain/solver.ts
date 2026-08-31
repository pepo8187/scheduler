import { createLedger } from './ledger';
import { slotDuringLunch } from './lunch';
import { eventsOverlap, type Overlap } from './overlap';
import { asLecture } from './reclassify';
import { hashString, mulberry32, pickFrom, unitFrom } from './random';
import { resolveAssignment, scoreResolved } from './score';
import { blockShapeKey, dayLoadKey } from './shape';
import { collectVariants } from './variants';
import { assignmentKey, pickVariety, selectDiverse, varietyTolerance, type VarietyPick } from './variety';
import type {
  Assignment,
  CourseEvent,
  Day,
  LunchPrefs,
  Prefs,
  ScoreTerm,
  Selection,
  Solution,
  Timetable,
} from './types';

/**
 * How much wider than `topK` the internal candidate pool grows.
 *
 * The strip cannot show ten different weeks unless the search kept more than ten candidates:
 * the strict top ten of a real timetable is routinely ten spellings of one week, so deduping it
 * to distinct shapes would leave rungs empty. Variety needs the same headroom for a different
 * reason — its band has to be searched before it can be chosen from — which is why one factor
 * now serves both, applied unconditionally rather than only when the slider is up.
 *
 * The cost is a weaker branch-and-bound bound, since the bound is compared against the worst of
 * the *pool* rather than the worst of the top ten. Measured on the performance guard's heavy
 * semester (5 subjects, 15–35 groups each) it is a fraction of a second either way, and every
 * real export is far smaller. A search parameter, not a scoring constant, so it stays here
 * rather than in the Advanced panel.
 */
const POOL_FACTOR = 4;

/**
 * How fine a grid search-time totals are rounded onto before candidates are ranked against
 * each other.
 *
 * The ledger reaches the same total as `scoreResolved` by a different route — per day rather
 * than per term — so two spellings of one genuinely equal-cost week can come out a couple of
 * ulps apart. Left alone, `makeCompareSolutions`' `a.score.total !== b.score.total` would treat
 * a difference of 1e-13 points as a real preference and rank on it, silently overriding the
 * seeded jitter that exists precisely to spread equal-cost weeks across a cohort. Rounding to a
 * millionth of a point collapses that noise and lets the intended tie-break do its job; every
 * weight in `DEFAULT_TUNING` is at least four orders of magnitude coarser, so nothing a student
 * could notice is ever rounded away.
 */
const COMPARE_GRID = 1e6;

function quantize(total: number): number {
  return Math.round(total * COMPARE_GRID) / COMPARE_GRID;
}

/**
 * Shared placeholders for the pool's search-time solutions. Both are replaced with real data by
 * the re-scoring pass at the end of `solve`, and nothing reads them before then — but a leaf
 * that allocated two throwaway arrays would allocate 1.7 million of them on a first-semester
 * export.
 */
const NO_OVERLAPS: Overlap[] = [];
const NO_TERMS: ScoreTerm[] = [];

/**
 * Above this the candidate-collision matrix is skipped and the DFS falls back to calling
 * `eventsOverlap` per pair. Nothing near a real export comes close — podzim22's five searched
 * subjects need under 2 kB — but the matrix is quadratic in the total candidate count, and a
 * pathological import should degrade to the old behaviour rather than to an allocation failure.
 */
const OVERLAP_MATRIX_BUDGET_BYTES = 8 * 1024 * 1024;

/**
 * Every candidate-against-candidate collision, resolved once before the search starts.
 *
 * `buildVariables` already hoists collisions against the *fixed* events out of the DFS. This is
 * the same trick for the other half: a value's collisions against the values chosen above it in
 * the tree, which the search otherwise rediscovers with `eventsOverlap` at every node — close to
 * five million calls on the podzim22 export. Domains are fixed for the whole solve, so the
 * answer is a lookup rather than a slot-by-slot comparison.
 *
 * Worth being precise about when this pays: against the original solver it was worth about 3%,
 * because leaf evaluation dwarfed everything the search itself did. Once the leaf is scored
 * incrementally that ratio inverts and the same table is worth roughly a fifth of the remaining
 * time. It is an optimisation of the search, and only matters once the search is what's left.
 *
 * Indexed `[i][j][a * |domain(j)| + b]` for `j < i`, since the DFS only ever looks upward.
 */
function buildOverlapMatrix(variables: Variable[]): Uint8Array[][] | null {
  let bytes = 0;
  for (let i = 0; i < variables.length; i++) {
    for (let j = 0; j < i; j++) bytes += variables[i]!.domain.length * variables[j]!.domain.length;
  }
  if (bytes > OVERLAP_MATRIX_BUDGET_BYTES) return null;

  const matrix: Uint8Array[][] = [];
  for (let i = 0; i < variables.length; i++) {
    const row: Uint8Array[] = [];
    const domainA = variables[i]!.domain;
    for (let j = 0; j < i; j++) {
      const domainB = variables[j]!.domain;
      const pairs = new Uint8Array(domainA.length * domainB.length);
      for (let a = 0; a < domainA.length; a++) {
        const eventA = domainA[a]!.event;
        if (!eventA) continue;
        for (let b = 0; b < domainB.length; b++) {
          const eventB = domainB[b]!.event;
          if (eventB && eventsOverlap(eventA, eventB)) pairs[a * domainB.length + b] = 1;
        }
      }
      row.push(pairs);
    }
    matrix.push(row);
  }
  return matrix;
}

export interface SolveOptions {
  /** How many best solutions to keep for the alternatives strip. */
  topK?: number;
  /** DFS node budget before falling back to randomised local search. */
  nodeBudget?: number;
  /** Overrides the seeded RNG on the fallback path; tests use it to pin that walk exactly. */
  random?: () => number;
  /**
   * Called periodically (every few thousand DFS nodes) while the search is running, so a
   * caller on the other side of a `postMessage` boundary — the worker — can relay live
   * progress to the UI on a solve heavy enough for it to matter. Cheap and coarse by design:
   * it costs a bitmask check per node, and callers are expected to throttle their own
   * forwarding rather than rely on the sampling rate here.
   */
  onProgress?: (nodesVisited: number, elapsedMs: number) => void;
}

/** `performance.now()` where it exists (worker, browser, vitest); `Date.now()` otherwise. */
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

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
  /**
   * Aligned with `solutions`: the other labellings of each rung's week that the shape dedupe
   * collapsed into it. Same blocks, same score, different subjects in them — see
   * `domain/variants.ts`. Empty for a rung that hides nothing.
   */
  variants: Solution[][];
  /** How the search spent its time — surfaced so a slow solve can be diagnosed, not just felt. */
  diagnostics: SolveDiagnostics;
}

export interface SolveDiagnostics {
  /** Wall-clock time inside `solve()` — the search itself, not worker startup or message passing. */
  elapsedMs: number;
  /** DFS nodes visited before either finishing or hitting `nodeBudget`. */
  nodesVisited: number;
  /** Iterations the randomised local-search fallback ran; 0 unless the node budget was exceeded. */
  fallbackIterations: number;
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

/**
 * The groups the user pinned, as fixed input — one per subject, only where the pin is real.
 *
 * A pin says "I want *this* group", as opposed to `seminars`, which only says which groups the
 * solver may consider. Four things disqualify a pin, and all four are silent here rather than
 * an error: the group is switched off, it was reclassified as a lecture (there is no group
 * choice left to pin), the subject is off, or a **hard constraint forbids it** — a day off or
 * the lunch block. That last one is the important one. A pin cannot beat a hard constraint, so
 * it loses; producing an infeasible week instead would be worse, and quietly dropping it
 * without saying so would be worse still, which is what `analyzePins` in `analysis.ts` is for.
 */
export function derivePinnedGroups(
  timetable: Timetable,
  selection: Selection,
  daysOff: Day[],
  lunch: LunchPrefs,
): Map<string, CourseEvent> {
  const pinned = new Map<string, CourseEvent>();
  for (const subject of timetable.subjects) {
    const subjectSelection = selection[subject.code];
    if (!subjectSelection?.enabled) continue;
    const group = subject.seminars.find(
      (s) =>
        subjectSelection.pinned?.[s.id] &&
        subjectSelection.seminars[s.id] &&
        !subjectSelection.reclassified[s.id] &&
        !s.slots.some((slot) => daysOff.includes(slot.day) || slotDuringLunch(slot, lunch)),
    );
    if (group) pinned.set(subject.code, group);
  }
  return pinned;
}

/**
 * Same day/time/parity signature for every slot, order-independent — groups sharing one are
 * interchangeable for search purposes (the score never looks at who teaches a group).
 *
 * Parity belongs in the key. An odd-week group and its even-week twin occupy the same hour
 * but are emphatically not interchangeable: they collide with different things and are lived
 * in different weeks. Keying on day/time alone collapsed every such pair into one
 * representative and hid the other half of the timetable from the search entirely — in the
 * podzim2022 export, 29 of 49 collapsed sets were mixed-parity, so half of IB015's, PB154's
 * and VB035's groups were never even considered.
 */
function slotSignature(event: CourseEvent): string {
  return event.slots
    .map((s) => `${s.day}:${s.start}-${s.end}${s.parity ? `:${s.parity}` : ''}`)
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
  pinned: Map<string, CourseEvent>,
  seed: string,
): BuiltVariables {
  const variables: Variable[] = [];
  const interchangeable: InterchangeableGroup[] = [];
  for (const subject of timetable.subjects) {
    const subjectSelection = selection[subject.code];
    if (!subjectSelection?.enabled || subject.seminars.length === 0) continue;
    // A pinned subject is not a decision any more. It contributes no variable, no collapsed
    // set (there is nothing to draw a representative from) and no branching — it is already in
    // `fixed`, so every other subject forward-checks against it like a lecture.
    if (pinned.has(subject.code)) continue;

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

function randomChoiceOf(
  variables: Variable[],
  base: Record<string, string | null>,
  random: () => number,
): Record<string, string | null> {
  const choice: Record<string, string | null> = { ...base };
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
  base: Record<string, string | null>,
  random: () => number,
  iterations: number,
): void {
  let current = randomChoiceOf(variables, base, random);
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
      current = randomChoiceOf(variables, base, random);
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
 * **The bound is about collisions, and almost nothing else.** Measured on the podzim22 export,
 * 1,060,259 of 1,060,262 complete assignments are collision-free, so `total` is 0 at nearly
 * every leaf and the test above reduces to "does this branch already carry a clash". That
 * prunes the clashing tenth of the tree outright and cannot touch the rest — which is why the
 * search still visits ~850,000 leaves for ten answers, and why the thing worth optimising was
 * never the pruning but the cost of a leaf. Scoring one used to mean rebuilding the whole week
 * from the assignment (`resolveAssignment` + `scoreResolved`, 7.4 µs) and accounted for 97% of
 * a 7.7-second solve; the ledger keeps that week alive across the search instead, so a leaf
 * reads a number the descent already accumulated. Same answers, ~11× less time.
 *
 * An admissible *comfort* bound was tried and is not here on purpose: bounding how much the
 * unassigned subjects can still claw back off the sparse-day term cuts 88% of the leaves and
 * makes the solver slower, because evaluating the bound costs about what the ledger's leaf now
 * costs. Cheap leaves and hard pruning are substitutes here, not complements.
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
  // Pinned groups are the user's own choices, so they leave the search entirely: no variable,
  // and — since they are as fixed as a lecture from here on — they join the forward-checking
  // list, which lets every other subject prune against them before the DFS starts.
  const pinned = derivePinnedGroups(timetable, selection, prefs.daysOff, prefs.lunch);
  const pinnedChoice: Record<string, string | null> = {};
  for (const [code, group] of pinned) pinnedChoice[code] = group.id;
  const fixed = [...fixedLectures(timetable, selection, droppedLectures), ...pinned.values()];
  const { variables, interchangeable } = buildVariables(
    timetable,
    selection,
    prefs.daysOff,
    prefs.lunch,
    fixed,
    pinned,
    seed,
  );
  const droppedLectureCost = droppedLectures.size * prefs.tuning.droppedLecturePerEvent;

  // Both the strip's shape-dedupe and Variety's band need more candidates than the strip shows,
  // so the pool is widened either way; the tolerance additionally lets the bound keep anything
  // within the band of the worst kept.
  const tolerance = varietyTolerance(prefs);
  const poolK = topK * POOL_FACTOR;

  const start = now();
  const best: Solution[] = [];
  const chosen: (CourseEvent | null)[] = new Array(variables.length).fill(null);
  /** Aligned with `chosen`; the domain index of each choice, or -1 for "no seminar". */
  const chosenIndex: Int32Array = new Int32Array(variables.length).fill(-1);
  const overlapMatrix = buildOverlapMatrix(variables);
  // The week the search is standing in, carried down the tree and restored on the way back up
  // rather than rebuilt from the assignment at every leaf. See `domain/ledger.ts`.
  const ledger = createLedger(prefs, fixed, droppedLectures.size, variables.length);
  let nodes = 0;
  let budgetExceeded = false;

  function dfs(index: number, collisionsSoFar: number): void {
    if (budgetExceeded) return;
    nodes++;
    if (nodes > nodeBudget) {
      budgetExceeded = true;
      return;
    }
    // Sampled, not per-node: a bitmask check is cheap enough to always run, but calling
    // `onProgress` (and its `now()`) on every node would itself slow the search down.
    if (options.onProgress && (nodes & 0xfff) === 0) {
      options.onProgress(nodes, now() - start);
    }

    if (index === variables.length) {
      // The ledger already holds this exact week, so the score is a read of what the descent
      // accumulated rather than a rebuild. Take the number first and leave immediately if it
      // cannot make the pool: on the podzim22 export 851,771 of 852,627 leaves are turned away
      // here, and every one of them would otherwise have allocated a choice map and an event
      // list on the way to being discarded.
      const total = quantize(ledger.total(collisionsSoFar));
      if (best.length >= poolK && total > best[poolK - 1]!.score.total) return;

      const choice: Record<string, string | null> = { ...pinnedChoice };
      for (let i = 0; i < variables.length; i++) choice[variables[i]!.subjectCode] = chosen[i]?.id ?? null;
      // `fixed` plus what the search chose *is* the attended week — the same set
      // `resolveAssignment` arrives at by walking every subject again. Order differs, which
      // matters to nobody: the re-scoring pass below replaces this list with the canonical one.
      const events = fixed.slice();
      for (let i = 0; i < variables.length; i++) {
        const event = chosen[i];
        if (event) events.push(event);
      }
      insertRanked(
        best,
        {
          assignment: { seminarChoice: choice, droppedLectures },
          events,
          overlaps: NO_OVERLAPS,
          score: { total, terms: NO_TERMS },
        },
        poolK,
        compare,
      );
      return;
    }

    const variable = variables[index]!;
    const domain = variable.domain;
    const matrixRow = overlapMatrix === null ? null : overlapMatrix[index]!;
    for (let valueIndex = 0; valueIndex < domain.length; valueIndex++) {
      const value = domain[valueIndex]!;
      let collisions = value.fixedCollisions;
      if (value.event) {
        if (matrixRow === null) {
          for (let j = 0; j < index; j++) {
            const prior = chosen[j];
            if (prior && eventsOverlap(prior, value.event)) collisions++;
          }
        } else {
          for (let j = 0; j < index; j++) {
            const priorIndex = chosenIndex[j]!;
            if (priorIndex < 0) continue;
            collisions += matrixRow[j]![valueIndex * variables[j]!.domain.length + priorIndex]!;
          }
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
      chosenIndex[index] = value.event ? valueIndex : -1;
      if (value.event) ledger.place(value.event, index);
      dfs(index + 1, total);
      if (value.event) ledger.unplace(index);
      if (budgetExceeded) return;
    }
  }

  dfs(0, 0);

  let fallbackIterations = 0;
  if (budgetExceeded) {
    fallbackIterations = Math.min(20_000, Math.max(200, Math.floor(nodeBudget / 100)));
    randomizedFallback(
      timetable,
      selection,
      prefs,
      variables,
      droppedLectures,
      best,
      poolK,
      compare,
      pinnedChoice,
      random,
      fallbackIterations,
    );
  }

  // The pool was ranked on the ledger's totals, which are a search filter and not the score: no
  // term breakdown, no overlap list, and additions grouped per day rather than per term. Put the
  // survivors back through the one scorer everything else in the app reads — forty of them, well
  // under a millisecond — so the strip, the breakdown panel, `variants.ts` and the tests all see
  // exactly what they saw before any of this was incremental. Re-sorting afterwards matters:
  // ranking is now on exact totals rather than on the filter's.
  for (const solution of best) {
    const resolved = resolveAssignment(timetable, selection, solution.assignment);
    solution.events = resolved.events;
    solution.overlaps = resolved.overlaps;
    solution.score = scoreResolved(prefs, droppedLectures, resolved.events, resolved.overlaps);
  }
  best.sort(compare);

  // The strip stays a truthful ladder — sorted by real score, cheapest first — and variety only
  // decides which rung is put forward. Presenting a re-ordered list instead would have meant
  // showing "#1" above a lower-scoring "#2", and the whole point is that the cost is visible.
  //
  // Which *candidates* fill the ladder is a separate question, and the answer is no longer "the
  // strict top ten": those are routinely ten spellings of one week, especially since alternating
  // -week parity stopped collapsing odd/even twins. Dedupe by week shape, coarse first, so the
  // rungs differ in something a student can see. This runs for everyone now, not only with
  // Variety on — a strip nobody can tell apart is useless at every slider position.
  const shapeKey = (solution: Solution): string => blockShapeKey(solution.events, timetable.hours);
  const solutions = selectDiverse(best, topK, compare, [(solution) => dayLoadKey(solution.events), shapeKey]);
  // What the dedupe collapsed, kept rather than discarded: a rung's other labellings are the
  // one genuinely interesting thing it hides, and they are already in the pool.
  const variants = collectVariants(best, solutions, shapeKey, compare);

  return {
    solutions,
    provenOptimal: !budgetExceeded,
    variety: pickVariety(solutions, prefs),
    interchangeable,
    variants,
    diagnostics: { elapsedMs: now() - start, nodesVisited: nodes, fallbackIterations },
  };
}
