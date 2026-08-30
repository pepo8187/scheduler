import { DAY_ORDER } from './format';
import { findOverlaps, type Overlap } from './overlap';
import type { Assignment, CourseEvent, Day, Prefs, Score, ScoreTerm, Selection, Slot, Timetable, Tuning } from './types';

const WEEKDAYS = DAY_ORDER.slice(0, 5);

/**
 * Weight scale: a seminar collision always outranks any comfort preference, and a
 * dropped ★-less lecture outranks every comfort preference but not a collision.
 * Comfort terms are scaled by their slider so a neutral slider contributes nothing.
 *
 * These are the defaults only — the live values come from `prefs.tuning`, which the Advanced
 * panel lets the user edit. Everything the docs say about the objective describes these.
 */
export const DEFAULT_TUNING: Tuning = {
  gapFreeMinutes: 30, // a changeover, not dead time: the curve starts here
  gapScaleMinutes: 120,
  gapBadnessCap: 120,
  gapWeight: 3, // applied to capped "badness" minutes (see gapBadness), not raw idle minutes

  sparseDayFullMinutes: 240, // 4 hours of class: a day worth showing up for
  sparseDayWeight: 200, // the whole cost of a trip to campus; scaled by how little is on the day

  cramPerDayUsed: 30,
  spreadPerUnusedWeekday: 30, // spread's mirror of cramPerDayUsed: the primary lever
  spreadVarianceTiebreak: 0.0005, // variance is in minutes²; a secondary nudge, never enough to add a day

  dayWindowPerMinute: 4,
  maxPerDayPerExcessClass: 150,

  seminarCollisionPerPair: 100_000,
  droppedLecturePerEvent: 2_000,

  // Roughly two extra days used at full cram, or half a maxed-out gap at the default Gaps
  // slider: enough to reach a genuinely different week, nowhere near enough to buy a collision
  // (100_000) or a dropped lecture (2_000).
  varietyToleranceMax: 60,
};

/** The exponent range the Break shape slider maps onto; not user-tunable. */
const GAP_EXPONENT_MIN = 0.5; // gapShape 0: consolidate everything into one break
const GAP_EXPONENT_MAX = 2.5; // gapShape 1: short breathers are nearly free

/** Resolves an Assignment into the events actually on the grid, plus their overlaps. */
export function resolveAssignment(
  timetable: Timetable,
  selection: Selection,
  assignment: Assignment,
): { events: CourseEvent[]; overlaps: Overlap[] } {
  const events: CourseEvent[] = [];

  for (const subject of timetable.subjects) {
    const subjectSelection = selection[subject.code];
    if (!subjectSelection?.enabled) continue;

    for (const lecture of subject.lectures) {
      if (!subjectSelection.lectures[lecture.id]?.enabled) continue;
      if (assignment.droppedLectures.has(lecture.id)) continue;
      events.push(lecture);
    }

    const chosenId = assignment.seminarChoice[subject.code];
    if (chosenId) {
      const seminar = subject.seminars.find((s) => s.id === chosenId);
      if (seminar) events.push(seminar);
    }
  }

  return { events, overlaps: findOverlaps(events) };
}

function daySlots(events: CourseEvent[]): Map<Day, Slot[]> {
  const byDay = new Map<Day, Slot[]>();
  for (const event of events) {
    for (const slot of event.slots) {
      const list = byDay.get(slot.day);
      if (list) list.push(slot);
      else byDay.set(slot.day, [slot]);
    }
  }
  return byDay;
}

