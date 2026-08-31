import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTimeToMinutes } from '../format';
import { parseTimetable } from '../parseTimetable';
import { DEFAULT_PREFS } from '../presets';
import { scoreResolved } from '../score';
import { blockShapeKey, canonicalTime, dayLoadKey, describeShapeDays, describeShapeLoad } from '../shape';
import type { CourseEvent, Day, HourRulerEntry, Slot } from '../types';

/**
 * The autumn 2024 export is the only real evidence for the snapping rule — it is where the
 * 15:40-vs-15:50 pair actually lives — so the boundary cases are asserted against its own
 * `<hodiny>` grid rather than a grid invented here. It stays out of `public/` on purpose:
 * Vite copies that directory into the build, and this file is for testing. See
 * `fixtures/timetables/README.md`.
 */
const PODZIM24_PATH = resolve(process.cwd(), 'fixtures/timetables/podzim24-timetable.xml');
const podzim24 = parseTimetable(readFileSync(PODZIM24_PATH, 'utf8'));
const hours = podzim24.hours;

const at = (time: string) => parseTimeToMinutes(time);
const snap = (time: string) => canonicalTime(at(time), hours);

function slot(day: Day, start: string, end: string, parity?: Slot['parity']): Slot {
  return { day, start: at(start), end: at(end), rooms: [], teachers: [], parity };
}

function event(id: string, slots: Slot[]): CourseEvent {
  return { id, subjectCode: id.split('/')[0]!, kind: 'seminar', slots, teachers: [] };
}

describe('canonicalTime', () => {
  it('reads the export’s own teaching grid, 08:00–19:50 in twelve rows', () => {
    expect(hours).toHaveLength(12);
    expect(hours[0]).toEqual({ start: at('8:00'), end: at('8:50') });
  });

  it('merges the ten-minute pair the podzim24 export actually contains', () => {
    // CORE033 runs St 14:00-15:40 (a university-wide course from another faculty); MA018 and
    // PB007/01 run St 14:00-15:50. Nobody would call those two different weeks.
    expect(snap('15:40')).toBe(snap('15:50'));
  });

  it('keeps genuinely different finishes apart', () => {
    expect(snap('12:50')).not.toBe(snap('13:50')); // Út 12:00 starts, 60 min apart
    expect(snap('16:50')).not.toBe(snap('17:50')); // Út 16:00 starts, 60 min apart
    expect(snap('9:50')).not.toBe(snap('14:40')); // Pá 08:00 starts, 290 min apart
  });

  it('survives the boundary that fixed-width bucketing gets wrong', () => {
    // Rounding to 15 minutes sends 15:37 to 15:30 and 15:47 to 15:45: ten minutes apart, and
    // separated anyway, because they straddle a bucket edge. The grid has no edge to straddle.
    expect(snap('15:37')).toBe(snap('15:47'));
  });

  it('leaves a time alone when the export declares no grid at all', () => {
    expect(canonicalTime(at('15:37'), [])).toBe(at('15:37'));
  });

  it('degrades safely for a slot nowhere near a row, without dragging others onto it', () => {
    // podzim24's p947 groups are 400-minute block sessions. They snap to whatever is nearest
    // and simply never collide with anything else.
    const long = canonicalTime(at('15:20'), hours);
    expect(hours.some((h: HourRulerEntry) => h.start === long || h.end === long)).toBe(true);
  });

  it('breaks an exact tie toward the earlier boundary, so row order never matters', () => {
    // 08:55 sits exactly between the 08:50 end and the 09:00 start.
    expect(canonicalTime(at('8:55'), hours)).toBe(at('8:50'));
  });
});

