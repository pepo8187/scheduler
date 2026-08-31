import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS } from '../presets';
import { computeScore } from '../score';
import { solve } from '../solver';
import { describeSwitchCost, switchCosts, switchTier, type SwitchCost } from '../switching';
import type { Assignment, CourseEvent, Prefs, Selection, Slot, Subject, Timetable } from '../types';
import { buildFullSelection } from './selection';

function slot(day: Slot['day'], start: number, end: number): Slot {
  return { day, start, end, rooms: [], teachers: [] };
}

function event(id: string, subjectCode: string, kind: CourseEvent['kind'], slots: Slot[], group?: string): CourseEvent {
  return { id, subjectCode, kind, group, slots, teachers: [] };
}

function subject(code: string, lectures: CourseEvent[], seminars: CourseEvent[]): Subject {
  return { code, name: code, subjectId: code, facultyUrl: '', periodUrl: '', lectures, seminars };
}

function timetableOf(subjects: Subject[]): Timetable {
  return { minHour: 480, maxHour: 1200, hours: [], subjects, unscheduled: [] };
}

/** Scores a hand-written assignment the same way the solver would, for an expected delta. */
function scoreOf(timetable: Timetable, selection: Selection, prefs: Prefs, choice: Record<string, string | null>) {
  const assignment: Assignment = { seminarChoice: choice, droppedLectures: new Set() };
  return computeScore(timetable, selection, prefs, assignment).total;
}

describe('switchCosts', () => {
  // One lecture anchoring Monday, one subject with three groups: a good one, a tied one, and
  // one that lands on top of the lecture.
  const lecture = event('AA', 'AA', 'lecture', [slot('Po', 480, 590)]);
  const onMonday = event('BB/01', 'BB', 'seminar', [slot('Po', 600, 710)], '01');
  const alsoMonday = event('BB/02', 'BB', 'seminar', [slot('Po', 720, 830)], '02');
  const onFriday = event('BB/03', 'BB', 'seminar', [slot('Pá', 600, 710)], '03');
  const onTheLecture = event('BB/04', 'BB', 'seminar', [slot('Po', 480, 590)], '04');
  const timetable = timetableOf([
    subject('AA', [lecture], []),
    subject('BB', [], [onMonday, alsoMonday, onFriday, onTheLecture]),
  ]);
  const selection = buildFullSelection(timetable);
  const prefs: Prefs = { ...DEFAULT_PREFS, seed: 'AAAA-2222' };

  const solution = solve(timetable, selection, prefs).solutions[0]!;
  const costs = switchCosts(timetable, selection, prefs, solution);

  it('prices every enabled group except the one already chosen', () => {
    const chosen = solution.assignment.seminarChoice.BB!;
    expect(costs.has(chosen)).toBe(false);
    expect([...costs.keys()].sort()).toEqual(
      ['BB/01', 'BB/02', 'BB/03', 'BB/04'].filter((id) => id !== chosen),
    );
  });

  it('reports the exact difference the score would move by', () => {
    for (const [groupId, cost] of costs) {
      const expected = scoreOf(timetable, selection, prefs, { BB: groupId }) - solution.score.total;
      expect(cost.delta).toBeCloseTo(expected, 9);
    }
  });

  it('reports 0 for a switch that changes nothing about the week', () => {
    // Two groups at the same hour on the same day are the same week to the score, so whichever
    // of them was not chosen is a free swap.
    const tied = event('BB/05', 'BB', 'seminar', [slot('Po', 600, 710)], '05');
    const withTwin = timetableOf([subject('AA', [lecture], []), subject('BB', [], [onMonday, tied])]);
    const twinSelection = buildFullSelection(withTwin);
    const twinSolution = solve(withTwin, twinSelection, prefs).solutions[0]!;
    const twinCosts = switchCosts(withTwin, twinSelection, prefs, twinSolution);
    expect([...twinCosts.values()].map((c) => c.delta)).toEqual([0]);
  });

  it('flags a switch that would land on top of another class', () => {
    expect(costs.get('BB/04')?.collides).toBe(true);
    expect(costs.get('BB/04')!.delta).toBeGreaterThanOrEqual(prefs.tuning.seminarCollisionPerPair);
    for (const id of ['BB/01', 'BB/02', 'BB/03']) {
      if (costs.has(id)) expect(costs.get(id)!.collides).toBe(false);
    }
  });

  it('is never negative for a solution the solver put first', () => {
    // #1 is the strict optimum, so no single-group switch away from it can be an improvement.
    for (const cost of costs.values()) expect(cost.delta).toBeGreaterThanOrEqual(0);
  });

  it('skips groups the user has switched off, and reclassified ones', () => {
    const narrowed: Selection = {
      ...selection,
      BB: {
        ...selection.BB!,
        seminars: { 'BB/01': true, 'BB/02': false, 'BB/03': true, 'BB/04': true },
        reclassified: { 'BB/03': true },
      },
    };
    const narrowedSolution = solve(timetable, narrowed, prefs).solutions[0]!;
    const narrowedCosts = switchCosts(timetable, narrowed, prefs, narrowedSolution);
    expect(narrowedCosts.has('BB/02')).toBe(false); // disabled
    expect(narrowedCosts.has('BB/03')).toBe(false); // fixed as a lecture, not a candidate
  });

  it('says nothing about a subject the user disabled entirely', () => {
    const off: Selection = { ...selection, BB: { ...selection.BB!, enabled: false } };
    const offSolution = solve(timetable, off, prefs).solutions[0]!;
    expect(switchCosts(timetable, off, prefs, offSolution).size).toBe(0);
  });
});

describe('switchTier / describeSwitchCost', () => {
  const cost = (over: Partial<SwitchCost>): SwitchCost => ({
    groupId: 'BB/01',
    subjectCode: 'BB',
    delta: 0,
    collides: false,
    ...over,
  });

  it('sorts a switch into free, costly or blocked', () => {
    expect(switchTier(cost({ delta: 0 }))).toBe('free');
    expect(switchTier(cost({ delta: -5 }))).toBe('free');
    expect(switchTier(cost({ delta: 40 }))).toBe('costly');
    // A collision is its own tier: the penalty dwarfs every comfort term, so the raw number
    // says nothing useful beyond "no".
    expect(switchTier(cost({ delta: 100_000, collides: true }))).toBe('blocked');
  });

  it('says what the switch would do, in points and in words', () => {
    expect(describeSwitchCost(cost({ delta: 0 }))).toBe('same score as your current group');
    expect(describeSwitchCost(cost({ delta: 42.4 }))).toBe('+42 points if you switched to this');
    expect(describeSwitchCost(cost({ delta: -12 }))).toBe('-12 points — better than your current group');
    expect(describeSwitchCost(cost({ delta: 100_000, collides: true }))).toBe('would collide with another class');
  });

  it('never reports a rounding artefact as a difference', () => {
    expect(describeSwitchCost(cost({ delta: 0.4 }))).toBe('same score as your current group');
  });
});
