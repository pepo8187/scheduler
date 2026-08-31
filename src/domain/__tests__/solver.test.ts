import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS } from '../presets';
import { parseTimetable } from '../parseTimetable';
import { computeScore } from '../score';
import { blockShapeKey, dayLoadKey } from '../shape';
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

describe('solve — reclassified seminars', () => {
  it('treats a reclassified seminar as fixed: it never competes for the seminar choice, and colliding with another subject\'s lecture costs nothing (unavoidable, like a real lecture)', () => {
    const lecture = event('AA', 'AA', 'lecture', [slot('Po', 480, 570)]);
    const demo = event('BB/01', 'BB', 'seminar', [slot('Po', 480, 570)], '01'); // overlaps AA's lecture
    const timetable = timetableOf([subject('AA', [lecture], []), subject('BB', [], [demo])]);
    const selection = buildFullSelection(timetable);
    selection.BB!.reclassified['BB/01'] = true;

    const result = solve(timetable, selection, DEFAULT_PREFS);

    expect(result.solutions[0]?.assignment.seminarChoice.BB).toBeNull(); // not a search choice any more
    expect(result.solutions[0]?.events.map((e) => e.id).sort()).toEqual(['AA', 'BB/01']);
    expect(result.solutions[0]?.overlaps[0]?.kind).toBe('lecture-lecture'); // free, not a seminarCollision
    expect(penaltyExcludingSparseDays(result.solutions[0]!.score)).toBe(0);
  });

  it('drops a reclassified seminar to honour a day off, exactly like a non-★ lecture', () => {
    const demo = event('BB/01', 'BB', 'seminar', [slot('Pá', 480, 570)], '01');
    const timetable = timetableOf([subject('BB', [], [demo])]);
    const selection = buildFullSelection(timetable);
    selection.BB!.reclassified['BB/01'] = true;

    const dropped = deriveDroppedLectures(timetable, selection, ['Pá']);
    expect(dropped.has('BB/01')).toBe(true);

    const prefs: Prefs = { ...DEFAULT_PREFS, daysOff: ['Pá'] };
    const result = solve(timetable, selection, prefs);
    expect(result.solutions[0]?.events).toHaveLength(0);
  });

  it('lets several reclassified groups of the same subject be attended together, not just one', () => {
    const demoA = event('BB/01', 'BB', 'seminar', [slot('Po', 480, 570)], '01');
    const demoB = event('BB/02', 'BB', 'seminar', [slot('Út', 480, 570)], '02');
    const timetable = timetableOf([subject('BB', [], [demoA, demoB])]);
    const selection = buildFullSelection(timetable);
    selection.BB!.reclassified['BB/01'] = true;
    selection.BB!.reclassified['BB/02'] = true;

    const result = solve(timetable, selection, DEFAULT_PREFS);
    expect(result.solutions[0]?.events.map((e) => e.id).sort()).toEqual(['BB/01', 'BB/02']);
  });

  it('leaves attendance toggleable independently of the reclassification itself', () => {
    const demo = event('BB/01', 'BB', 'seminar', [slot('Po', 480, 570)], '01');
    const timetable = timetableOf([subject('BB', [], [demo])]);
    const selection = buildFullSelection(timetable);
    selection.BB!.reclassified['BB/01'] = true;
    selection.BB!.seminars['BB/01'] = false; // user doesn't want to attend, but it's still a lecture

    const result = solve(timetable, selection, DEFAULT_PREFS);
    expect(result.solutions[0]?.events).toHaveLength(0);
    expect(selection.BB!.reclassified['BB/01']).toBe(true);
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

describe('solve — variation across a cohort', () => {
  /** One subject, `count` groups all meeting at the same hour: interchangeable by construction. */
  function parallelGroups(count: number): { timetable: Timetable; selection: ReturnType<typeof buildFullSelection> } {
    const lecture = event('AA', 'AA', 'lecture', [slot('Po', 480, 570)]);
    const groups = Array.from({ length: count }, (_, i) =>
      event(`BB/${String(i).padStart(2, '0')}`, 'BB', 'seminar', [slot('Út', 480, 570)], String(i)),
    );
    const timetable = timetableOf([subject('AA', [lecture], []), subject('BB', [], groups)]);
    return { timetable, selection: buildFullSelection(timetable) };
  }

  it('hands different students different groups among interchangeable ones', () => {
    // The headline bug: 400 people with the same subjects used to receive group 01, every time.
    const { timetable, selection } = parallelGroups(8);
    const chosen = new Set<string | null | undefined>();
    for (const seed of ['AAAA-2222', 'BBBB-3333', 'CCCC-4444', 'DDDD-5555', 'EEEE-6666', 'FFFF-7777']) {
      const result = solve(timetable, selection, { ...DEFAULT_PREFS, seed });
      chosen.add(result.solutions[0]?.assignment.seminarChoice.BB);
    }
    expect(chosen.size).toBeGreaterThan(1);
  });

  it('gives one student the same group every time, so a slider nudge never reshuffles the week', () => {
    const { timetable, selection } = parallelGroups(8);
    const prefs: Prefs = { ...DEFAULT_PREFS, seed: '7QF3-2K91' };
    const first = solve(timetable, selection, prefs).solutions[0]?.assignment.seminarChoice.BB;
    expect(first).toBeTruthy();
    for (let i = 0; i < 5; i++) {
      expect(solve(timetable, selection, prefs).solutions[0]?.assignment.seminarChoice.BB).toBe(first);
    }
  });

  it('lets two friends land in the same group on purpose by sharing a seed', () => {
    const { timetable, selection } = parallelGroups(12);
    const mine = solve(timetable, selection, { ...DEFAULT_PREFS, seed: '7QF3-2K91' });
    const theirs = solve(timetable, selection, { ...DEFAULT_PREFS, seed: '7qf3-2k91'.toUpperCase() });
    expect(theirs.solutions[0]?.assignment.seminarChoice.BB).toBe(mine.solutions[0]?.assignment.seminarChoice.BB);
  });

  it('reports the interchangeable groups it collapsed, so the UI can show the headroom', () => {
    const { timetable, selection } = parallelGroups(8);
    const result = solve(timetable, selection, { ...DEFAULT_PREFS, seed: '7QF3-2K91' });

    expect(result.interchangeable).toHaveLength(1);
    const group = result.interchangeable[0]!;
    expect(group.subjectCode).toBe('BB');
    expect(group.memberIds).toHaveLength(8);
    expect(group.representativeId).toBe(result.solutions[0]?.assignment.seminarChoice.BB);
  });

  it('reports no headroom when every group genuinely meets at a different time', () => {
    const groups = (['Po', 'Út', 'St', 'Čt'] as Slot['day'][]).map((day, i) =>
      event(`BB/0${i}`, 'BB', 'seminar', [slot(day, 480, 570)], String(i)),
    );
    const timetable = timetableOf([subject('BB', [], groups)]);
    const result = solve(timetable, buildFullSelection(timetable), { ...DEFAULT_PREFS, seed: '7QF3-2K91' });
    expect(result.interchangeable).toEqual([]);
  });

  it('varies the choice without ever costing a point — the schedules score identically', () => {
    const { timetable, selection } = parallelGroups(8);
    const totals = new Set<number>();
    for (const seed of ['AAAA-2222', 'BBBB-3333', 'CCCC-4444', 'DDDD-5555']) {
      totals.add(solve(timetable, selection, { ...DEFAULT_PREFS, seed }).solutions[0]!.score.total);
    }
    expect(totals.size).toBe(1);
  });

  it('never lets the Variety slider buy a collision or a dropped lecture', () => {
    const lecture = event('AA', 'AA', 'lecture', [slot('Po', 480, 570)]);
    const colliding = event('BB/01', 'BB', 'seminar', [slot('Po', 480, 570)], '01');
    const clean = event('BB/02', 'BB', 'seminar', [slot('St', 480, 570)], '02');
    const timetable = timetableOf([subject('AA', [lecture], []), subject('BB', [], [colliding, clean])]);
    const selection = buildFullSelection(timetable);

    for (const seed of ['AAAA-2222', 'BBBB-3333', 'CCCC-4444', 'DDDD-5555', 'EEEE-6666']) {
      const result = solve(timetable, selection, { ...DEFAULT_PREFS, seed, variety: 1 });
      const picked = result.solutions[result.variety.index]!;
      expect(picked.assignment.seminarChoice.BB).toBe('BB/02');
      expect(picked.overlaps.filter((o) => o.kind === 'seminar')).toHaveLength(0);
    }
  });

  it('keeps the alternatives strip a truthful ladder: sorted by real score, pick merely marked', () => {
    const { timetable, selection } = parallelGroups(4);
    const result = solve(timetable, selection, { ...DEFAULT_PREFS, seed: '7QF3-2K91', variety: 1 });

    const totals = result.solutions.map((s) => s.score.total);
    expect([...totals].sort((a, b) => a - b)).toEqual(totals);
    expect(result.variety.index).toBeGreaterThanOrEqual(0);
    expect(result.variety.index).toBeLessThan(Math.max(1, result.solutions.length));
    // The price of the pick is exactly the gap to the top of that ladder — never a fudged score.
    expect(result.variety.cost).toBe(result.solutions[result.variety.index]!.score.total - totals[0]!);
  });

  it('stays on the strict optimum while the slider is off', () => {
    const spread = (['Po', 'Út', 'St', 'Čt', 'Pá'] as Slot['day'][]).map((day, i) =>
      event(`BB/0${i}`, 'BB', 'seminar', [slot(day, 480 + i * 30, 570 + i * 30)], String(i)),
    );
    const timetable = timetableOf([subject('BB', [], spread)]);
    const selection = buildFullSelection(timetable);

    for (const seed of ['AAAA-2222', 'BBBB-3333', 'CCCC-4444']) {
      const result = solve(timetable, selection, { ...DEFAULT_PREFS, seed });
      expect(result.variety.index).toBe(0);
      expect(result.variety.cost).toBe(0);
    }
  });

  it('spreads a cohort off the one best day once Variety is on', () => {
    // Five equally-good single-seminar weeks, one per weekday. With the slider off every
    // student gets the same one; with it on, the cohort fans out across the week.
    const spread = (['Po', 'Út', 'St', 'Čt', 'Pá'] as Slot['day'][]).map((day, i) =>
      event(`BB/0${i}`, 'BB', 'seminar', [slot(day, 480, 570)], String(i)),
    );
    const timetable = timetableOf([subject('BB', [], spread)]);
    const selection = buildFullSelection(timetable);
    const seeds = ['AAAA-2222', 'BBBB-3333', 'CCCC-4444', 'DDDD-5555', 'EEEE-6666', 'FFFF-7777', 'GGGG-8888'];

    const days = new Set(
      seeds.map((seed) => {
        const result = solve(timetable, selection, { ...DEFAULT_PREFS, seed, variety: 1 });
        return result.solutions[result.variety.index]!.events[0]!.slots[0]!.day;
      }),
    );
    expect(days.size).toBeGreaterThan(1);
  });
});

describe('solve — the alternatives strip is deduped by week shape', () => {
  /**
   * The dedupe runs for everyone now, not only with Variety on, so the podzim2023 export — no
   * fortnightly groups, uniform 110-minute slots, the one the app ships as an example — is the
   * regression to watch: the strip must not get *worse* for the plain default case.
   */
  const timetable = parseTimetable(readSampleXml());
  const selection = buildFullSelection(timetable);
  const prefs: Prefs = { ...DEFAULT_PREFS, seed: 'AAAA-2222' };

  it('still hands back a full ladder, sorted by real score, cheapest first', () => {
    const { solutions } = solve(timetable, selection, prefs);
    expect(solutions).toHaveLength(10);
    const totals = solutions.map((s) => s.score.total);
    expect([...totals].sort((a, b) => a - b)).toEqual(totals);
  });

  it('keeps the strict optimum at the head, where the variety marker and #1 both point', () => {
    const { solutions } = solve(timetable, selection, prefs);
    const wide = solve(timetable, selection, prefs, { topK: 60 });
    expect(solutions[0]!.score.total).toBe(Math.min(...wide.solutions.map((s) => s.score.total)));
  });

  it('spends its rungs on distinct weeks rather than on relabellings of one', () => {
    const { solutions } = solve(timetable, selection, prefs);
    // Day loads are the coarse key: before the dedupe this export's top ten held five of them.
    const dayLoads = new Set(solutions.map((s) => dayLoadKey(s.events)));
    expect(dayLoads.size).toBeGreaterThanOrEqual(6);
    // …and no two rungs are the same week with the labels moved around.
    const shapes = new Set(solutions.map((s) => blockShapeKey(s.events, timetable.hours)));
    expect(shapes.size).toBe(solutions.length);
  });

  it('is stable for a seed and reachable from another one', () => {
    const once = solve(timetable, selection, prefs).solutions.map((s) => s.score.total);
    const again = solve(timetable, selection, prefs).solutions.map((s) => s.score.total);
    expect(again).toEqual(once);
    expect(solve(timetable, selection, { ...prefs, seed: 'ZZZZ-9999' }).solutions).toHaveLength(10);
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
    expect(result.diagnostics.fallbackIterations).toBeGreaterThan(0);
  });

  it('unwinds the ledger correctly when the budget runs out mid-descent', () => {
    // A budget small enough to abandon the search partway down, so the DFS returns through
    // levels that have already placed a group into the ledger. If an abandoned descent left
    // the ledger dirty, the fallback's solutions would come back mis-scored.
    const WEEK: Slot['day'][] = ['Po', 'Út', 'St', 'Čt', 'Pá'];
    const subjects: Subject[] = [];
    for (let i = 0; i < 4; i++) {
      const code = `S${i}`;
      const seminars = Array.from({ length: 6 }, (_, g) =>
        event(`${code}/${g}`, code, 'seminar', [slot(WEEK[(i + g) % 5]!, 480 + g * 60, 530 + g * 60)], String(g)),
      );
      subjects.push(subject(code, [event(code, code, 'lecture', [slot('Po', 480 + i * 100, 550 + i * 100)])], seminars));
    }
    const timetable = timetableOf(subjects);
    const selection = buildFullSelection(timetable);

    const result = solve(timetable, selection, DEFAULT_PREFS, { nodeBudget: 50, random: () => 0.5 });

    expect(result.provenOptimal).toBe(false);
    expect(result.solutions.length).toBeGreaterThan(0);
    for (const solution of result.solutions) {
      expect(solution.score.total).toBe(computeScore(timetable, selection, DEFAULT_PREFS, solution.assignment).total);
    }
  });
});

describe('solve — every returned solution carries its own real score', () => {
  // The search ranks candidates on `domain/ledger.ts`, which is a filter and not the scorer, so
  // this is the invariant that keeps that an implementation detail: whatever comes back has been
  // re-derived through `scoreResolved` and agrees with scoring the assignment from scratch.
  const profiles: [string, Prefs][] = [
    ['defaults', DEFAULT_PREFS],
    ['cram', { ...DEFAULT_PREFS, compactness: 1, gaps: 0.9, gapShape: 0.15 }],
    ['spread', { ...DEFAULT_PREFS, compactness: -1, gaps: 0.2 }],
    ['late start, capped', { ...DEFAULT_PREFS, dayWindow: { start: 600, end: 1020 }, maxClassesPerDay: 2 }],
    ['Friday off', { ...DEFAULT_PREFS, daysOff: ['Pá'] }],
  ];

  for (const [name, prefs] of profiles) {
    it(`agrees with computeScore on the bundled export (${name})`, () => {
      const timetable = parseTimetable(readSampleXml());
      const selection = buildFullSelection(timetable);

      const result = solve(timetable, selection, prefs);

      expect(result.solutions.length).toBeGreaterThan(0);
      for (const solution of result.solutions) {
        const scored = computeScore(timetable, selection, prefs, solution.assignment);
        expect(solution.score.total).toBe(scored.total);
        expect(solution.score.terms).toEqual(scored.terms);
      }
    });
  }
});

describe('solve — diagnostics', () => {
  it('reports elapsed time and nodes visited, and nothing from the fallback on a proven-optimal solve', () => {
    const lecture = event('AA', 'AA', 'lecture', [slot('Po', 480, 570)]);
    const goodGroup = event('BB/01', 'BB', 'seminar', [slot('Út', 480, 570)], '01');
    const badGroup = event('BB/02', 'BB', 'seminar', [slot('Po', 480, 570)], '02');
    const timetable = timetableOf([subject('AA', [lecture], []), subject('BB', [], [goodGroup, badGroup])]);
    const selection = buildFullSelection(timetable);

    const result = solve(timetable, selection, DEFAULT_PREFS);

    expect(result.diagnostics.nodesVisited).toBeGreaterThan(0);
    expect(result.diagnostics.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.diagnostics.fallbackIterations).toBe(0);
  });

  it('samples onProgress on a search heavy enough to cross the sampling interval', () => {
    // 5 subjects x 8 seminar groups apiece, every slot globally distinct so nothing ever
    // collides — the scale the performance regression guard below uses, just enough of it to
    // reliably clear one 4096-node sampling interval without needing that test's full weight.
    const days = ['Po', 'Út', 'St', 'Čt', 'Pá'] as const;
    const subjects: Subject[] = [];
    for (let i = 0; i < 5; i++) {
      const seminars = Array.from({ length: 8 }, (_, j) => {
        const t = i * 8 + j;
        const day = days[t % 5]!;
        const start = 480 + Math.floor(t / 5) * 60;
        return event(`S${i}/${j}`, `S${i}`, 'seminar', [slot(day, start, start + 50)], String(j));
      });
      subjects.push(subject(`S${i}`, [], seminars));
    }
    const timetable = timetableOf(subjects);
    const selection = buildFullSelection(timetable);

    const samples: number[] = [];
    const result = solve(timetable, selection, DEFAULT_PREFS, { onProgress: (n) => samples.push(n) });

    expect(result.provenOptimal).toBe(true);
    expect(samples.length).toBeGreaterThan(0);
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeGreaterThan(samples[i - 1]!);
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
  // The per-test timeout has to clear the ceiling asserted below, or vitest aborts the run
  // before the assertion is ever reached and the failure looks like a hang, not a slow search.
  it('stays proven-optimal and fast on a heavy semester (5 subjects x ~15-45 wide-spread groups)', { timeout: 60_000 }, () => {
    // Mirrors the shape that used to blow the node budget: several subjects each with dozens
    // of seminar groups scattered across the week, no exploitable structure to shrink the
    // search other than branch-and-bound. This used to take tens of seconds; branch-and-bound
    // plus hoisted forward checking brought it to a few, and scoring each leaf from the
    // incremental ledger (`domain/ledger.ts`) rather than rebuilding the week took roughly
    // another factor of four off that.
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
    // A ceiling on catastrophe, not a benchmark: it exists to catch a change that makes the
    // search exponential again, so it has to clear the slowest CI box by a wide margin. The
    // headroom was widened when alternating-week parity entered `slotSignature`, which stops
    // odd/even twins collapsing into one representative and so roughly doubles the domains on
    // a fortnightly export, then narrowed again once the ledger took this shape to ~1.2 s on a
    // developer machine. Wall-clock on a shared runner varies several-fold; treat a real
    // regression as a change in *order*, not a creep in this number.
    expect(elapsedMs).toBeLessThan(10_000);
  });
});