function compactnessTerm(byDay: Map<Day, Slot[]>, prefs: Prefs): ScoreTerm {
  const daysUsed = byDay.size;

  if (prefs.compactness === 0 || daysUsed === 0) {
    return { key: 'compactness', label: 'Compactness', cost: 0, detail: 'neutral' };
  }

  if (prefs.compactness > 0) {
    const cost = prefs.compactness * daysUsed * prefs.tuning.cramPerDayUsed;
    return { key: 'compactness', label: 'Compactness', cost, detail: `${daysUsed} day(s) used (cram)` };
  }

  const loads = [...byDay.values()].map((slots) => slots.reduce((sum, s) => sum + (s.end - s.start), 0));
  const mean = loads.reduce((a, b) => a + b, 0) / loads.length;
  const variance = loads.reduce((sum, v) => sum + (v - mean) ** 2, 0) / loads.length;

  // "Spread across the week" is the mirror of cram: primarily, use the days available to
  // spread into (a day left off is a hard constraint, so it never counts against this —
  // only weekdays the user hasn't excluded do); secondarily, break ties between
  // same-day-count arrangements in favour of the more evenly loaded one.
  const availableWeekdays = WEEKDAYS.filter((d) => !prefs.daysOff.includes(d)).length;
  const unusedWeekdays = Math.max(0, availableWeekdays - daysUsed);

  const magnitude = -prefs.compactness;
  const cost =
    magnitude * (unusedWeekdays * prefs.tuning.spreadPerUnusedWeekday + variance * prefs.tuning.spreadVarianceTiebreak);
  return {
    key: 'compactness',
    label: 'Compactness',
    cost,
    detail: `load variance ${Math.round(variance)}, ${daysUsed} day(s) used (spread)`,
  };
}

/**
 * A gap's badness isn't proportional to its length, but it must never *fall* as the gap grows
 * — a longer hole is never a better outcome than a shorter one, let alone than no gap at all.
 *
 * The first `tuning.gapFreeMinutes` of any gap are free. Teaching hours in a MUNI export don't abut:
 * they run :00-:50, so two genuinely back-to-back classes still show a ten-minute changeover,
 * and charging for those made a perfectly packed day look like it was riddled with dead time.
 * Rather than reading the hour grid (subjects scheduled off-grid would slip through), the curve
 * simply starts at 30 minutes: anything shorter is a corridor transition, not dead time. Longer
 * gaps aren't ignored, they're just measured from there — a 90-minute gap is scored as an hour
 * of dead time.
 *
 * Past the free window it's a Weibull CDF rising to `tuning.gapBadnessCap`: monotonically
 * non-decreasing whatever the shape, so that invariant holds at every slider position.
 *
 * `tuning.gapScaleMinutes` fixes *where* the curve sits — 2 chargeable hours always cost ~63% of the
 * cap — while `prefs.gapShape` bends it, and that bend is the whole "continuity" control:
 *
 * - Low exponent (`gapShape` → 0): concave from the origin. Every chargeable minute counts
 *   straight away, so splitting dead time into several gaps pays the steep early cost
 *   repeatedly and the solver consolidates it into one long break.
 * - High exponent (`gapShape` → 1): flat near the origin, then a sharp climb. Short breathers
 *   are close to free and only long stretches really bite, so the solver prefers several short
 *   breaks over one consolidated hole.
 *
 * The per-gap cap means a single gap can only ever cost so much, so consolidating a genuinely
 * long stretch wins at every slider position — two two-hour holes strand you on campus twice,
 * which nobody prefers to one six-hour break, however relaxed they are about short gaps. The
 * slider governs the range below saturation, which is where real schedules live.
 */
/** Maps the 0..1 `gapShape` slider onto the curve's exponent, geometrically so the midpoint is neutral. */
export function gapExponent(gapShape: number): number {
  const clamped = Math.min(1, Math.max(0, gapShape));
  return GAP_EXPONENT_MIN * (GAP_EXPONENT_MAX / GAP_EXPONENT_MIN) ** clamped;
}

/** The part of a gap that counts as dead time: everything past the free changeover window. */
export function chargeableGapMinutes(minutes: number, tuning: Tuning): number {
  return Math.max(0, minutes - tuning.gapFreeMinutes);
}

