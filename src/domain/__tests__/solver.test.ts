import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS } from '../presets';
import { parseTimetable } from '../parseTimetable';
import { computeScore } from '../score';
import { deriveDroppedLectures, solve } from '../solver';
import type { Assignment, CourseEvent, Prefs, Score, Slot, Subject, Timetable } from '../types';
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

/**
 * Everything these fixtures are actually about: collisions, drops, dead time, day window.
 * The "barely-used days" term is deliberately excluded — these timetables carry an hour or two
 * of class in total, so every day in them is sparse by construction and that cost is an
 * unavoidable constant here, not a signal about the choice under test.
 */
function penaltyExcludingSparseDays(score: Score): number {
  return score.terms.filter((t) => t.key !== 'sparseDay').reduce((sum, t) => sum + t.cost, 0);
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
    expect(penaltyExcludingSparseDays(result.solutions[0]!.score)).toBe(0);
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
    expect(penaltyExcludingSparseDays(result.solutions[0]!.score)).toBe(0);
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
    expect(penaltyExcludingSparseDays(result.solutions[0]!.score)).toBeGreaterThan(0);
  });

  it('returns a (trivial) schedule when there are no subjects at all', () => {
    const timetable = timetableOf([]);
    const result = solve(timetable, {}, DEFAULT_PREFS);
    expect(result.solutions).toHaveLength(1);
    expect(result.solutions[0]?.events).toHaveLength(0);
    expect(result.provenOptimal).toBe(true);
  });
});

describe('solve — lunch block', () => {
  it('excludes a seminar group overlapping lunch when a collision-free alternative exists', () => {
    const lecture = event('AA', 'AA', 'lecture', [slot('Po', 480, 570)]);
    const duringLunch = event('BB/01', 'BB', 'seminar', [slot('Út', 630, 700)], '01'); // 10:30-11:40
    const clear = event('BB/02', 'BB', 'seminar', [slot('Út', 480, 570)], '02');
    const timetable = timetableOf([subject('AA', [lecture], []), subject('BB', [], [duringLunch, clear])]);
    const selection = buildFullSelection(timetable);
    const prefs: Prefs = { ...DEFAULT_PREFS, lunch: { enabled: true, default: { start: 600, end: 660 }, overrides: {} } };

    const result = solve(timetable, selection, prefs);
    expect(result.solutions[0]?.assignment.seminarChoice.BB).toBe('BB/02');
    expect(penaltyExcludingSparseDays(result.solutions[0]!.score)).toBe(0);
  });

  it('falls back to "no seminar chosen" once every group for a subject overlaps lunch, without penalty', () => {
    const onlyGroup = event('BB/01', 'BB', 'seminar', [slot('Po', 630, 700)], '01'); // 10:30-11:40
    const timetable = timetableOf([subject('BB', [], [onlyGroup])]);
    const selection = buildFullSelection(timetable);
    const prefs: Prefs = { ...DEFAULT_PREFS, lunch: { enabled: true, default: { start: 600, end: 660 }, overrides: {} } };

    const result = solve(timetable, selection, prefs);
    expect(result.solutions[0]?.assignment.seminarChoice.BB).toBeNull();
    expect(penaltyExcludingSparseDays(result.solutions[0]!.score)).toBe(0);
  });

  it('does nothing when lunch is disabled', () => {
    const onlyGroup = event('BB/01', 'BB', 'seminar', [slot('Po', 630, 700)], '01');
    const timetable = timetableOf([subject('BB', [], [onlyGroup])]);
    const selection = buildFullSelection(timetable);

    const result = solve(timetable, selection, DEFAULT_PREFS); // lunch off by default
    expect(result.solutions[0]?.assignment.seminarChoice.BB).toBe('BB/01');
  });

  it('respects a per-day override instead of the default window', () => {
    // Group meets during the Tuesday-specific lunch window (12:00-13:00) but not the default (10:00-11:00).
    const group = event('BB/01', 'BB', 'seminar', [slot('Út', 720, 780)], '01');
    const timetable = timetableOf([subject('BB', [], [group])]);
    const selection = buildFullSelection(timetable);
    const prefs: Prefs = {
      ...DEFAULT_PREFS,
      lunch: { enabled: true, default: { start: 600, end: 660 }, overrides: { Út: { start: 720, end: 780 } } },
    };

    const result = solve(timetable, selection, prefs);
    expect(result.solutions[0]?.assignment.seminarChoice.BB).toBeNull(); // excluded by the Tuesday override
  });

  it('a blacked-out day ignores the default window entirely', () => {
    const group = event('BB/01', 'BB', 'seminar', [slot('Po', 630, 700)], '01'); // would overlap the default
    const timetable = timetableOf([subject('BB', [], [group])]);
    const selection = buildFullSelection(timetable);
    const prefs: Prefs = {
      ...DEFAULT_PREFS,
      lunch: { enabled: true, default: { start: 600, end: 660 }, overrides: { Po: null } },
    };

    const result = solve(timetable, selection, prefs);
    expect(result.solutions[0]?.assignment.seminarChoice.BB).toBe('BB/01');
  });
});

