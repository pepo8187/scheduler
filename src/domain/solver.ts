import { slotDuringLunch } from './lunch';
import { eventsOverlap } from './overlap';
import { computeScore, resolveAssignment } from './score';
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

interface Variable {
  subjectCode: string;
  domain: (string | null)[]; // seminar CourseEvent id, or null for "no seminar chosen"
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

/** Upfront domain filtering: enabled groups only, minus anything touching a day off or lunch. */
function buildVariables(timetable: Timetable, selection: Selection, daysOff: Day[], lunch: LunchPrefs): Variable[] {
  const variables: Variable[] = [];
  for (const subject of timetable.subjects) {
    const subjectSelection = selection[subject.code];
    if (!subjectSelection?.enabled || subject.seminars.length === 0) continue;

    const enabledGroups = subject.seminars.filter((s) => subjectSelection.seminars[s.id]);
    const survivors = enabledGroups.filter(
      (s) => !s.slots.some((slot) => daysOff.includes(slot.day) || slotDuringLunch(slot, lunch)),
    );
    // Never an empty domain: no usable group means "lecture only", not failure.
    const domain: (string | null)[] = survivors.length > 0 ? survivors.map((s) => s.id) : [null];
    variables.push({ subjectCode: subject.code, domain });
  }
  // MRV: most-constrained variables first, so bad branches are pruned early.
  return variables.sort((a, b) => a.domain.length - b.domain.length);
}

function findSeminar(timetable: Timetable, subjectCode: string, id: string): CourseEvent | undefined {
  return timetable.subjects.find((s) => s.code === subjectCode)?.seminars.find((s) => s.id === id);
}

/**
 * Forward checking against the fixed (always-present) lectures only: a value that
 * collides with a fixed lecture is dropped from consideration whenever the same
 * variable has a clean alternative. This can never change the optimum — fixed
 * lectures never move, so a clean option strictly dominates a colliding one for
 * this variable regardless of what the rest of the search does — and it never
 * empties a domain (falls back to the untouched domain instead).
 */
function forwardCheckedDomain(variable: Variable, timetable: Timetable, fixed: CourseEvent[]): (string | null)[] {
  const clean = variable.domain.filter((value) => {
    if (value === null) return true;
    const seminar = findSeminar(timetable, variable.subjectCode, value);
    return seminar ? !fixed.some((event) => eventsOverlap(event, seminar)) : true;
  });
  return clean.length > 0 ? clean : variable.domain;
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
  const assignment: Assignment = { seminarChoice: { ...choice }, droppedLectures };
  const { events, overlaps } = resolveAssignment(timetable, selection, assignment);
  const score = computeScore(timetable, selection, prefs, assignment);
  return { assignment, events, overlaps, score };
}

function insertRanked(best: Solution[], solution: Solution, topK: number): void {
  best.push(solution);
  best.sort(compareSolutions);
  if (best.length > topK) best.length = topK;
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
  const randomChoice = (): Record<string, string | null> => {
    const choice: Record<string, string | null> = {};
    for (const variable of variables) {
      choice[variable.subjectCode] = variable.domain[Math.floor(random() * variable.domain.length)] ?? null;
    }
    return choice;
  };

  let current = randomChoice();
  let currentSolution = buildSolution(timetable, selection, prefs, droppedLectures, current);
  insertRanked(best, currentSolution, topK);

  for (let i = 0; i < iterations && variables.length > 0; i++) {
    const candidate = { ...current };
    const variable = variables[Math.floor(random() * variables.length)]!;
    candidate[variable.subjectCode] = variable.domain[Math.floor(random() * variable.domain.length)] ?? null;

    const candidateSolution = buildSolution(timetable, selection, prefs, droppedLectures, candidate);
    insertRanked(best, candidateSolution, topK);

    if (candidateSolution.score.total <= currentSolution.score.total) {
      current = candidate;
      currentSolution = candidateSolution;
    } else if (random() < 0.02) {
      // Occasional restart so the walk doesn't get stuck in a local optimum.
      current = randomChoice();
      currentSolution = buildSolution(timetable, selection, prefs, droppedLectures, current);
      insertRanked(best, currentSolution, topK);
    }
  }
}

/**
 * Exhaustive DFS with MRV ordering, forward checking against fixed lectures, and a
 * bounded top-K. The decision space is one variable per enabled subject-with-seminars
 * (which group, or none); ★ lectures and seminar-less subjects are fixed input placed
 * before the search begins, and non-★ lecture drops are derived, not searched (see
 * deriveDroppedLectures). Groups touching a day off or a lunch block are filtered out of
 * the domain up front (buildVariables), the same hard-constraint treatment either way — a
 * subject left with no survivor falls back to "no seminar chosen" rather than failing.
 * For the documented scale (tens of combinations for a normal semester) this always
 * completes well under the node budget and the result is provably optimal; past the
 * budget it falls back to randomised local search and is labelled "best found — not
 * proven optimal".
 */
export function solve(timetable: Timetable, selection: Selection, prefs: Prefs, options: SolveOptions = {}): SolveResult {
  const topK = options.topK ?? 10;
  const nodeBudget = options.nodeBudget ?? 2_000_000;
  const random = options.random ?? Math.random;

  const droppedLectures = deriveDroppedLectures(timetable, selection, prefs.daysOff);
  const fixed = fixedLectures(timetable, selection, droppedLectures);
  const variables = buildVariables(timetable, selection, prefs.daysOff, prefs.lunch);

  const best: Solution[] = [];
  let nodes = 0;
  let budgetExceeded = false;

  function dfs(index: number, choice: Record<string, string | null>): void {
    if (budgetExceeded) return;
    nodes++;
    if (nodes > nodeBudget) {
      budgetExceeded = true;
      return;
    }

    if (index === variables.length) {
      insertRanked(best, buildSolution(timetable, selection, prefs, droppedLectures, choice), topK);
      return;
    }

    const variable = variables[index]!;
    for (const value of forwardCheckedDomain(variable, timetable, fixed)) {
      choice[variable.subjectCode] = value;
      dfs(index + 1, choice);
      if (budgetExceeded) return;
    }
    delete choice[variable.subjectCode];
  }

  dfs(0, {});

  if (budgetExceeded) {
    const iterations = Math.min(20_000, Math.max(200, Math.floor(nodeBudget / 100)));
    randomizedFallback(timetable, selection, prefs, variables, droppedLectures, best, topK, random, iterations);
  }

  return { solutions: best, provenOptimal: !budgetExceeded };
}
