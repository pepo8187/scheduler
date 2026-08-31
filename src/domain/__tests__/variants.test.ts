import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTimetable } from '../parseTimetable';
import { DEFAULT_PREFS } from '../presets';
import { blockShapeKey } from '../shape';
import { solve } from '../solver';
import type { CourseEvent, Day, Prefs, Selection, Slot, Solution, Subject, Timetable } from '../types';
import { collectVariants, describeVariantChanges, VARIANT_LIMIT } from '../variants';

function slot(day: Day, start: number, end: number): Slot {
  return { day, start, end, rooms: [], teachers: [] };
}

function event(id: string, subjectCode: string, kind: CourseEvent['kind'], slots: Slot[], group?: string): CourseEvent {
  return { id, subjectCode, kind, group, slots, teachers: [] };
}

function subject(code: string, seminars: CourseEvent[]): Subject {
  return { code, name: code, subjectId: code, facultyUrl: '', periodUrl: '', lectures: [], seminars };
}

function solution(total: number, events: CourseEvent[], choice: Record<string, string | null>): Solution {
  return { assignment: { seminarChoice: choice, droppedLectures: new Set() }, events, overlaps: [], score: { total, terms: [] } };
}

const compare = (a: Solution, b: Solution) => a.score.total - b.score.total;

describe('collectVariants', () => {
  const shapeA = [event('AA/01', 'AA', 'seminar', [slot('Po', 480, 590)])];
  const shapeAAgain = [event('AA/02', 'AA', 'seminar', [slot('Po', 480, 590)])];
  const shapeAThird = [event('AA/03', 'AA', 'seminar', [slot('Po', 480, 590)])];
  const shapeB = [event('AA/09', 'AA', 'seminar', [slot('Čt', 480, 590)])];
  const key = (s: Solution) => blockShapeKey(s.events, []);

  const rungA = solution(100, shapeA, { AA: 'AA/01' });
  const rungB = solution(103, shapeB, { AA: 'AA/09' });
  const pool = [rungA, solution(101, shapeAAgain, { AA: 'AA/02' }), solution(102, shapeAThird, { AA: 'AA/03' }), rungB];

  it('hands each rung the pool members that share its shape', () => {
    const variants = collectVariants(pool, [rungA, rungB], key, compare);
    expect(variants[0]!.map((s) => s.score.total)).toEqual([101, 102]);
    expect(variants[1]).toEqual([]); // nothing else in the pool looks like the Thursday week
  });

  it('never reports a rung as a variant of itself, or of another rung', () => {
    const variants = collectVariants(pool, [rungA, rungB], key, compare);
    for (const list of variants) {
      expect(list).not.toContain(rungA);
      expect(list).not.toContain(rungB);
    }
  });

  it('keeps the list short, best first', () => {
    const many = [rungA, ...Array.from({ length: 10 }, (_, i) => solution(200 - i, shapeAAgain, { AA: `AA/1${i}` }))];
    const variants = collectVariants(many, [rungA], key, compare);
    expect(variants[0]).toHaveLength(VARIANT_LIMIT);
    expect(variants[0]!.map((s) => s.score.total)).toEqual([191, 192, 193, 194]);
  });
});

describe('describeVariantChanges', () => {
  const timetable: Timetable = {
    minHour: 480,
    maxHour: 1200,
    hours: [],
    subjects: [
      subject('AA', [
        event('AA/01', 'AA', 'seminar', [slot('Po', 600, 710)], '01'),
        event('AA/02', 'AA', 'seminar', [slot('Čt', 480, 590)], '02'),
      ]),
      subject('BB', [
        event('BB/01', 'BB', 'seminar', [slot('Čt', 480, 590)], '01'),
        event('BB/02', 'BB', 'seminar', [slot('Po', 600, 710)], '02'),
      ]),
    ],
    unscheduled: [],
  };

  const base = solution(50, [], { AA: 'AA/01', BB: 'BB/01' });
  const swapped = solution(50, [], { AA: 'AA/02', BB: 'BB/02' });

  it('names only what moved, and where it lands', () => {
    expect(describeVariantChanges(base, swapped, timetable)).toEqual([
      { subjectCode: 'AA', groupId: 'AA/02', when: 'Čt 08:00-09:50' },
      { subjectCode: 'BB', groupId: 'BB/02', when: 'Po 10:00-11:50' },
    ]);
  });

  it('says nothing about a subject that did not move', () => {
    const oneMoved = solution(50, [], { AA: 'AA/01', BB: 'BB/02' });
    expect(describeVariantChanges(base, oneMoved, timetable).map((c) => c.subjectCode)).toEqual(['BB']);
  });

  it('has nothing to report about an identical labelling', () => {
    expect(describeVariantChanges(base, base, timetable)).toEqual([]);
  });
});

describe('variants on a real export', () => {
  const timetable = parseTimetable(readFileSync(resolve(process.cwd(), 'public/podzim22-timetable.xml'), 'utf8'));
  const selection: Selection = {};
  const codes = timetable.subjects.map((s) => s.code).slice(0, 5);
  for (const subj of timetable.subjects) {
    selection[subj.code] = {
      enabled: codes.includes(subj.code),
      lectures: Object.fromEntries(subj.lectures.map((l) => [l.id, { enabled: true, required: false }])),
      seminars: Object.fromEntries(subj.seminars.map((s) => [s.id, true])),
      reclassified: {},
      pinned: {},
    };
  }
  const prefs: Prefs = { ...DEFAULT_PREFS, seed: 'AAAA-2222' };
  const result = solve(timetable, selection, prefs);

  it('reports one list per rung', () => {
    expect(result.variants).toHaveLength(result.solutions.length);
  });

  it('finds real swaps — the strip does hide them', () => {
    expect(result.variants.some((list) => list.length > 0)).toBe(true);
  });

  it('every variant is the same week and the same score as its rung', () => {
    // The property the whole feature rests on: the objective never reads subject identity, so a
    // relabelling of the same blocks cannot score differently.
    result.variants.forEach((list, index) => {
      const rung = result.solutions[index]!;
      for (const variant of list) {
        expect(blockShapeKey(variant.events, timetable.hours)).toBe(blockShapeKey(rung.events, timetable.hours));
        expect(variant.score.total).toBe(rung.score.total);
      }
    });
  });

  it('every variant genuinely moves at least two subjects', () => {
    // One subject alone cannot change slot without changing the shape, so a "variant" naming a
    // single move would mean the shape key had let something through.
    result.variants.forEach((list, index) => {
      for (const variant of list) {
        expect(describeVariantChanges(result.solutions[index]!, variant, timetable).length).toBeGreaterThanOrEqual(2);
      }
    });
  });
});