describe('solve — group collapsing', () => {
  it('picks a collision-free representative among many groups sharing the exact same slot', () => {
    const lecture = event('AA', 'AA', 'lecture', [slot('Po', 480, 570)]);
    // 30 "BB" groups all meeting Tuesday 8:00-9:50 (e.g. the same lab taught by many TAs) —
    // interchangeable for scoring, so the solver should treat them as effectively one value.
    const identicalGroups = Array.from({ length: 30 }, (_, i) =>
      event(`BB/${String(i).padStart(2, '0')}`, 'BB', 'seminar', [slot('Út', 480, 570)], String(i)),
    );
    const timetable = timetableOf([subject('AA', [lecture], []), subject('BB', [], identicalGroups)]);
    const selection = buildFullSelection(timetable);

    const result = solve(timetable, selection, DEFAULT_PREFS);

    expect(result.provenOptimal).toBe(true);
    expect(penaltyExcludingSparseDays(result.solutions[0]!.score)).toBe(0);
    expect(identicalGroups.some((g) => g.id === result.solutions[0]?.assignment.seminarChoice.BB)).toBe(true);
  });

  it('never prefers a colliding group over a same-variable clean one, even when the clean one is not first', () => {
    const lecture = event('AA', 'AA', 'lecture', [slot('Po', 480, 570)]);
    const colliding = event('BB/01', 'BB', 'seminar', [slot('Po', 480, 570)], '01'); // overlaps AA
    const clean = event('BB/02', 'BB', 'seminar', [slot('St', 480, 570)], '02');
    const timetable = timetableOf([subject('AA', [lecture], []), subject('BB', [], [colliding, clean])]);
    const selection = buildFullSelection(timetable);

    const result = solve(timetable, selection, DEFAULT_PREFS);

    expect(result.solutions[0]?.assignment.seminarChoice.BB).toBe('BB/02');
    expect(penaltyExcludingSparseDays(result.solutions[0]!.score)).toBe(0);
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

  it('the top-ranked solution matches a direct brute-force minimum over all 23,250 combinations', () => {
    const timetable = parseTimetable(readSampleXml());
    const selection = buildFullSelection(timetable);

    const result = solve(timetable, selection, DEFAULT_PREFS);
    const bruteBest = bruteForceMinimum(timetable, selection, DEFAULT_PREFS);

    expect(result.provenOptimal).toBe(true);
    expect(result.solutions[0]?.score.total).toBe(bruteBest);
  });

  it('still matches brute force under custom tuning, so the search bound stays admissible', () => {
    // The bound prunes on `seminarCollisionPerPair` and `droppedLecturePerEvent`. If it kept
    // reading the defaults while the score used the user's values, it would prune away genuine
    // optima the moment anyone touched the Advanced panel.
    const timetable = parseTimetable(readSampleXml());
    const selection = buildFullSelection(timetable);
    const prefs: Prefs = {
      ...DEFAULT_PREFS,
      tuning: {
        ...DEFAULT_PREFS.tuning,
        seminarCollisionPerPair: 500, // low enough that comfort can rival a collision
        droppedLecturePerEvent: 50,
        gapFreeMinutes: 0,
        sparseDayWeight: 900,
        gapWeight: 12,
      },
    };

    const result = solve(timetable, selection, prefs);
    const bruteBest = bruteForceMinimum(timetable, selection, prefs);

    expect(result.provenOptimal).toBe(true);
    expect(result.solutions[0]?.score.total).toBe(bruteBest);
  });

  it('still matches brute force once Tuesday is off and the PV275 trade-off is forced', () => {
    const timetable = parseTimetable(readSampleXml());
    const selection = buildFullSelection(timetable);
    const prefs: Prefs = { ...DEFAULT_PREFS, daysOff: ['Út'] };

    const result = solve(timetable, selection, prefs);
    const bruteBest = bruteForceMinimum(timetable, selection, prefs);

    expect(result.solutions[0]?.score.total).toBe(bruteBest);
    expect(result.solutions[0]?.assignment.seminarChoice.PV275).toBeNull(); // no Tuesday-free group survives
  });
});

describe('solve — performance regression guard', () => {
  it('stays proven-optimal and fast on a heavy semester (5 subjects x ~15-45 wide-spread groups)', () => {
    // Mirrors the shape that used to blow the node budget: several subjects each with dozens
    // of seminar groups scattered across the week, no exploitable structure to shrink the
    // search other than branch-and-bound. This used to take tens of seconds; should now be
    // well under a second thanks to branch-and-bound + hoisted forward checking.
    const days: Slot['day'][] = ['Po', 'Út', 'St', 'Čt', 'Pá'];
    const subjects: Subject[] = [];
    const groupCounts = [15, 18, 23, 28, 35];
    for (let i = 0; i < groupCounts.length; i++) {
      const code = `S${i}`;
      const lecture = event(code, code, 'lecture', [slot(days[i % 5]!, 480 + (i % 4) * 100, 480 + (i % 4) * 100 + 90)]);
      const seminars: CourseEvent[] = [];
      for (let g = 0; g < groupCounts[i]!; g++) {
        const start = 480 + (g % 8) * 60;
        seminars.push(event(`${code}/${g}`, code, 'seminar', [slot(days[(i + g) % 5]!, start, start + 50)], String(g)));
      }
      subjects.push(subject(code, [lecture], seminars));
    }
    const timetable = timetableOf(subjects);
    const selection = buildFullSelection(timetable);

    const start = performance.now();
    const result = solve(timetable, selection, DEFAULT_PREFS);
    const elapsedMs = performance.now() - start;

    expect(result.provenOptimal).toBe(true);
    expect(elapsedMs).toBeLessThan(5_000); // generous margin; typically well under 1s
  });
});
