import { DAY_ORDER } from './format';
import { gapBadness } from './score';
import type { CourseEvent, Day, Prefs, Slot } from './types';

/**
 * The week the solver is currently standing in, kept alive across the whole search.
 *
 * `scoreResolved` answers "what does this week cost" from scratch: it walks every event into a
 * day map, splits the fortnight into two week views, and re-derives every comfort term. That is
 * the right shape for scoring *a* week — the UI scores one at a time — and the wrong shape for
 * scoring eight hundred thousand of them, which is what the DFS does on a first-semester
 * export. Measured on `podzim22-timetable.xml`, leaf evaluation was 97% of a 7.7 second solve;
 * the search itself, backtracking and every collision check included, was 210 ms of it.
 *
 * The way out is that **the objective is a sum over days**. `sparseDay`, `gaps` and `maxPerDay`
 * are per-day; `dayWindow` is per-slot and so also per-day; only `compactness` reads the week as
 * a whole, and it reads it as a vector of per-day loads. So a ledger of days, each holding the
 * raw inputs its terms need, can be *maintained* rather than rebuilt: descending a level in the
 * DFS dirties only the days the chosen group actually meets on — exactly one, for all 142 groups
 * in the podzim22 export — and backtracking restores what was saved on the way down. Recomputing
 * one day across both weeks costs 0.46 µs against 3.40 µs for a full `scoreResolved`, and the two
 * `weekView` arrays that call allocates and throws away cost 0.60 µs on their own, more than a
 * whole day's recompute.
 *
 * **Both weeks, always.** `weekView` returns its input unchanged when nothing is fortnightly, so
 * for a weekly timetable the odd and even ledgers hold identical days and `(x + x) / 2` is exactly
 * `x` in IEEE-754. Keeping two weeks unconditionally therefore costs a weekly export nothing and
 * removes the `hasParity` branch — along with the wasted second pass over the days of a
 * fortnightly week that hold no alternating-week slot at all (two of the four days used in the
 * podzim22 answer).
 *
 * **What this is not.** It is a filter, not the reported score: it carries no `ScoreTerm` details,
 * and its arithmetic groups the same additions differently from `scoreResolved`, which moves
 * totals by an ulp or two. `solve` therefore uses it to decide which candidates reach the pool and
 * then re-scores the survivors through `scoreResolved` proper, so every number a user ever sees
 * still comes from the one scorer the tests pin.
 */

/** One (week, day): the slots on it, and the raw quantities its score terms read. */
interface DayBucket {
  slots: Slot[];
  /** Minutes of class. Feeds the sparse-day shortfall and the spread variance. */
  minutes: number;
  /** Weibull gap badness, unweighted — `gapsTerm` scales the week's total once, not per day. */
  badness: number;
  /** Minutes outside `prefs.dayWindow`, unweighted, for the same reason. */
  outside: number;
  /** Slots on the day, for `maxPerDay`'s excess. */
  count: number;
}

/** What a `place` disturbed, so `unplace` can put it back without recomputing anything. */
interface Saved {
  week: number;
  day: number;
  slotCount: number;
  minutes: number;
  badness: number;
  outside: number;
  count: number;
}

export interface ScoreLedger {
  /** Adds every slot of `event`, recomputing only the days it lands on. */
  place(event: CourseEvent, depth: number): void;
  /** Undoes the `place` made at `depth`. Depths must be released in reverse order. */
  unplace(depth: number): void;
  /** What the week now in the ledger scores, given the collisions the search counted. */
  total(collisions: number): number;
}

const WEEKS = 2; // 0 = odd, 1 = even
const DAYS = DAY_ORDER.length;

/**
 * A ledger holding `fixed` (lectures, reclassified seminars, pinned groups) as its floor, with
 * room for `maxDepth` levels of placed-and-undone seminar choices on top.
 *
 * `droppedCount` is `Assignment.droppedLectures.size`: constant for a whole solve, since drops
 * are derived from days off rather than searched.
 */
