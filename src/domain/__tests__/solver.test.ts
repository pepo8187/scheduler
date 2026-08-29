import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS } from '../presets';
import { parseTimetable } from '../parseTimetable';
import { computeScore } from '../score';
import { deriveDroppedLectures, solve } from '../solver';
import type { Assignment, CourseEvent, Prefs, Slot, Subject, Timetable } from '../types';
import { buildFullSelection } from './selection';
import { readSampleXml } from './sample';

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

describe('solve — known answer', () => {
  it('picks the only collision-free seminar group when one exists', () => {
    const lecture = event('AA', 'AA', 'lecture', [slot('Po', 480, 570)]);
    const goodGroup = event('BB/01', 'BB', 'seminar', [slot('Út', 480, 570)], '01');
    const badGroup = event('BB/02', 'BB', 'seminar', [slot('Po', 480, 570)], '02'); // overlaps AA's lecture
    const timetable = timetableOf([subject('AA', [lecture], []), subject('BB', [], [goodGroup, badGroup])]);
    const selection = buildFullSelection(timetable);

    const result = solve(timetable, selection, DEFAULT_PREFS);

    expect(result.provenOptimal).toBe(true);
    expect(result.solutions[0]?.assignment.seminarChoice.BB).toBe('BB/01');
    expect(result.solutions[0]?.score.total).toBe(0);
  });

  it('drops a non-★ lecture to honour a day off, but never a ★ one', () => {
    const nonStarred = event('AA', 'AA', 'lecture', [slot('Pá', 480, 570)]);
    const timetable = timetableOf([subject('AA', [nonStarred], [])]);
    const selection = buildFullSelection(timetable);

    const prefs: Prefs = { ...DEFAULT_PREFS, daysOff: ['Pá'] };
    const result = solve(timetable, selection, prefs);

    expect(result.solutions[0]?.events).toHaveLength(0);
    expect(result.solutions[0]?.assignment.droppedLectures.has('AA')).toBe(true);
    expect(result.solutions[0]?.score.terms.find((t) => t.key === 'droppedLecture')?.detail).toBe('1 dropped');
  });

  it('falls back to "no seminar chosen" once the user disables every group, without penalty', () => {
    const lecture = event('AA', 'AA', 'lecture', [slot('Po', 480, 570)]);
    const collidingGroup = event('BB/01', 'BB', 'seminar', [slot('Po', 480, 570)], '01'); // overlaps AA
    const timetable = timetableOf([subject('AA', [lecture], []), subject('BB', [], [collidingGroup])]);
    const selection = buildFullSelection(timetable);
    selection.BB!.seminars['BB/01'] = false; // user disables the only group -> lecture-only for AA is moot here

    const result = solve(timetable, selection, DEFAULT_PREFS);
    expect(result.solutions[0]?.assignment.seminarChoice.BB).toBeNull();
    expect(result.solutions[0]?.score.total).toBe(0);
  });
});

describe('solve — never fails', () => {
  it('still returns a schedule when every option for a subject collides', () => {
    const lecture = event('AA', 'AA', 'lecture', [slot('Po', 480, 570)]);
    const onlyGroup = event('BB/01', 'BB', 'seminar', [slot('Po', 480, 570)], '01'); // always collides
    const timetable = timetableOf([subject('AA', [lecture], []), subject('BB', [], [onlyGroup])]);
    const selection = buildFullSelection(timetable);

    const result = solve(timetable, selection, DEFAULT_PREFS);

    expect(result.solutions).toHaveLength(1);
    expect(result.solutions[0]?.assignment.seminarChoice.BB).toBe('BB/01');
    expect(result.solutions[0]?.overlaps).toHaveLength(1);
    expect(result.solutions[0]?.overlaps[0]?.kind).toBe('seminar');
    expect(result.solutions[0]?.score.total).toBeGreaterThan(0);
  });

  it('returns a (trivial) schedule when there are no subjects at all', () => {
    const timetable = timetableOf([]);
    const result = solve(timetable, {}, DEFAULT_PREFS);
    expect(result.solutions).toHaveLength(1);
    expect(result.solutions[0]?.events).toHaveLength(0);
    expect(result.provenOptimal).toBe(true);
  });
});

describe('solve — node budget fallback', () => {
  it('labels the result not-proven-optimal once the budget is exceeded, and still returns solutions', () => {
    const lecture = event('AA', 'AA', 'lecture', [slot('Po', 480, 570)]);
    const groupA = event('BB/01', 'BB', 'seminar', [slot('Út', 480, 570)], '01');
    const groupB = event('BB/02', 'BB', 'seminar', [slot('St', 480, 570)], '02');
    const timetable = timetableOf([subject('AA', [lecture], []), subject('BB', [], [groupA, groupB])]);
    const selection = buildFullSelection(timetable);

    const result = solve(timetable, selection, DEFAULT_PREFS, { nodeBudget: 0, random: () => 0 });
    expect(result.provenOptimal).toBe(false);
    expect(result.solutions.length).toBeGreaterThan(0);
  });
});

describe('solve — brute-force cross-check on the real sample', () => {
  function bruteForceMinimum(timetable: Timetable, selection: ReturnType<typeof buildFullSelection>, prefs: Prefs): number {
    const droppedLectures = deriveDroppedLectures(timetable, selection, prefs.daysOff);
    const subjectsWithSeminars = timetable.subjects.filter(
      (s) => selection[s.code]?.enabled && s.seminars.length > 0,
    );
    const domains = subjectsWithSeminars.map((s) => {
      const enabledGroups = s.seminars.filter((g) => selection[s.code]!.seminars[g.id]);
      const survivors = enabledGroups.filter((g) => !g.slots.some((sl) => prefs.daysOff.includes(sl.day)));
      return { code: s.code, options: (survivors.length > 0 ? survivors.map((g) => g.id) : [null]) as (string | null)[] };
    });

    let best = Infinity;
    const choice: Record<string, string | null> = {};
    function rec(i: number): void {
      if (i === domains.length) {
        const assignment: Assignment = { seminarChoice: { ...choice }, droppedLectures };
        const score = computeScore(timetable, selection, prefs, assignment);
        best = Math.min(best, score.total);
        return;
      }
      for (const option of domains[i]!.options) {
        choice[domains[i]!.code] = option;
        rec(i + 1);
      }
    }
    rec(0);
    return best;
  }

  it('the top-ranked solution matches a direct brute-force minimum over all 48 combinations', () => {
    const timetable = parseTimetable(readSampleXml());
    const selection = buildFullSelection(timetable);

    const result = solve(timetable, selection, DEFAULT_PREFS);
    const bruteBest = bruteForceMinimum(timetable, selection, DEFAULT_PREFS);

    expect(result.provenOptimal).toBe(true);
    expect(result.solutions[0]?.score.total).toBe(bruteBest);
  });

  it('still matches brute force once Friday is off and the MA010 trade-off is forced', () => {
    const timetable = parseTimetable(readSampleXml());
    const selection = buildFullSelection(timetable);
    const prefs: Prefs = { ...DEFAULT_PREFS, daysOff: ['Pá'] };

    const result = solve(timetable, selection, prefs);
    const bruteBest = bruteForceMinimum(timetable, selection, prefs);

    expect(result.solutions[0]?.score.total).toBe(bruteBest);
    expect(result.solutions[0]?.assignment.seminarChoice.MA010).toBeNull(); // no Friday-free group survives
  });
});
