import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describeParity, eventParity, hasParity, parityCanCoincide, parseNoteParity, weekView } from '../parity';
import { parseTimetable } from '../parseTimetable';
import { eventsOverlap, findOverlaps, slotsOverlap } from '../overlap';
import { DEFAULT_PREFS } from '../presets';
import { scoreResolved } from '../score';
import { solve } from '../solver';
import { buildFullSelection } from './selection';
import type { CourseEvent, Prefs, Slot, Subject, Timetable, WeekParity } from '../types';

/** podzim2022 — the only bundled export that actually contains alternating-week groups. */
const PODZIM22 = resolve(process.cwd(), 'public/podzim22-timetable.xml');
const parse22 = () => parseTimetable(readFileSync(PODZIM22, 'utf8'));

function slot(day: Slot['day'], start: number, end: number, parity?: WeekParity): Slot {
  return { day, start, end, rooms: [], teachers: [], parity };
}
function event(id: string, subjectCode: string, kind: CourseEvent['kind'], slots: Slot[], group?: string): CourseEvent {
  return { id, subjectCode, kind, group, slots, teachers: [] };
}
function timetableOf(subjects: Subject[]): Timetable {
  return { minHour: 480, maxHour: 1200, hours: [], subjects, unscheduled: [] };
}

describe('parseNoteParity', () => {
  it('reads every Czech inflection the exports actually use', () => {
    // Masculine/neuter/feminine, nominative and accusative — all four appear in podzim2022.
    expect(parseNoteParity('každé liché pondělí 10:00–11:50, od 12. 9. do 5. 12.')).toBe('odd');
    expect(parseNoteParity('každé sudé pondělí 10:00–11:50, od 19. 9. do 28. 11.')).toBe('even');
    expect(parseNoteParity('každou lichou středu 8:00–9:50')).toBe('odd');
    expect(parseNoteParity('každou sudou středu 8:00–9:50')).toBe('even');
    expect(parseNoteParity('každý lichý čtvrtek 8:00–9:50')).toBe('odd');
    expect(parseNoteParity('každý sudý pátek 12:00–13:50')).toBe('even');
  });

  it('reads the English wording MUNI IS emits for an English-language export', () => {
    expect(parseNoteParity('each odd week Monday 10:00-11:50')).toBe('odd');
    expect(parseNoteParity('each even week Monday 10:00-11:50')).toBe('even');
  });

  it('falls back to weekly for a note that is not about parity', () => {
    // podzim2022 note 31: overflow rooms for part of the semester, carrying anchor markup.
    const roomNote =
      'Čt 12:00–14:50 (<a href="/auth/kontakty/mistnost?fakulta=1433;obdobi=8863;id=534">D1</a>) a ' +
      'Čt 12:00–14:50, od 15. 9. do 20. 10. (15. 9., 22. 9., 29. 9., 6. 10., 13. 10. a 20. 10.)';
    expect(parseNoteParity(roomNote)).toBeUndefined();
    expect(parseNoteParity('kromě 16. 11.')).toBeUndefined();
    expect(parseNoteParity(undefined)).toBeUndefined();
    expect(parseNoteParity('')).toBeUndefined();
  });

  it('refuses to guess when a note names both parities', () => {
    // Ambiguity must never *remove* a constraint: an unreadable note means "meets weekly",
    // so we show a clash that may not be real rather than hide one that is.
    expect(parseNoteParity('liché i sudé pondělí')).toBeUndefined();
  });

  it('does not fire on an unrelated word that merely contains the stem', () => {
    expect(parseNoteParity('Přednáší dr. Sudová')).toBeUndefined();
  });
});

describe('parityCanCoincide', () => {
  it('lets a weekly slot share a week with anything, and matching parities with each other', () => {
    expect(parityCanCoincide(undefined, undefined)).toBe(true);
    expect(parityCanCoincide(undefined, 'odd')).toBe(true);
    expect(parityCanCoincide('even', undefined)).toBe(true);
    expect(parityCanCoincide('odd', 'odd')).toBe(true);
    expect(parityCanCoincide('even', 'even')).toBe(true);
  });

  it('keeps opposite parities apart — the whole point', () => {
    expect(parityCanCoincide('odd', 'even')).toBe(false);
    expect(parityCanCoincide('even', 'odd')).toBe(false);
  });
});