export function createLedger(
  prefs: Prefs,
  fixed: CourseEvent[],
  droppedCount: number,
  maxDepth: number,
): ScoreLedger {
  const { tuning } = prefs;
  const dayIndex = new Map<Day, number>(DAY_ORDER.map((day, i) => [day, i]));

  // Everything the terms need that cannot change during a search, read once.
  const sparseAppetite = prefs.compactness < 0 ? 1 + prefs.compactness : 1;
  const sparseFull = tuning.sparseDayFullMinutes;
  const sparseOn = sparseAppetite !== 0 && sparseFull > 0;
  const maxPerDay = prefs.maxClassesPerDay;
  const windowStart = prefs.dayWindow.start;
  const windowEnd = prefs.dayWindow.end;
  const availableWeekdays = DAY_ORDER.slice(0, 5).filter((day) => !prefs.daysOff.includes(day)).length;
  const collisionCost = tuning.seminarCollisionPerPair;
  const droppedCost = droppedCount * tuning.droppedLecturePerEvent;

  const buckets: DayBucket[][] = [];
  for (let week = 0; week < WEEKS; week++) {
    const row: DayBucket[] = [];
    for (let day = 0; day < DAYS; day++) row.push({ slots: [], minutes: 0, badness: 0, outside: 0, count: 0 });
    buckets.push(row);
  }

  /**
   * Re-derives one day's raw inputs from its slots.
   *
   * Sorted through `ordered` rather than in place: `unplace` restores a day by truncating its
   * slot list back to the length it had on the way down, which only works while that list stays
   * in placement order. One scratch array serves every call, so the sort still costs nothing per
   * node beyond the comparisons themselves.
   *
   * Sorted by start and then by end, which is a hair stricter than `gapsForDay`'s sort on start
   * alone: two slots starting at the same minute are only possible when they overlap, and the
   * ledger would otherwise measure the gap after them differently depending on which order the
   * DFS happened to place them in. Such a week carries a 100,000-point collision and never
   * reaches the pool on the strength of its gaps, and the score the user is shown is re-derived
   * by `scoreResolved` regardless — but a filter that does not depend on visit order is worth
   * the one extra comparison.
   */
  const ordered: Slot[] = [];
  function recompute(bucket: DayBucket): void {
    const source = bucket.slots;
    let minutes = 0;
    let outside = 0;
    let badness = 0;
    ordered.length = 0;
    for (let i = 0; i < source.length; i++) ordered.push(source[i]!);
    if (ordered.length > 1) ordered.sort((a, b) => a.start - b.start || a.end - b.end);
    const slots = ordered;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]!;
      minutes += slot.end - slot.start;
      if (slot.start < windowStart) outside += windowStart - slot.start;
      if (slot.end > windowEnd) outside += slot.end - windowEnd;
      if (i > 0) {
        const gapStart = slots[i - 1]!.end;
        const gapEnd = slot.start;
        if (gapEnd > gapStart) badness += gapBadness(gapEnd - gapStart, prefs.gapShape, tuning);
      }
    }
    bucket.minutes = minutes;
    bucket.outside = outside;
    bucket.badness = badness;
    bucket.count = slots.length;
  }

  for (const event of fixed) {
    for (const slot of event.slots) {
      const day = dayIndex.get(slot.day);
      if (day === undefined) continue;
      if (slot.parity !== 'even') buckets[0]![day]!.slots.push(slot);
      if (slot.parity !== 'odd') buckets[1]![day]!.slots.push(slot);
    }
  }
  for (let week = 0; week < WEEKS; week++) for (let day = 0; day < DAYS; day++) recompute(buckets[week]![day]!);

  // One undo record per depth. A group meeting twice a week touches at most a handful of
  // (week, day) cells, so these stay tiny and are reused rather than reallocated per node.
  const undo: Saved[][] = [];
  for (let depth = 0; depth < maxDepth; depth++) undo.push([]);
  const dirty: number[] = [];

  function place(event: CourseEvent, depth: number): void {
    const saved = undo[depth]!;
    saved.length = 0;
    dirty.length = 0;
    for (const slot of event.slots) {
      const day = dayIndex.get(slot.day);
      if (day === undefined) continue;
      for (let week = 0; week < WEEKS; week++) {
        if (slot.parity !== undefined && slot.parity !== (week === 0 ? 'odd' : 'even')) continue;
        const bucket = buckets[week]![day]!;
        const cell = week * DAYS + day;
        if (!dirty.includes(cell)) {
          dirty.push(cell);
          saved.push({
            week,
            day,
            slotCount: bucket.slots.length,
            minutes: bucket.minutes,
            badness: bucket.badness,
            outside: bucket.outside,
            count: bucket.count,
          });
        }
        bucket.slots.push(slot);
      }
    }
    for (const cell of dirty) recompute(buckets[(cell / DAYS) | 0]![cell % DAYS]!);
  }

  function unplace(depth: number): void {
    const saved = undo[depth]!;
    for (let i = saved.length - 1; i >= 0; i--) {
      const entry = saved[i]!;
      const bucket = buckets[entry.week]![entry.day]!;
      bucket.slots.length = entry.slotCount;
      bucket.minutes = entry.minutes;
      bucket.badness = entry.badness;
      bucket.outside = entry.outside;
      bucket.count = entry.count;
    }
    saved.length = 0;
  }

  const loads: number[] = new Array(DAYS).fill(0);

  /**
   * One week's comfort, term by term in `comfortTerms`' own order so the additions land the same
   * way round. Days with nothing on them are skipped exactly as `daySlots` skips them: an empty
   * day is absent from the map, so it is neither sparse nor a day used.
   */
  function comfortOf(week: number): number {
    const row = buckets[week]!;
    let daysUsed = 0;
    let loadSum = 0;
    let sparseMinutesShort = 0;
    let badness = 0;
    let outside = 0;
    let excess = 0;
    for (let day = 0; day < DAYS; day++) {
      const bucket = row[day]!;
      if (bucket.count === 0) continue;
      loads[daysUsed] = bucket.minutes;
      daysUsed++;
      loadSum += bucket.minutes;
      badness += bucket.badness;
      outside += bucket.outside;
      if (sparseOn && bucket.minutes < sparseFull) sparseMinutesShort += (sparseFull - bucket.minutes) / sparseFull;
      if (maxPerDay != null && bucket.count > maxPerDay) excess += bucket.count - maxPerDay;
    }

    let compactness = 0;
    if (prefs.compactness !== 0 && daysUsed !== 0) {
      if (prefs.compactness > 0) {
        compactness = prefs.compactness * daysUsed * tuning.cramPerDayUsed;
      } else {
        const mean = loadSum / daysUsed;
        let variance = 0;
        for (let i = 0; i < daysUsed; i++) variance += (loads[i]! - mean) ** 2;
        variance /= daysUsed;
        compactness =
          -prefs.compactness *
          (Math.max(0, availableWeekdays - daysUsed) * tuning.spreadPerUnusedWeekday +
            variance * tuning.spreadVarianceTiebreak);
      }
    }

    const sparseDay = sparseOn ? sparseMinutesShort * tuning.sparseDayWeight * sparseAppetite : 0;
    const gaps = badness * prefs.gaps * tuning.gapWeight;
    const dayWindow = outside * tuning.dayWindowPerMinute;
    const maxPerDayCost = maxPerDay == null ? 0 : excess * tuning.maxPerDayPerExcessClass;
    return compactness + sparseDay + gaps + dayWindow + maxPerDayCost;
  }

  function total(collisions: number): number {
    return collisions * collisionCost + droppedCost + (comfortOf(0) + comfortOf(1)) / 2;
  }

  return { place, unplace, total };
}
