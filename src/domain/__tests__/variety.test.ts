import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS } from '../presets';
import { dayAffinity, unitFrom } from '../random';
import { blockShapeKey, dayLoadKey } from '../shape';
import type { CourseEvent, Day, Prefs, Slot, Solution } from '../types';
import {
  affinityMismatch,
  assignmentKey,
  dayLoad,
  interchangeableFor,
  pickVariety,
  selectDiverse,
  varietyTolerance,
  weekShapeKey,
} from '../variety';

function slot(day: Day, start: number, end: number): Slot {
  return { day, start, end, rooms: [], teachers: [] };
}

function event(id: string, slots: Slot[]): CourseEvent {
  return { id, subjectCode: id.split('/')[0]!, kind: 'seminar', slots, teachers: [] };
}

/** A solution stub: only score, events and seminarChoice matter to anything in this module. */
function solution(total: number, events: CourseEvent[], choice: Record<string, string | null> = {}): Solution {
  return {
    assignment: { seminarChoice: choice, droppedLectures: new Set() },
    events,
    overlaps: [],
    score: { total, terms: [] },
  };
}

const prefsWith = (over: Partial<Prefs>): Prefs => ({ ...DEFAULT_PREFS, ...over });

describe('varietyTolerance', () => {
  it('is zero when the slider is off, and the full budget at the top', () => {
    expect(varietyTolerance(prefsWith({ variety: 0 }))).toBe(0);
    expect(varietyTolerance(prefsWith({ variety: 1 }))).toBe(DEFAULT_PREFS.tuning.varietyToleranceMax);
    expect(varietyTolerance(prefsWith({ variety: 0.5 }))).toBe(DEFAULT_PREFS.tuning.varietyToleranceMax / 2);
  });

  it('survives preferences restored from storage that predate the setting', () => {
    // A persisted `variety` of undefined must not become NaN and poison every comparison.
    expect(varietyTolerance(prefsWith({ variety: undefined as unknown as number }))).toBe(0);
    expect(varietyTolerance(prefsWith({ variety: 5 }))).toBe(DEFAULT_PREFS.tuning.varietyToleranceMax);
    expect(varietyTolerance(prefsWith({ variety: -3 }))).toBe(0);
  });
});

describe('dayLoad / weekShapeKey', () => {
  it('totals class minutes per day across every slot', () => {
    const load = dayLoad([event('AA', [slot('Po', 480, 570), slot('St', 600, 700)]), event('BB', [slot('Po', 600, 660)])]);
    expect(load.get('Po')).toBe(150);
    expect(load.get('St')).toBe(100);
    expect(load.has('Út')).toBe(false);
  });

  it('gives two weeks the same shape key exactly when their days and loads match', () => {
    const a = weekShapeKey([event('AA/01', [slot('Po', 480, 570)])]);
    const sameShape = weekShapeKey([event('AA/07', [slot('Po', 480, 570)])]); // a different group, same slot
    const otherDay = weekShapeKey([event('AA/01', [slot('Út', 480, 570)])]);
    expect(a).toBe(sameShape);
    expect(a).not.toBe(otherDay);
  });
});

describe('affinityMismatch', () => {
  const affinity = dayAffinity('7QF3-2K91');
  const best = affinity.order[0]!;
  const worst = affinity.order[4]!;

  it('is 0 on the seed’s best day and 1 on its worst', () => {
    expect(affinityMismatch([event('AA', [slot(best, 480, 570)])], affinity)).toBe(0);
    expect(affinityMismatch([event('AA', [slot(worst, 480, 570)])], affinity)).toBe(1);
  });

  it('weights by minutes, so a long day pulls harder than a short one', () => {
    const mostlyBest = [event('AA', [slot(best, 480, 720)]), event('BB', [slot(worst, 480, 510)])];
    const mostlyWorst = [event('AA', [slot(best, 480, 510)]), event('BB', [slot(worst, 480, 720)])];
    expect(affinityMismatch(mostlyBest, affinity)).toBeLessThan(affinityMismatch(mostlyWorst, affinity));
  });

  it('has nothing to say about an empty week', () => {
    expect(affinityMismatch([], affinity)).toBe(0);
  });
});

