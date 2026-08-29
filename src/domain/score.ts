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
  gapsPerIdleMinute: 3, // applied to peak-weighted "badness" minutes (see gapBadness), not raw ones
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

function compactnessTerm(events: CourseEvent[], prefs: Prefs): ScoreTerm {
  const byDay = daySlots(events);
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
 * A gap's badness isn't proportional to its length. A ~2 hour hole (`GAP_PEAK_MINUTES`) is
 * the worst case — too long to just sit and wait, too short to leave and do anything with —
 * so that's where the penalty peaks. Shorter gaps (a walk between buildings) are cheap, and
 * *longer* gaps get sharply cheaper again past the peak: 4 hours is enough to get real work
 * done at the library, 6-8 hours is enough to go home or to work and come back, so a single
 * long block is treated as only mildly worse than no gap at all — never as badly as the
 * 2-hour hole it contains would be on its own.
 *
 * Modelled as a Gamma(shape=2) curve — rises roughly linearly from zero, peaks at
 * `2 * GAP_SHAPE_THETA`, decays exponentially after — rescaled so the peak itself equals
 * `GAP_PEAK_MINUTES`. That keeps `WEIGHTS.gapsPerIdleMinute` meaning the same thing it always
 * did ("cost per minute, at the worst-case gap length"); every other gap length is discounted
 * relative to that peak rather than counted minute-for-minute.
 */
export const GAP_PEAK_MINUTES = 120;
const GAP_SHAPE_THETA = GAP_PEAK_MINUTES / 2;
const GAP_PEAK_RAW = (GAP_PEAK_MINUTES / GAP_SHAPE_THETA) ** 2 * Math.exp(-GAP_PEAK_MINUTES / GAP_SHAPE_THETA);

export function gapBadness(minutes: number): number {
  if (minutes <= 0) return 0;
  const raw = (minutes / GAP_SHAPE_THETA) ** 2 * Math.exp(-minutes / GAP_SHAPE_THETA);
  return (GAP_PEAK_MINUTES * raw) / GAP_PEAK_RAW;
}

function gapsForDay(slots: Slot[]): { idleMinutes: number; badness: number } {
  const sorted = [...slots].sort((a, b) => a.start - b.start);
  let idleMinutes = 0;
  let badness = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gapStart = sorted[i - 1]!.end;
    const gapEnd = sorted[i]!.start;
    if (gapEnd <= gapStart) continue; // overlapping or touching: no dead time here
    const length = gapEnd - gapStart;
    idleMinutes += length;
    badness += gapBadness(length);
  }
  return { idleMinutes, badness };
}

function gapsTerm(events: CourseEvent[], prefs: Prefs): ScoreTerm {
  const byDay = daySlots(events);

  let idleMinutes = 0;
  let totalBadness = 0;
  for (const slots of byDay.values()) {
    const day = gapsForDay(slots);
    idleMinutes += day.idleMinutes;
    totalBadness += day.badness;
  }

  const cost = totalBadness * prefs.gaps * WEIGHTS.gapsPerIdleMinute;
  return { key: 'gaps', label: 'Dead time', cost, detail: `${idleMinutes} idle minute(s)` };
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

function maxPerDayTerm(events: CourseEvent[], prefs: Prefs): ScoreTerm {
  if (prefs.maxClassesPerDay == null) {
    return { key: 'maxPerDay', label: 'Max classes/day', cost: 0, detail: 'off' };
  }
  const byDay = daySlots(events);
  let excess = 0;
  for (const slots of byDay.values()) excess += Math.max(0, slots.length - prefs.maxClassesPerDay);
  const cost = excess * WEIGHTS.maxPerDayPerExcessClass;
  return { key: 'maxPerDay', label: 'Max classes/day', cost, detail: `${excess} class(es) over cap` };
}

export function computeScore(timetable: Timetable, selection: Selection, prefs: Prefs, assignment: Assignment): Score {
  const { events, overlaps } = resolveAssignment(timetable, selection, assignment);
  const seminarOverlaps = overlaps.filter((o) => o.kind === 'seminar');

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
      cost: assignment.droppedLectures.size * WEIGHTS.droppedLecturePerEvent,
      detail: assignment.droppedLectures.size === 0 ? 'none' : `${assignment.droppedLectures.size} dropped`,
    },
    compactnessTerm(events, prefs),
    gapsTerm(events, prefs),
    dayWindowTerm(events, prefs),
    maxPerDayTerm(events, prefs),
  ];

  return { total: terms.reduce((sum, t) => sum + t.cost, 0), terms };
}