describe('slotsOverlap with parity', () => {
  it('does not call an odd-week and an even-week class at the same hour a clash', () => {
    expect(slotsOverlap(slot('Pá', 720, 830, 'odd'), slot('Pá', 720, 830, 'even'))).toBe(false);
  });

  it('still clashes same-parity, and against a weekly slot', () => {
    expect(slotsOverlap(slot('Pá', 720, 830, 'odd'), slot('Pá', 720, 830, 'odd'))).toBe(true);
    expect(slotsOverlap(slot('Pá', 720, 830, 'odd'), slot('Pá', 720, 830))).toBe(true);
  });

  it('propagates through eventsOverlap and findOverlaps', () => {
    const a = event('AA/01', 'AA', 'seminar', [slot('Pá', 720, 830, 'odd')], '01');
    const b = event('BB/02', 'BB', 'seminar', [slot('Pá', 720, 830, 'even')], '02');
    const c = event('CC/03', 'CC', 'seminar', [slot('Pá', 720, 830, 'odd')], '03');
    expect(eventsOverlap(a, b)).toBe(false);
    expect(eventsOverlap(a, c)).toBe(true);
    expect(findOverlaps([a, b, c]).map((o) => `${o.a.id}+${o.b.id}`)).toEqual(['AA/01+CC/03']);
  });
});

describe('weekView', () => {
  const weekly = event('AA', 'AA', 'lecture', [slot('Po', 480, 570)]);
  const odd = event('BB/01', 'BB', 'seminar', [slot('Pá', 720, 830, 'odd')], '01');
  const even = event('CC/02', 'CC', 'seminar', [slot('Pá', 720, 830, 'even')], '02');

  it('keeps weekly events in both weeks and drops the opposite parity', () => {
    expect(weekView([weekly, odd, even], 'odd').map((e) => e.id)).toEqual(['AA', 'BB/01']);
    expect(weekView([weekly, odd, even], 'even').map((e) => e.id)).toEqual(['AA', 'CC/02']);
  });

  it('trims a mixed event to the slots that week rather than dropping it', () => {
    const mixed = event('DD/01', 'DD', 'seminar', [slot('Po', 480, 570), slot('Pá', 720, 830, 'odd')], '01');
    expect(weekView([mixed], 'even')[0]!.slots).toHaveLength(1);
    expect(weekView([mixed], 'odd')[0]!.slots).toHaveLength(2);
  });

  it('returns the very same array when nothing is fortnightly', () => {
    const events = [weekly];
    expect(weekView(events, 'odd')).toBe(events); // identity: the no-parity fast path
    expect(hasParity(events)).toBe(false);
  });
});

describe('eventParity / describeParity', () => {
  it('reports a parity only when every slot agrees', () => {
    expect(eventParity(event('A', 'A', 'seminar', [slot('Po', 480, 570, 'odd')]))).toBe('odd');
    expect(
      eventParity(event('B', 'B', 'seminar', [slot('Po', 480, 570, 'odd'), slot('Út', 480, 570, 'even')])),
    ).toBeUndefined();
    expect(eventParity(event('C', 'C', 'seminar', [slot('Po', 480, 570)]))).toBeUndefined();
  });

  it('describes the cadence for the tooltip', () => {
    expect(describeParity('odd')).toBe('every odd week');
    expect(describeParity(undefined)).toBe('');
  });
});

