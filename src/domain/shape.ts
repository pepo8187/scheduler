import { DAY_ORDER } from './format';
import type { CourseEvent, Day, HourRulerEntry } from './types';

/**
 * Week *shape* — what a schedule looks like, with the labels taken off.
 *
 * The alternatives strip shows ten rungs, and after alternating-week parity stopped collapsing
 * odd/even twins there are far more equal-scoring weeks to fill them with than there are
 * genuinely different weeks: under neutral preferences on podzim2022's IB015+PB154+VB035,
 * 1 404 combinations tie at the optimum. Distinguishing them by exact group ids keeps the strip
 * technically distinct and perceptually identical — nine rungs whose Monday and Tuesday are the
 * same lectures, differing only in which subject sits in which of two seminar slots.
 *
 * So this module answers "is this the same week?" at two altitudes, neither of which looks at
 * *which subject* occupies a block:
 *
 *  - `dayLoadKey` — day → total class minutes. Coarse: it merges a Monday-morning week with a
 *    Monday-afternoon one, since both are "Po: 220min". Three to six distinct values in a
 *    typical top ten, and those are the differences a student actually perceives.
 *  - `blockShapeKey` — the multiset of occupied day/start/end/parity blocks. Fine: nine or ten
 *    distinct values in the same top ten, but it never treats two subjects trading slots as two
 *    different weeks.
 *
 * Ignoring subject identity is exactly right rather than merely convenient: every score term in
 * `score.ts` reads only `day`/`start`/`end`, never who is taught in the block. Two assignments
 * with the same block multiset therefore score *identically*, by construction — verified at
 * 0.000000 spread across three real selections, and pinned by a test.
 */

/** Minutes of class per day, summed across every slot of every event. */
export function dayLoad(events: CourseEvent[]): Map<Day, number> {
  const load = new Map<Day, number>();
  for (const event of events) {
    for (const slot of event.slots) {
      load.set(slot.day, (load.get(slot.day) ?? 0) + (slot.end - slot.start));
    }
  }
  return load;
}

/** Coarse identity: which days a week uses and how loaded each one is. */
export function dayLoadKey(events: CourseEvent[]): string {
  const load = dayLoad(events);
  return DAY_ORDER.filter((day) => load.has(day))
    .map((day) => `${day}:${load.get(day)}`)
    .join(',');
}

/**
 * Snaps a time to the nearest boundary of the export's own teaching grid.
 *
 * Classes that are the same week to a human are not always the same minute to a computer. The
 * podzim2024 export has `CORE033` running St 14:00–15:40 next to `MA018` and `PB007/01` running
 * St 14:00–15:50: a university-wide course from another faculty, ten minutes shorter. Nobody
 * would call those two different weeks, and giving them two rungs of the strip wastes one.
 *
 * Rounding to a fixed bucket does not work, because two nearby times can straddle a bucket edge
 * and stay apart — at 15 minutes, 15:37 → 15:30 while 15:47 → 15:45. Snapping to the `<hodiny>`
 * rows instead uses the grid the export itself declares and the timetable is literally drawn
 * on: no arbitrary constant, no boundary to fall either side of. It also degrades safely — a
 * slot far from every row (podzim2024's 400-minute block sessions) snaps to whatever is nearest
 * and simply never collides with anything else.
 *
 * **Display keys only.** A snapped time must never reach `scoreResolved`: those ten minutes are
 * real class time, and the sparse-day and gap terms have to keep charging for them.
 *
 * Ties go to the earlier boundary, so the result never depends on the order rows are listed in.
 * An export with no `<hodiny>` rows leaves times untouched.
 */
export function canonicalTime(minutes: number, hours: HourRulerEntry[]): number {
  let best = minutes;
  let bestDistance = Infinity;
  for (const hour of hours) {
    for (const boundary of [hour.start, hour.end]) {
      const distance = Math.abs(boundary - minutes);
      if (distance < bestDistance || (distance === bestDistance && boundary < best)) {
        best = boundary;
        bestDistance = distance;
      }
    }
  }
  return best;
}

/**
 * Fine identity: the multiset of blocks a week occupies, with subject labels excluded.
 *
 * Two assignments that differ only by which subject sits in which block — a permutation, present
 * in 12–35 % of shapes on real selections — key the same. A genuine difference in day, time or
 * fortnightly cadence keys differently. Duplicates are kept rather than deduplicated: two classes
 * stacked on one hour is a different week from one class there.
 */
export function blockShapeKey(events: CourseEvent[], hours: HourRulerEntry[]): string {
  const blocks: string[] = [];
  for (const event of events) {
    for (const slot of event.slots) {
      const start = canonicalTime(slot.start, hours);
      const end = canonicalTime(slot.end, hours);
      blocks.push(`${slot.day}:${start}-${end}${slot.parity ? `:${slot.parity}` : ''}`);
    }
  }
  return blocks.sort().join(',');
}

/** "3h40", "50m" — a duration compact enough to sit inside a strip rung's tooltip. */
function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h${String(rest).padStart(2, '0')}`;
}

/**
 * "Po Út Pá" — the days a week actually uses, in week order.
 *
 * The one-line answer to "how is this rung different from the one next to it?", and the visible
 * face of `dayLoadKey`: rungs the strip filled from distinct day loads differ here, which is the
 * difference a student notices first. Rungs backfilled from `blockShapeKey` can repeat a day
 * set — they differ in *when*, not in *whether* — so the tooltip carries the loads too.
 */
export function describeShapeDays(events: CourseEvent[]): string {
  const load = dayLoad(events);
  return DAY_ORDER.filter((day) => load.has(day)).join(' ');
}

/** "Po 3h40 · Út 1h50" — the same shape with its per-day loads, for the tooltip. */
export function describeShapeLoad(events: CourseEvent[]): string {
  const load = dayLoad(events);
  return DAY_ORDER.filter((day) => load.has(day))
    .map((day) => `${day} ${formatDuration(load.get(day)!)}`)
    .join(' · ');
}
