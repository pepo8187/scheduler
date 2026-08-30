import { DAY_ORDER } from './format';
import { findOverlaps, type Overlap } from './overlap';
import type { Assignment, CourseEvent, Day, Prefs, Score, ScoreTerm, Selection, Slot, Timetable } from './types';

const WEEKDAYS = DAY_ORDER.slice(0, 5);

/**
 * Weight scale: a seminar collision always outranks any comfort preference, and a
 * dropped ★-less lecture outranks every comfort preference but not a collision.
 * Comfort terms are scaled by their slider so a neutral slider contributes nothing.
 */
export const WEIGHTS = {
  seminarCollisionPerPair: 100_000,
  droppedLecturePerEvent: 2_000,
  compactnessPerDayUsed: 30,
  compactnessPerUnusedWeekday: 30, // spread's mirror of compactnessPerDayUsed: the primary lever
  compactnessVarianceTiebreak: 0.0005, // variance is in minutes²; a secondary nudge only, never enough to add a day
  gapsPerIdleMinute: 3, // applied to capped "badness" minutes (see gapBadness), not raw idle minutes
  dayWindowPerMinuteOutside: 4,
  maxPerDayPerExcessClass: 150,
};

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
    const cost = prefs.compactness * daysUsed * WEIGHTS.compactnessPerDayUsed;
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
  const cost = magnitude * (unusedWeekdays * WEIGHTS.compactnessPerUnusedWeekday + variance * WEIGHTS.compactnessVarianceTiebreak);
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
 * Modelled as a Weibull CDF rising from zero to `GAP_BADNESS_CAP`: monotonically non-decreasing
 * whatever the shape, so that invariant holds at every slider position.
 *
 * `GAP_SCALE_MINUTES` fixes *where* the curve sits — a two-hour hole always costs ~63% of the
 * cap — while `prefs.gapShape` bends it, and that bend is the whole "continuity" control:
 *
 * - Low exponent (`gapShape` → 0): concave from the origin. Every idle minute counts straight
 *   away, so splitting dead time into several gaps pays the steep early cost repeatedly and
 *   the solver consolidates it into one long break.
 * - High exponent (`gapShape` → 1): flat near the origin, then a sharp climb. Short breathers
 *   are close to free and only long stretches really bite, so the solver prefers several short
 *   breaks over one consolidated hole.
 *
 * The per-gap cap means a single gap can only ever cost so much, so consolidating a genuinely
 * long stretch wins at every slider position — two two-hour holes strand you on campus twice,
 * which nobody prefers to one six-hour break, however relaxed they are about short gaps. The
 * slider governs the range below saturation, which is where real schedules live.
 */
export const GAP_BADNESS_CAP = 120;
const GAP_SCALE_MINUTES = 120;
const GAP_EXPONENT_MIN = 0.5; // gapShape 0: consolidate everything into one break
const GAP_EXPONENT_MAX = 2.5; // gapShape 1: short breathers are nearly free

/** Maps the 0..1 `gapShape` slider onto the curve's exponent, geometrically so the midpoint is neutral. */
export function gapExponent(gapShape: number): number {
  const clamped = Math.min(1, Math.max(0, gapShape));
  return GAP_EXPONENT_MIN * (GAP_EXPONENT_MAX / GAP_EXPONENT_MIN) ** clamped;
}

export function gapBadness(minutes: number, gapShape: number): number {
  if (minutes <= 0) return 0;
  return GAP_BADNESS_CAP * (1 - Math.exp(-((minutes / GAP_SCALE_MINUTES) ** gapExponent(gapShape))));
}

function gapsForDay(slots: Slot[], gapShape: number): { idleMinutes: number; gapCount: number; badness: number } {
  const sorted = [...slots].sort((a, b) => a.start - b.start);
  let idleMinutes = 0;
  let gapCount = 0;
  let badness = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gapStart = sorted[i - 1]!.end;
    const gapEnd = sorted[i]!.start;
    if (gapEnd <= gapStart) continue; // overlapping or touching: no dead time here
    const length = gapEnd - gapStart;
    idleMinutes += length;
    gapCount += 1;
    badness += gapBadness(length, gapShape);
  }
  return { idleMinutes, gapCount, badness };
}

function gapsTerm(byDay: Map<Day, Slot[]>, prefs: Prefs): ScoreTerm {
  let idleMinutes = 0;
  let gapCount = 0;
  let totalBadness = 0;
  for (const slots of byDay.values()) {
    const day = gapsForDay(slots, prefs.gapShape);
    idleMinutes += day.idleMinutes;
    gapCount += day.gapCount;
    totalBadness += day.badness;
  }

  // Idle minutes alone don't explain the cost — how the dead time is split across gaps is
  // half the story — so the detail reports the gap count next to it.
  const cost = totalBadness * prefs.gaps * WEIGHTS.gapsPerIdleMinute;
  return { key: 'gaps', label: 'Dead time', cost, detail: `${idleMinutes} idle minute(s) in ${gapCount} gap(s)` };
}

function dayWindowTerm(events: CourseEvent[], prefs: Prefs): ScoreTerm {
  let minutesOutside = 0;
  for (const event of events) {
    for (const slot of event.slots) {
      minutesOutside += Math.max(0, prefs.dayWindow.start - slot.start);
      minutesOutside += Math.max(0, slot.end - prefs.dayWindow.end);
    }
  }
  const cost = minutesOutside * WEIGHTS.dayWindowPerMinuteOutside;
  return { key: 'dayWindow', label: 'Outside day window', cost, detail: `${minutesOutside} minute(s) outside` };
}

function maxPerDayTerm(byDay: Map<Day, Slot[]>, prefs: Prefs): ScoreTerm {
  if (prefs.maxClassesPerDay == null) {
    return { key: 'maxPerDay', label: 'Max classes/day', cost: 0, detail: 'off' };
  }
  let excess = 0;
  for (const slots of byDay.values()) excess += Math.max(0, slots.length - prefs.maxClassesPerDay);
  const cost = excess * WEIGHTS.maxPerDayPerExcessClass;
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
      cost: seminarOverlaps.length * WEIGHTS.seminarCollisionPerPair,
      detail: seminarOverlaps.length === 0 ? 'none' : `${seminarOverlaps.length} overlap(s)`,
    },
    {
      key: 'droppedLecture',
      label: 'Dropped lectures',
      cost: droppedLectures.size * WEIGHTS.droppedLecturePerEvent,
      detail: droppedLectures.size === 0 ? 'none' : `${droppedLectures.size} dropped`,
    },
    compactnessTerm(byDay, prefs),
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