describe('two-week scoring', () => {
  const prefs: Prefs = { ...DEFAULT_PREFS };
  const noDrops = new Set<string>();

  it('takes the plain single-week path when nothing is fortnightly', () => {
    const events = [
      event('AA', 'AA', 'lecture', [slot('Po', 480, 570)]),
      event('BB/01', 'BB', 'seminar', [slot('St', 600, 710)], '01'),
    ];
    const score = scoreResolved(prefs, noDrops, events, []);
    expect(hasParity(events)).toBe(false);
    expect(score.terms.some((t) => t.detail.includes('wk:'))).toBe(false);
  });

  it('halves the comfort cost when everything sits in the same half of the fortnight', () => {
    // All-odd means a full odd week and an empty even one, so every day-shaped term is worth
    // exactly half its weekly self. A precise arithmetic property, not an approximation —
    // it pins the averaging down far better than a "roughly cheaper" assertion would.
    const weekly = [
      event('AA/01', 'AA', 'seminar', [slot('Po', 480, 590)], '01'),
      event('BB/01', 'BB', 'seminar', [slot('St', 600, 710)], '01'),
    ];
    const allOdd = [
      event('AA/01', 'AA', 'seminar', [slot('Po', 480, 590, 'odd')], '01'),
      event('BB/01', 'BB', 'seminar', [slot('St', 600, 710, 'odd')], '01'),
    ];
    const comfortTotal = (events: CourseEvent[]) =>
      scoreResolved(prefs, noDrops, events, [])
        .terms.filter((t) => t.key !== 'seminarCollision' && t.key !== 'droppedLecture')
        .reduce((sum, t) => sum + t.cost, 0);

    expect(comfortTotal(weekly)).toBeGreaterThan(0);
    expect(comfortTotal(allOdd)).toBeCloseTo(comfortTotal(weekly) / 2, 6);
  });

  it('does not hand a stacked odd/even pair the sparse-day credit of a full day', () => {
    // The distortion this averaging exists to prevent. Two 110-minute classes at the same hour
    // on the same Friday, opposite weeks: a single-week canvas would see one 220-minute day
    // and charge almost nothing, when the student really attends 110 minutes each week.
    const stacked = [
      event('AA/01', 'AA', 'seminar', [slot('Pá', 720, 830, 'odd')], '01'),
      event('BB/01', 'BB', 'seminar', [slot('Pá', 720, 830, 'even')], '01'),
    ];
    const asIfWeekly = [
      event('AA/01', 'AA', 'seminar', [slot('Pá', 720, 830)], '01'),
      event('BB/01', 'BB', 'seminar', [slot('Pá', 830, 940)], '01'),
    ];
    const sparseOf = (events: CourseEvent[]) =>
      scoreResolved(prefs, noDrops, events, []).terms.find((t) => t.key === 'sparseDay')!.cost;

    // A genuinely 220-minute Friday is nearly "full"; the fortnightly pair is two half-days.
    expect(sparseOf(asIfWeekly)).toBeLessThan(30);
    expect(sparseOf(stacked)).toBeGreaterThan(100);
  });

  it('scores stacking and separating alike when neither saves a trip', () => {
    // Same day/hour vs different days: both give one 110-minute day per week, so the lived
    // weeks are identical in shape and the score is honestly indifferent.
    const stacked = [
      event('AA/01', 'AA', 'seminar', [slot('Pá', 720, 830, 'odd')], '01'),
      event('BB/01', 'BB', 'seminar', [slot('Pá', 720, 830, 'even')], '01'),
    ];
    const apart = [
      event('AA/01', 'AA', 'seminar', [slot('Pá', 720, 830, 'odd')], '01'),
      event('BB/01', 'BB', 'seminar', [slot('Čt', 600, 710, 'even')], '01'),
    ];
    expect(scoreResolved(prefs, noDrops, stacked, []).total).toBeCloseTo(
      scoreResolved(prefs, noDrops, apart, []).total,
      6,
    );
  });

  it('prefers stacking when it hides a fortnightly class inside a day already committed to', () => {
    // With a weekly lecture anchoring Friday, stacking keeps every week to one day; splitting
    // makes the even week come in on Thursday too. That is a real trip, and it should cost.
    const lecture = event('LL', 'LL', 'lecture', [slot('Pá', 600, 710)]);
    const stacked = [
      lecture,
      event('AA/01', 'AA', 'seminar', [slot('Pá', 720, 830, 'odd')], '01'),
      event('BB/01', 'BB', 'seminar', [slot('Pá', 720, 830, 'even')], '01'),
    ];
    const apart = [
      lecture,
      event('AA/01', 'AA', 'seminar', [slot('Pá', 720, 830, 'odd')], '01'),
      event('BB/01', 'BB', 'seminar', [slot('Čt', 720, 830, 'even')], '01'),
    ];
    expect(scoreResolved(prefs, noDrops, stacked, []).total).toBeLessThan(
      scoreResolved(prefs, noDrops, apart, []).total,
    );
  });

  it('labels both weeks in the term detail when they differ', () => {
    const events = [
      event('AA/01', 'AA', 'seminar', [slot('Pá', 720, 830, 'odd')], '01'),
      event('BB/01', 'BB', 'seminar', [slot('Čt', 600, 710, 'odd')], '01'),
    ];
    const sparse = scoreResolved(prefs, noDrops, events, []).terms.find((t) => t.key === 'sparseDay')!;
    // Everything is odd-week here, so the even week is empty and the two details diverge.
    expect(sparse.detail).toContain('odd wk:');
    expect(sparse.detail).toContain('even wk:');
  });
});