describe('blockShapeKey', () => {
  it('ignores which subject sits in which block', () => {
    // A permutation: two subjects trading slots. Same week to anyone looking at it.
    const one = [event('AA/01', [slot('Po', '10:00', '11:50')]), event('BB/01', [slot('Čt', '8:00', '9:50')])];
    const swapped = [event('AA/07', [slot('Čt', '8:00', '9:50')]), event('BB/03', [slot('Po', '10:00', '11:50')])];
    expect(blockShapeKey(one, hours)).toBe(blockShapeKey(swapped, hours));
  });

  it('separates a genuine difference in time', () => {
    const morning = [event('AA/01', [slot('Po', '8:00', '9:50')])];
    const afternoon = [event('AA/01', [slot('Po', '14:00', '15:50')])];
    expect(blockShapeKey(morning, hours)).not.toBe(blockShapeKey(afternoon, hours));
  });

  it('merges the ten-minute pair but not the sixty-minute one', () => {
    const short = [event('AA/01', [slot('St', '14:00', '15:40')])];
    const long = [event('AA/01', [slot('St', '14:00', '15:50')])];
    const hour = [event('AA/01', [slot('St', '14:00', '16:50')])];
    expect(blockShapeKey(short, hours)).toBe(blockShapeKey(long, hours));
    expect(blockShapeKey(short, hours)).not.toBe(blockShapeKey(hour, hours));
  });

  it('treats an odd-week block and its even-week twin as different weeks', () => {
    const odd = [event('AA/05', [slot('Po', '10:00', '11:50', 'odd')])];
    const even = [event('AA/06', [slot('Po', '10:00', '11:50', 'even')])];
    const weekly = [event('AA/01', [slot('Po', '10:00', '11:50')])];
    expect(blockShapeKey(odd, hours)).not.toBe(blockShapeKey(even, hours));
    expect(blockShapeKey(odd, hours)).not.toBe(blockShapeKey(weekly, hours));
  });

  it('keeps duplicates, so two classes stacked on an hour is not one class there', () => {
    const one = [event('AA/01', [slot('Po', '10:00', '11:50')])];
    const two = [...one, event('BB/01', [slot('Po', '10:00', '11:50')])];
    expect(blockShapeKey(one, hours)).not.toBe(blockShapeKey(two, hours));
  });
});

describe('the score-identity property the whole design rests on', () => {
  it('scores two assignments with the same block multiset identically', () => {
    // Every score term in `score.ts` reads only day/start/end — never who is taught in a block.
    // This is what makes "ignore the labels" the right equivalence rather than a lossy shortcut.
    const one = [
      event('AA/01', [slot('Po', '10:00', '11:50')]),
      event('BB/01', [slot('Čt', '8:00', '9:50')]),
      event('CC/01', [slot('Po', '14:00', '15:50')]),
    ];
    const swapped = [
      event('AA/09', [slot('Čt', '8:00', '9:50')]),
      event('BB/04', [slot('Po', '14:00', '15:50')]),
      event('CC/02', [slot('Po', '10:00', '11:50')]),
    ];
    expect(blockShapeKey(one, hours)).toBe(blockShapeKey(swapped, hours));
    const scoreOf = (events: CourseEvent[]) => scoreResolved(DEFAULT_PREFS, new Set<string>(), events, []).total;
    expect(scoreOf(one)).toBe(scoreOf(swapped));
  });

  it('does not extend to a snapped pair — which is why snapping stays out of the score', () => {
    // 15:40 and 15:50 share a block shape but are ten minutes of real class time apart, and the
    // sparse-day term must keep charging for the difference.
    const short = [event('AA/01', [slot('St', '14:00', '15:40')])];
    const long = [event('AA/01', [slot('St', '14:00', '15:50')])];
    const scoreOf = (events: CourseEvent[]) => scoreResolved(DEFAULT_PREFS, new Set<string>(), events, []).total;
    expect(blockShapeKey(short, hours)).toBe(blockShapeKey(long, hours));
    expect(scoreOf(short)).toBeGreaterThan(scoreOf(long));
  });
});

describe('dayLoadKey', () => {
  it('is blind to when a day’s classes happen, which is why it needs a finer key beneath it', () => {
    const morning = [event('AA/01', [slot('Po', '8:00', '9:50')])];
    const afternoon = [event('AA/01', [slot('Po', '14:00', '15:50')])];
    expect(dayLoadKey(morning)).toBe(dayLoadKey(afternoon));
    expect(blockShapeKey(morning, hours)).not.toBe(blockShapeKey(afternoon, hours));
  });
});

describe('describeShapeDays / describeShapeLoad', () => {
  const events = [
    event('AA/01', [slot('Po', '8:00', '9:50')]),
    event('BB/01', [slot('Pá', '14:00', '14:50')]),
    event('CC/01', [slot('Po', '10:00', '11:50')]),
  ];

  it('lists the days used in week order, not in event order', () => {
    expect(describeShapeDays(events)).toBe('Po Pá');
  });

  it('spells the per-day load out for the tooltip', () => {
    expect(describeShapeLoad(events)).toBe('Po 3h40 · Pá 50m');
  });

  it('says nothing about an empty week', () => {
    expect(describeShapeDays([])).toBe('');
    expect(describeShapeLoad([])).toBe('');
  });
});
