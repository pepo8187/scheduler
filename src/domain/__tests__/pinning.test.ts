import { describe, expect, it } from 'vitest';
import { analyzePins } from '../analysis';
import { DEFAULT_PREFS } from '../presets';
import { derivePinnedGroups, solve } from '../solver';
import { pinRelief, switchCosts } from '../switching';
import type { CourseEvent, Day, LunchPrefs, Prefs, Selection, Slot, Subject, Timetable } from '../types';
import { buildFullSelection } from './selection';

function slot(day: Day, start: number, end: number): Slot {
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

const NO_LUNCH: LunchPrefs = DEFAULT_PREFS.lunch;
const prefs: Prefs = { ...DEFAULT_PREFS, seed: 'AAAA-2222' };

/**
 * A lecture anchoring Monday morning and one subject with three groups. The optimizer's own
 * answer is the Monday group — it piles onto a day already committed to — so pinning either of
 * the others is a visible, costly override rather than a no-op.
 */
const lecture = event('AA', 'AA', 'lecture', [slot('Po', 480, 590)]);
const nextToTheLecture = event('BB/01', 'BB', 'seminar', [slot('Po', 600, 710)], '01');
const onThursday = event('BB/02', 'BB', 'seminar', [slot('Čt', 600, 710)], '02');
const onFriday = event('BB/03', 'BB', 'seminar', [slot('Pá', 900, 1010)], '03');
const timetable = timetableOf([
  subject('AA', [lecture], []),
  subject('BB', [], [nextToTheLecture, onThursday, onFriday]),
]);

function pinning(seminarId: string, over: Partial<Selection[string]> = {}): Selection {
  const base = buildFullSelection(timetable);
  return { ...base, BB: { ...base.BB!, pinned: { [seminarId]: true }, ...over } };
}

describe('solve with a pin', () => {
  it('leaves the optimizer’s own answer alone when nothing is pinned', () => {
    const result = solve(timetable, buildFullSelection(timetable), prefs);
    expect(result.solutions[0]?.assignment.seminarChoice.BB).toBe('BB/01');
  });

  it('always schedules the pinned group, even though it scores worse', () => {
    const result = solve(timetable, pinning('BB/03'), prefs);
    for (const solution of result.solutions) {
      expect(solution.assignment.seminarChoice.BB).toBe('BB/03');
      expect(solution.events.some((e) => e.id === 'BB/03')).toBe(true);
    }
    // …and honestly: the pinned week really is worse than the free one.
    expect(result.solutions[0]!.score.total).toBeGreaterThan(
      solve(timetable, buildFullSelection(timetable), prefs).solutions[0]!.score.total,
    );
  });

  it('stops branching on a pinned subject, so the strip has nothing left to vary', () => {
    // The only decision variable is gone: every rung must be the same single assignment.
    const result = solve(timetable, pinning('BB/02'), prefs);
    expect(new Set(result.solutions.map((s) => s.assignment.seminarChoice.BB))).toEqual(new Set(['BB/02']));
    expect(result.solutions).toHaveLength(1);
  });

  it('keeps a pinned group a seminar, so a collision it causes is still charged', () => {
    const onTheLecture = event('BB/04', 'BB', 'seminar', [slot('Po', 480, 590)], '04');
    const clashing = timetableOf([
      subject('AA', [lecture], []),
      subject('BB', [], [nextToTheLecture, onTheLecture]),
    ]);
    const base = buildFullSelection(clashing);
    const selection: Selection = { ...base, BB: { ...base.BB!, pinned: { 'BB/04': true } } };
    const result = solve(clashing, selection, prefs);
    expect(result.solutions[0]!.assignment.seminarChoice.BB).toBe('BB/04');
    expect(result.solutions[0]!.overlaps.filter((o) => o.kind === 'seminar')).toHaveLength(1);
    expect(result.solutions[0]!.score.total).toBeGreaterThanOrEqual(prefs.tuning.seminarCollisionPerPair);
  });

  it('returns exactly what it does today when nothing is pinned', () => {
    const before = solve(timetable, buildFullSelection(timetable), prefs);
    const withEmptyPins = solve(
      timetable,
      { ...buildFullSelection(timetable), BB: { ...buildFullSelection(timetable).BB!, pinned: {} } },
      prefs,
    );
    expect(withEmptyPins.solutions.map((s) => s.assignment.seminarChoice.BB)).toEqual(
      before.solutions.map((s) => s.assignment.seminarChoice.BB),
    );
  });
});

describe('derivePinnedGroups — when a pin does not count', () => {
  it('ignores a pin on a group the user switched off', () => {
    const selection = pinning('BB/03', { seminars: { 'BB/01': true, 'BB/02': true, 'BB/03': false } });
    expect(derivePinnedGroups(timetable, selection, [], NO_LUNCH).has('BB')).toBe(false);
  });

  it('ignores a pin on a group reclassified as a lecture', () => {
    const selection = pinning('BB/03', { reclassified: { 'BB/03': true } });
    expect(derivePinnedGroups(timetable, selection, [], NO_LUNCH).has('BB')).toBe(false);
  });

  it('ignores a pin on a subject that is switched off entirely', () => {
    const selection = pinning('BB/03', { enabled: false });
    expect(derivePinnedGroups(timetable, selection, [], NO_LUNCH).has('BB')).toBe(false);
  });

  it('loses to a day off rather than producing an infeasible week', () => {
    const selection = pinning('BB/03'); // Friday
    expect(derivePinnedGroups(timetable, selection, ['Pá'], NO_LUNCH).has('BB')).toBe(false);
    const result = solve(timetable, selection, { ...prefs, daysOff: ['Pá'] });
    expect(result.solutions[0]!.assignment.seminarChoice.BB).not.toBe('BB/03');
    expect(result.solutions[0]!.events.every((e) => e.slots.every((s) => s.day !== 'Pá'))).toBe(true);
  });

  it('loses to the lunch block the same way', () => {
    const lunch: LunchPrefs = { enabled: true, default: { start: 690, end: 750 }, overrides: {} };
    const selection = pinning('BB/01'); // Po 10:00-11:50, straight through 11:30
    expect(derivePinnedGroups(timetable, selection, [], lunch).has('BB')).toBe(false);
  });
});

describe('analyzePins — a pin a hard constraint overruled is never silent', () => {
  it('fires when a day off takes the pinned group', () => {
    const conflicts = analyzePins(timetable, pinning('BB/03'), ['Pá'], NO_LUNCH);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.group.id).toBe('BB/03');
    expect(conflicts[0]!.reason).toBe('Friday is off');
  });

  it('fires when the lunch block takes it', () => {
    const lunch: LunchPrefs = { enabled: true, default: { start: 690, end: 750 }, overrides: {} };
    const conflicts = analyzePins(timetable, pinning('BB/01'), [], lunch);
    expect(conflicts.map((c) => c.reason)).toEqual(['it runs through your lunch break']);
  });

  it('stays quiet about a pin that is simply being honoured', () => {
    expect(analyzePins(timetable, pinning('BB/03'), [], NO_LUNCH)).toEqual([]);
    expect(analyzePins(timetable, buildFullSelection(timetable), ['Pá'], NO_LUNCH)).toEqual([]);
  });
});

describe('pinRelief — what the pins are costing', () => {
  it('names the pin and a floor on what un-pinning would recover', () => {
    const selection = pinning('BB/03');
    const solution = solve(timetable, selection, prefs).solutions[0]!;
    const relief = pinRelief(selection, switchCosts(timetable, selection, prefs, solution));
    expect(relief).toHaveLength(1);
    expect(relief[0]!.subjectCode).toBe('BB');
    expect(relief[0]!.groupId).toBe('BB/01'); // the optimizer's own answer
    expect(relief[0]!.saves).toBeGreaterThan(0);
  });

  it('reports nothing when the pin is on the group the optimizer would have picked anyway', () => {
    const selection = pinning('BB/01');
    const solution = solve(timetable, selection, prefs).solutions[0]!;
    expect(pinRelief(selection, switchCosts(timetable, selection, prefs, solution))).toEqual([]);
  });

  it('reports nothing at all when nothing is pinned', () => {
    const selection = buildFullSelection(timetable);
    const solution = solve(timetable, selection, prefs).solutions[0]!;
    expect(pinRelief(selection, switchCosts(timetable, selection, prefs, solution))).toEqual([]);
  });
});