describe('the podzim2022 export', () => {
  it('reads parity onto the slots that carry an alternating-week note', () => {
    const timetable = parse22();
    const ib015 = timetable.subjects.find((s) => s.code === 'IB015')!;
    const parityOf = (group: string) => ib015.seminars.find((s) => s.group === group)!.slots[0]!.parity;

    expect(parityOf('05')).toBe('odd');
    expect(parityOf('06')).toBe('even');
    // The lecture meets weekly and carries no note.
    expect(ib015.lectures[0]!.slots[0]!.parity).toBeUndefined();

    const noted = ib015.seminars.filter((s) => s.slots[0]!.parity !== undefined);
    expect(noted).toHaveLength(18); // every IB015 group is fortnightly
  });

  it('leaves podzim2023 — which has no notes at all — entirely weekly', () => {
    const timetable = parseTimetable(readFileSync(resolve(process.cwd(), 'public/podzim23-timetable.xml'), 'utf8'));
    const slots = timetable.subjects.flatMap((s) => [...s.lectures, ...s.seminars]).flatMap((e) => e.slots);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => s.parity === undefined)).toBe(true);
  });

  it('stops calling the real IB015-odd / PB154-even Friday pair a collision', () => {
    const timetable = parse22();
    const ib015 = timetable.subjects.find((s) => s.code === 'IB015')!;
    const pb154 = timetable.subjects.find((s) => s.code === 'PB154')!;
    // Both are Friday 12:00–13:50; IB015/13 is odd weeks, PB154/04 is even weeks.
    const a = ib015.seminars.find((s) => s.group === '13')!;
    const b = pb154.seminars.find((s) => s.group === '04')!;
    expect(a.slots[0]!.day).toBe('Pá');
    expect(a.slots[0]!.start).toBe(b.slots[0]!.start);
    expect(a.slots[0]!.parity).toBe('odd');
    expect(b.slots[0]!.parity).toBe('even');
    expect(eventsOverlap(a, b)).toBe(false);
  });

  it('offers both halves of a fortnight as distinct choices instead of collapsing them', () => {
    // IB015/05 and IB015/06 share an hour but not a week. Keying interchangeability on
    // day/time alone hid one of every such pair from the search entirely.
    const timetable = parse22();
    const ib015 = timetable.subjects.find((s) => s.code === 'IB015')!;
    const selection = buildFullSelection(timetableOf([ib015]));
    const result = solve(timetableOf([ib015]), selection, { ...DEFAULT_PREFS, seed: 'parity-test' });

    const collapsed = result.interchangeable.flatMap((set) => set.memberIds);
    const twins = ['IB015/05', 'IB015/06'];
    expect(twins.every((id) => !collapsed.includes(id))).toBe(true);
  });
});