describe('pickVariety', () => {
  const affinity = dayAffinity('7QF3-2K91');
  const best = affinity.order[0]!;
  const worst = affinity.order[4]!;

  it('stays on the strict optimum while the slider is off, whatever the seed', () => {
    const solutions = [
      solution(100, [event('AA', [slot(worst, 480, 570)])], { AA: 'AA/01' }),
      solution(101, [event('AA', [slot(best, 480, 570)])], { AA: 'AA/02' }),
    ];
    const pick = pickVariety(solutions, prefsWith({ seed: '7QF3-2K91', variety: 0 }));
    expect(pick.index).toBe(0);
    expect(pick.cost).toBe(0);
  });

  it('trades points inside the budget for a week that leans the seed’s way', () => {
    const solutions = [
      solution(100, [event('AA', [slot(worst, 480, 570)])], { AA: 'AA/01' }),
      solution(110, [event('AA', [slot(best, 480, 570)])], { AA: 'AA/02' }),
    ];
    const pick = pickVariety(solutions, prefsWith({ seed: '7QF3-2K91', variety: 1 }));
    expect(pick.index).toBe(1);
    expect(pick.cost).toBe(10);
    expect(pick.bandSize).toBe(2);
  });

  it('never reaches past the budget, however much better the lean would be', () => {
    const budget = DEFAULT_PREFS.tuning.varietyToleranceMax;
    const solutions = [
      solution(100, [event('AA', [slot(worst, 480, 570)])], { AA: 'AA/01' }),
      solution(100 + budget + 1, [event('AA', [slot(best, 480, 570)])], { AA: 'AA/02' }),
    ];
    const pick = pickVariety(solutions, prefsWith({ seed: '7QF3-2K91', variety: 1 }));
    expect(pick.index).toBe(0);
    expect(pick.cost).toBe(0);
    expect(pick.bandSize).toBe(1);
  });

  it('takes a free swap when the band holds an exactly-tied alternative', () => {
    const solutions = [
      solution(100, [event('AA', [slot(worst, 480, 570)])], { AA: 'AA/01' }),
      solution(100, [event('AA', [slot(best, 480, 570)])], { AA: 'AA/02' }),
    ];
    const pick = pickVariety(solutions, prefsWith({ seed: '7QF3-2K91', variety: 0.5 }));
    expect(pick.index).toBe(1);
    expect(pick.cost).toBe(0); // a different week, at no cost at all
  });

  it('sends different seeds to different weeks, and each seed to a stable one', () => {
    const solutions = (['Po', 'Út', 'St', 'Čt', 'Pá'] as Day[]).map((day, i) =>
      solution(100 + i, [event(`AA/0${i}`, [slot(day, 480, 570)])], { AA: `AA/0${i}` }),
    );
    const picks = new Set<number>();
    for (const seed of ['AAAA-2222', 'BBBB-3333', 'CCCC-4444', 'DDDD-5555', 'EEEE-6666', 'FFFF-7777']) {
      const prefs = prefsWith({ seed, variety: 1 });
      const pick = pickVariety(solutions, prefs);
      expect(pickVariety(solutions, prefs).index).toBe(pick.index); // same seed, same answer
      picks.add(pick.index);
    }
    expect(picks.size).toBeGreaterThan(1);
  });

  it('copes with having nothing to choose from', () => {
    const pick = pickVariety([], prefsWith({ seed: '7QF3-2K91', variety: 1 }));
    expect(pick.index).toBe(0);
    expect(pick.bandSize).toBe(0);
  });
});

describe('selectDiverse', () => {
  const compare = (a: Solution, b: Solution) => a.score.total - b.score.total;

  it('prefers distinct week shapes over near-duplicates of the best one', () => {
    // Three ways to spell the same Monday week, then one that actually differs.
    const pool = [
      solution(100, [event('AA/01', [slot('Po', 480, 570)])]),
      solution(101, [event('AA/02', [slot('Po', 480, 570)])]),
      solution(102, [event('AA/03', [slot('Po', 480, 570)])]),
      solution(103, [event('AA/04', [slot('Čt', 480, 570)])]),
    ];
    const chosen = selectDiverse(pool, 2, compare);
    expect(chosen.map((s) => s.score.total)).toEqual([100, 103]);
  });

  it('backfills with duplicates rather than returning fewer than asked for', () => {
    const pool = [
      solution(100, [event('AA/01', [slot('Po', 480, 570)])]),
      solution(101, [event('AA/02', [slot('Po', 480, 570)])]),
    ];
    expect(selectDiverse(pool, 5, compare)).toHaveLength(2);
    expect(selectDiverse(pool, 2, compare).map((s) => s.score.total)).toEqual([100, 101]);
  });

  it('always hands back a list sorted by the comparator', () => {
    const pool = [
      solution(100, [event('AA/01', [slot('Po', 480, 570)])]),
      solution(101, [event('AA/02', [slot('Út', 480, 570)])]),
      solution(102, [event('AA/03', [slot('St', 480, 570)])]),
    ];
    const chosen = selectDiverse(pool, 3, compare);
    expect(chosen.map((s) => s.score.total)).toEqual([100, 101, 102]);
  });
});