export function gapBadness(minutes: number, gapShape: number, tuning: Tuning): number {
  const chargeable = chargeableGapMinutes(minutes, tuning);
  if (chargeable <= 0) return 0;
  const scale = Math.max(1, tuning.gapScaleMinutes); // a zero scale would blow the curve up
  return tuning.gapBadnessCap * (1 - Math.exp(-((chargeable / scale) ** gapExponent(gapShape))));
}

function gapsForDay(
  slots: Slot[],
  gapShape: number,
  tuning: Tuning,
): { idleMinutes: number; gapCount: number; chargedCount: number; badness: number } {
  const sorted = [...slots].sort((a, b) => a.start - b.start);
  let idleMinutes = 0;
  let gapCount = 0;
  let chargedCount = 0;
  let badness = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gapStart = sorted[i - 1]!.end;
    const gapEnd = sorted[i]!.start;
    if (gapEnd <= gapStart) continue; // overlapping or touching: no dead time here
    const length = gapEnd - gapStart;
    idleMinutes += length;
    gapCount += 1;
    if (chargeableGapMinutes(length, tuning) > 0) chargedCount += 1;
    badness += gapBadness(length, gapShape, tuning);
  }
  return { idleMinutes, gapCount, chargedCount, badness };
}

function gapsTerm(byDay: Map<Day, Slot[]>, prefs: Prefs): ScoreTerm {
  let idleMinutes = 0;
  let gapCount = 0;
  let chargedCount = 0;
  let totalBadness = 0;
  for (const slots of byDay.values()) {
    const day = gapsForDay(slots, prefs.gapShape, prefs.tuning);
    idleMinutes += day.idleMinutes;
    gapCount += day.gapCount;
    chargedCount += day.chargedCount;
    totalBadness += day.badness;
  }

  // Idle minutes alone don't explain the cost: how the dead time is split across gaps is half
  // the story, and gaps inside the free window cost nothing at all — so say how many of them
  // are actually being charged for, or a zero cost next to a pile of idle minutes reads as a bug.
  const cost = totalBadness * prefs.gaps * prefs.tuning.gapWeight;
  const detail =
    gapCount === 0
      ? 'none'
      : `${idleMinutes} idle minute(s) in ${gapCount} gap(s), ${chargedCount} over ${prefs.tuning.gapFreeMinutes} min`;
  return { key: 'gaps', label: 'Dead time', cost, detail };
}

/**
 * A day with a lone two-hour seminar on it costs almost as much to attend as a full one — the
 * trip, the morning, the day being spoken for — but the score used to charge for it purely by
 * day *count*, at 30 points a day, and only when the compactness slider was pushed to cram. So
 * an otherwise-free Friday holding one seminar was worth less than a coffee break, and at the
 * default neutral compactness it was worth nothing at all: the solver would happily strand a
 * single group on its own day to dodge a few minutes of gap elsewhere.
 *
 * This charges for the *overhead* instead of for the day: the emptier a day, the more of it is
 * pure commute. A day carrying `tuning.sparseDayFullMinutes` of class or more has earned the trip
 * and costs nothing; below that, the shortfall is charged pro rata, so the term ramps smoothly
 * rather than snapping at a threshold the solver could sit exactly on.
 *
 * Unlike compactness this is on by default, because "don't make me come in for one class" is
 * near-universal rather than a matter of taste. Spreading out is the one preference that
 * genuinely contradicts it — deliberately lightly-loaded days are the whole point — so the
 * charge fades as the compactness slider goes negative and is gone entirely at full spread.
 */
