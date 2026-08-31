import { parityCanCoincide } from './parity';
import type { CourseEvent, Slot } from './types';

export function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Same weekday, overlapping hours — and able to fall in the same week at all.
 *
 * That last clause is what makes alternating-week seminars work: an odd-week class and an
 * even-week class at the same hour on the same day never meet, so they are not a clash and
 * choosing both is a perfectly good week. A slot with no parity meets every week and so can
 * still collide with either half. See `domain/parity.ts`.
 */
export function slotsOverlap(a: Slot, b: Slot): boolean {
  return a.day === b.day && intervalsOverlap(a.start, a.end, b.start, b.end) && parityCanCoincide(a.parity, b.parity);
}

export function eventsOverlap(a: CourseEvent, b: CourseEvent): boolean {
  return a.slots.some((slotA) => b.slots.some((slotB) => slotsOverlap(slotA, slotB)));
}

/**
 * "lecture-lecture" is a fact of the export (shaded, badged, never an error).
 * "seminar" covers any other pairing and is what the solver penalises.
 */
export type OverlapKind = 'lecture-lecture' | 'seminar';

export function classifyOverlap(a: CourseEvent, b: CourseEvent): OverlapKind {
  return a.kind === 'lecture' && b.kind === 'lecture' ? 'lecture-lecture' : 'seminar';
}

export interface Overlap {
  a: CourseEvent;
  b: CourseEvent;
  kind: OverlapKind;
}

/**
 * Pairwise overlaps across the given events. Events of the same subject are never
 * compared against each other: only one of a subject's seminar groups is ever
 * selected at a time, so their mutual overlap (e.g. two Friday-only groups) is not
 * a real conflict.
 */
export function findOverlaps(events: CourseEvent[]): Overlap[] {
  const overlaps: Overlap[] = [];
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i]!;
      const b = events[j]!;
      if (a.subjectCode === b.subjectCode) continue;
      if (eventsOverlap(a, b)) overlaps.push({ a, b, kind: classifyOverlap(a, b) });
    }
  }
  return overlaps;
}