describe('selectDiverse — coarse to fine', () => {
  const compare = (a: Solution, b: Solution) => a.score.total - b.score.total;
  // The 08:00-19:50 teaching grid every MUNI export declares, abbreviated to what these use.
  const hours = [480, 540, 600, 660, 720, 780, 840, 900].map((start) => ({ start, end: start + 50 }));
  const keys = [
    (s: Solution) => dayLoadKey(s.events),
    (s: Solution) => blockShapeKey(s.events, hours),
  ];

  /**
   * Three day loads x four block shapes, all 110 minutes on one day so the day loads are equal
   * within a group and the block shapes differ inside it. Scores ascend in day-load order, so
   * a plain best-first top three would take three spellings of the Monday week.
   */
  const pool: Solution[] = [];
  (['Po', 'Út', 'St'] as Day[]).forEach((day, d) => {
    for (let b = 0; b < 4; b++) {
      const start = 480 + b * 120;
      pool.push(solution(100 + d * 4 + b, [event(`AA/${d}${b}`, [slot(day, start, start + 110)])], { AA: `AA/${d}${b}` }));
    }
  });

  it('fills the first rungs from distinct day loads rather than from the best score', () => {
    const chosen = selectDiverse(pool, 3, compare, keys);
    expect(chosen.map((s) => s.score.total)).toEqual([100, 104, 108]);
    expect(new Set(chosen.map(keys[0]!)).size).toBe(3);
  });

  it('backfills the rest from block shapes the strip has not shown yet', () => {
    const chosen = selectDiverse(pool, 6, compare, keys);
    // Still the three distinct day loads, plus three finer variations — and no repeats.
    expect(new Set(chosen.map(keys[0]!)).size).toBe(3);
    expect(new Set(chosen.map(keys[1]!)).size).toBe(6);
    expect(chosen.map((s) => s.score.total)).toEqual([100, 101, 102, 103, 104, 108]);
  });

  it('never returns more than the pool holds, whatever the keys', () => {
    expect(selectDiverse(pool, 40, compare, keys)).toHaveLength(pool.length);
  });

  it('still works with one key, so the old single-shape call is unchanged', () => {
    const chosen = selectDiverse(pool, 3, compare);
    expect(chosen.map((s) => s.score.total)).toEqual([100, 104, 108]);
  });
});

describe('selectDiverse — the representative of a class is its best member', () => {
  // Once times are canonicalised a class can hold members that do *not* score the same (15:40
  // and 15:50 share a block shape and are ten minutes of real class time apart), so an
  // arbitrary pick could hand a student a strictly worse week with the better one hidden
  // inside the rung. Sorting by `compare` up front is what prevents that.
  const members = [140, 100, 175, 120].map((total, i) =>
    solution(total, [event(`AA/0${i}`, [slot('Po', 480, 590)])], { AA: `AA/0${i}` }),
  );

  it('yields the best member for every seed, whatever order the pool arrived in', () => {
    for (const seed of ['AAAA-2222', 'BBBB-3333', 'CCCC-4444', 'DDDD-5555']) {
      // A score-first comparator with a seeded tie-break, exactly like the solver's own.
      const compare = (a: Solution, b: Solution) =>
        a.score.total - b.score.total ||
        unitFrom(seed, 'rank', assignmentKey(a.assignment)) - unitFrom(seed, 'rank', assignmentKey(b.assignment));
      const shuffled = [...members].sort(
        (a, b) => unitFrom(seed, 'shuffle', assignmentKey(a.assignment)) - unitFrom(seed, 'shuffle', assignmentKey(b.assignment)),
      );
      expect(selectDiverse(shuffled, 1, compare)[0]!.score.total).toBe(100);
    }
  });
});

describe('assignmentKey', () => {
  it('is order-independent, so the same assignment always keys the same', () => {
    const a = assignmentKey({ seminarChoice: { BB: 'BB/01', AA: 'AA/02' }, droppedLectures: new Set() });
    const b = assignmentKey({ seminarChoice: { AA: 'AA/02', BB: 'BB/01' }, droppedLectures: new Set() });
    expect(a).toBe(b);
  });

  it('distinguishes "no seminar chosen" from a chosen one', () => {
    const none = assignmentKey({ seminarChoice: { AA: null }, droppedLectures: new Set() });
    const some = assignmentKey({ seminarChoice: { AA: 'AA/01' }, droppedLectures: new Set() });
    expect(none).not.toBe(some);
  });
});

describe('interchangeableFor', () => {
  const groups = [
    { subjectCode: 'AA', representativeId: 'AA/03' },
    { subjectCode: 'BB', representativeId: 'BB/01' },
  ];

  it('keeps only the sets whose representative is the group actually scheduled', () => {
    // A representative can be collapsed and then dropped by forward checking, or simply not be
    // the value the search chose — reporting it as "your group" would name a group off the grid.
    const chosen = solution(0, [], { AA: 'AA/03', BB: 'BB/07' });
    expect(interchangeableFor(groups, chosen)).toEqual([groups[0]]);
  });

  it('reports nothing when a subject ended up lecture-only, or when there is no solution', () => {
    expect(interchangeableFor(groups, solution(0, [], { AA: null, BB: null }))).toEqual([]);
    expect(interchangeableFor(groups, null)).toEqual([]);
    expect(interchangeableFor(groups, undefined)).toEqual([]);
  });
});