function sparseDayTerm(byDay: Map<Day, Slot[]>, prefs: Prefs): ScoreTerm {
  // Full weight from neutral upward; fading to nothing at full spread.
  const appetite = prefs.compactness < 0 ? 1 + prefs.compactness : 1;
  if (appetite === 0 || byDay.size === 0) {
    return { key: 'sparseDay', label: 'Barely-used days', cost: 0, detail: byDay.size === 0 ? 'none' : 'spread: ignored' };
  }

  const full = prefs.tuning.sparseDayFullMinutes;
  if (full <= 0) {
    return { key: 'sparseDay', label: 'Barely-used days', cost: 0, detail: 'off' };
  }

  let cost = 0;
  let sparseDays = 0;
  for (const slots of byDay.values()) {
    const classMinutes = slots.reduce((sum, s) => sum + (s.end - s.start), 0);
    const shortfall = Math.max(0, full - classMinutes) / full;
    if (shortfall === 0) continue;
    sparseDays += 1;
    cost += shortfall * prefs.tuning.sparseDayWeight * appetite;
  }

  const hours = Math.round((full / 60) * 10) / 10;
  return {
    key: 'sparseDay',
    label: 'Barely-used days',
    cost,
    detail: sparseDays === 0 ? 'none' : `${sparseDays} day(s) under ${hours}h of class`,
  };
}

function dayWindowTerm(events: CourseEvent[], prefs: Prefs): ScoreTerm {
  let minutesOutside = 0;
  for (const event of events) {
    for (const slot of event.slots) {
      minutesOutside += Math.max(0, prefs.dayWindow.start - slot.start);
      minutesOutside += Math.max(0, slot.end - prefs.dayWindow.end);
    }
  }
  const cost = minutesOutside * prefs.tuning.dayWindowPerMinute;
  return { key: 'dayWindow', label: 'Outside day window', cost, detail: `${minutesOutside} minute(s) outside` };
}

function maxPerDayTerm(byDay: Map<Day, Slot[]>, prefs: Prefs): ScoreTerm {
  if (prefs.maxClassesPerDay == null) {
    return { key: 'maxPerDay', label: 'Max classes/day', cost: 0, detail: 'off' };
  }
  let excess = 0;
  for (const slots of byDay.values()) excess += Math.max(0, slots.length - prefs.maxClassesPerDay);
  const cost = excess * prefs.tuning.maxPerDayPerExcessClass;
  return { key: 'maxPerDay', label: 'Max classes/day', cost, detail: `${excess} class(es) over cap` };
}

/**
 * Scores an already-resolved assignment. Split out from `computeScore` so the solver's hot
 * loop (which resolves an assignment to check overlaps/forward-checking anyway) never pays
 * for `resolveAssignment` twice per candidate.
 */
export function scoreResolved(
  prefs: Prefs,
  droppedLectures: Assignment['droppedLectures'],
  events: CourseEvent[],
  overlaps: Overlap[],
): Score {
  const seminarOverlaps = overlaps.filter((o) => o.kind === 'seminar');
  const byDay = daySlots(events);

  const terms: ScoreTerm[] = [
    {
      key: 'seminarCollision',
      label: 'Seminar collisions',
      cost: seminarOverlaps.length * prefs.tuning.seminarCollisionPerPair,
      detail: seminarOverlaps.length === 0 ? 'none' : `${seminarOverlaps.length} overlap(s)`,
    },
    {
      key: 'droppedLecture',
      label: 'Dropped lectures',
      cost: droppedLectures.size * prefs.tuning.droppedLecturePerEvent,
      detail: droppedLectures.size === 0 ? 'none' : `${droppedLectures.size} dropped`,
    },
    compactnessTerm(byDay, prefs),
    sparseDayTerm(byDay, prefs),
    gapsTerm(byDay, prefs),
    dayWindowTerm(events, prefs),
    maxPerDayTerm(byDay, prefs),
  ];

  return { total: terms.reduce((sum, t) => sum + t.cost, 0), terms };
}

export function computeScore(timetable: Timetable, selection: Selection, prefs: Prefs, assignment: Assignment): Score {
  const { events, overlaps } = resolveAssignment(timetable, selection, assignment);
  return scoreResolved(prefs, assignment.droppedLectures, events, overlaps);
}
