import { describe, expect, it } from 'vitest';
import { createLedger } from '../ledger';
import { findOverlaps } from '../overlap';
import { DEFAULT_PREFS } from '../presets';
import { scoreResolved } from '../score';
import type { CourseEvent, Prefs, Slot } from '../types';

function slot(day: Slot['day'], start: number, end: number, parity?: Slot['parity']): Slot {
  return { day, start, end, rooms: [], teachers: [], parity };
}

function event(id: string, subjectCode: string, kind: CourseEvent['kind'], slots: Slot[]): CourseEvent {
  return { id, subjectCode, kind, slots, teachers: [] };
}

/** What `scoreResolved` makes of the same week — the number the ledger has to reproduce. */
function reference(prefs: Prefs, dropped: Set<string>, events: CourseEvent[]): number {
  return scoreResolved(prefs, dropped, events, findOverlaps(events)).total;
}

function seminarCollisions(events: CourseEvent[]): number {
  return findOverlaps(events).filter((o) => o.kind === 'seminar').length;
}

const PROFILES: [string, Prefs][] = [
  ['defaults', DEFAULT_PREFS],
  ['cram', { ...DEFAULT_PREFS, compactness: 1, gaps: 0.9, gapShape: 0.15 }],
  ['spread', { ...DEFAULT_PREFS, compactness: -1, gaps: 0.2 }],
  ['half spread', { ...DEFAULT_PREFS, compactness: -0.5, gaps: 0.5 }],
  ['late start', { ...DEFAULT_PREFS, dayWindow: { start: 600, end: 1020 } }],
  ['capped', { ...DEFAULT_PREFS, maxClassesPerDay: 2 }],
  ['gaps off', { ...DEFAULT_PREFS, gaps: 0 }],
  ['day off', { ...DEFAULT_PREFS, daysOff: ['Pá'] }],
];

/**
 * The ledger is a second implementation of the objective, so the only thing worth asserting
 * about it is that it is the *same* objective. It sums per day where `scoreResolved` sums per
 * term, which moves totals by an ulp or two — hence a tolerance rather than exact equality.
 * That difference is also why `solve` re-scores its pool through `scoreResolved` before
 * returning: the ledger ranks candidates, it never reports a score.
 */
describe('createLedger — agrees with scoreResolved', () => {
  const lectures = [
    event('AA', 'AA', 'lecture', [slot('Po', 480, 570)]),
    event('BB', 'BB', 'lecture', [slot('St', 600, 690), slot('Pá', 480, 570)]),
  ];
  const groups = [
    event('CC/01', 'CC', 'seminar', [slot('Po', 600, 650)]),
    event('DD/01', 'DD', 'seminar', [slot('Út', 840, 890)]),
    event('EE/01', 'EE', 'seminar', [slot('Po', 900, 950), slot('Čt', 480, 530)]),
    event('FF/01', 'FF', 'seminar', [slot('St', 780, 830, 'odd')]),
    event('GG/01', 'GG', 'seminar', [slot('St', 780, 830, 'even')]),
  ];

  for (const [name, prefs] of PROFILES) {
    it(`matches on every subset of the week (${name})`, () => {
      // Every combination of the five groups: empty weeks, single days, fortnightly pairs
      // stacked on one hour, and multi-slot groups spanning two days.
      for (let mask = 0; mask < 1 << groups.length; mask++) {
        const chosen = groups.filter((_, i) => (mask & (1 << i)) !== 0);
        const ledger = createLedger(prefs, lectures, 0, chosen.length);
        chosen.forEach((group, depth) => ledger.place(group, depth));

        const events = [...lectures, ...chosen];
        expect(ledger.total(seminarCollisions(events))).toBeCloseTo(reference(prefs, new Set(), events), 9);
      }
    });
  }

  it('counts dropped lectures the same way', () => {
    const dropped = new Set(['BB']);
    const kept = lectures.filter((l) => !dropped.has(l.id));
    const ledger = createLedger(DEFAULT_PREFS, kept, dropped.size, 1);
    ledger.place(groups[0]!, 0);

    const events = [...kept, groups[0]!];
    expect(ledger.total(seminarCollisions(events))).toBeCloseTo(reference(DEFAULT_PREFS, dropped, events), 9);
  });

  it('prices a collision at the same rate as the scorer', () => {
    const clash = event('HH/01', 'HH', 'seminar', [slot('Po', 480, 570)]); // straight onto AA's lecture
    const ledger = createLedger(DEFAULT_PREFS, lectures, 0, 1);
    ledger.place(clash, 0);

    const events = [...lectures, clash];
    expect(seminarCollisions(events)).toBe(1);
    expect(ledger.total(seminarCollisions(events))).toBeCloseTo(reference(DEFAULT_PREFS, new Set(), events), 9);
  });
});

describe('createLedger — place/unplace is a true undo', () => {
  const lectures = [event('AA', 'AA', 'lecture', [slot('Po', 480, 570)])];
  const groups = [
    event('CC/01', 'CC', 'seminar', [slot('Po', 660, 710)]),
    event('DD/01', 'DD', 'seminar', [slot('Po', 600, 650)]), // lands *before* CC on the same day
    event('EE/01', 'EE', 'seminar', [slot('Po', 780, 830), slot('Út', 480, 530)]),
  ];

  it('restores the total after unwinding a descent, whatever the order', () => {
    const ledger = createLedger(DEFAULT_PREFS, lectures, 0, groups.length);
    const empty = ledger.total(0);

    // A slot inserted between two existing ones re-sorts the day; the undo has to survive that.
    for (const order of [
      [0, 1, 2],
      [2, 1, 0],
      [1, 2, 0],
    ]) {
      order.forEach((groupIndex, depth) => ledger.place(groups[groupIndex]!, depth));
      const full = ledger.total(0);
      expect(full).toBeCloseTo(reference(DEFAULT_PREFS, new Set(), [...lectures, ...groups]), 9);

      for (let depth = order.length - 1; depth >= 0; depth--) ledger.unplace(depth);
      expect(ledger.total(0)).toBe(empty);

      // And placing the same descent again lands on exactly the same number.
      order.forEach((groupIndex, depth) => ledger.place(groups[groupIndex]!, depth));
      expect(ledger.total(0)).toBe(full);
      for (let depth = order.length - 1; depth >= 0; depth--) ledger.unplace(depth);
    }
  });

  it('unwinds a partial descent without disturbing the levels above it', () => {
    const ledger = createLedger(DEFAULT_PREFS, lectures, 0, groups.length);
    ledger.place(groups[0]!, 0);
    const afterFirst = ledger.total(0);

    ledger.place(groups[1]!, 1);
    ledger.place(groups[2]!, 2);
    ledger.unplace(2);
    ledger.unplace(1);

    expect(ledger.total(0)).toBe(afterFirst);
  });
});
