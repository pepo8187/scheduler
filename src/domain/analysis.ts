import { DAY_LABELS, DAY_ORDER } from './format';
import { slotDuringLunch } from './lunch';
import { findOverlaps } from './overlap';
import { asLecture } from './reclassify';
import type { CourseEvent, Day, LunchPrefs, Selection, Subject, Timetable } from './types';

/** The five weekdays the day-off toggles apply to. */
export const TOGGLEABLE_DAYS: Day[] = DAY_ORDER.slice(0, 5);

export interface LectureConflict {
  day: Day;
  a: CourseEvent;
  b: CourseEvent;
}

/** Lecture ↔ lecture overlaps among enabled lectures: rendered as a badge, never an error. */
export function findLectureConflicts(timetable: Timetable, selection: Selection): LectureConflict[] {
  const lectures: CourseEvent[] = [];
  for (const subject of timetable.subjects) {
    const subjectSelection = selection[subject.code];
    if (!subjectSelection?.enabled) continue;
    for (const lecture of subject.lectures) {
      if (subjectSelection.lectures[lecture.id]?.enabled) lectures.push(lecture);
    }
    for (const seminar of subject.seminars) {
      if (subjectSelection.reclassified[seminar.id] && subjectSelection.seminars[seminar.id]) {
        lectures.push(asLecture(seminar));
      }
    }
  }

  const conflicts: LectureConflict[] = [];
  for (const overlap of findOverlaps(lectures)) {
    if (overlap.kind !== 'lecture-lecture') continue;
    const day = overlap.a.slots.find((s) => overlap.b.slots.some((t) => t.day === s.day))?.day;
    if (day) conflicts.push({ day, a: overlap.a, b: overlap.b });
  }
  return conflicts;
}

export interface DayOffBlocker {
  subject: Subject;
  lecture: CourseEvent;
}

export interface DroppedLectureNote {
  subject: Subject;
  lecture: CourseEvent;
}

export interface DeadSubjectWarning {
  subject: Subject;
  reason: string;
}

export interface DayOffAnalysis {
  day: Day;
  /** ★ required lectures that day. Non-empty means the toggle is blocked. */
  blockers: DayOffBlocker[];
  /** Non-★ lectures that day which would be dropped if the day is turned off. */
  droppedLectures: DroppedLectureNote[];
  /** Subjects left with no usable enabled seminar group if the day is turned off. */
  deadSubjects: DeadSubjectWarning[];
}

/**
 * Pre-flight for a single weekday, computed against the *current* selection —
 * independent of whether the day is actually off yet, so the UI can preview the
 * consequence of the toggle before it is flipped.
 */
export function analyzeDayOff(timetable: Timetable, selection: Selection, day: Day): DayOffAnalysis {
  const blockers: DayOffBlocker[] = [];
  const droppedLectures: DroppedLectureNote[] = [];
  const deadSubjects: DeadSubjectWarning[] = [];

  for (const subject of timetable.subjects) {
    const subjectSelection = selection[subject.code];
    if (!subjectSelection?.enabled) continue;

    for (const lecture of subject.lectures) {
      const lectureSelection = subjectSelection.lectures[lecture.id];
      if (!lectureSelection?.enabled) continue;
      if (!lecture.slots.some((s) => s.day === day)) continue;
      if (lectureSelection.required) blockers.push({ subject, lecture });
      else droppedLectures.push({ subject, lecture });
    }

    for (const seminar of subject.seminars) {
      if (!subjectSelection.reclassified[seminar.id] || !subjectSelection.seminars[seminar.id]) continue;
      if (seminar.slots.some((s) => s.day === day)) droppedLectures.push({ subject, lecture: seminar });
    }

    const normalSeminars = subject.seminars.filter((s) => !subjectSelection.reclassified[s.id]);
    if (normalSeminars.length === 0) continue;
    const enabledGroups = normalSeminars.filter((s) => subjectSelection.seminars[s.id]);
    if (enabledGroups.length === 0) continue; // already lecture-only by explicit user choice

    const survivors = enabledGroups.filter((s) => !s.slots.some((slot) => slot.day === day));
    if (survivors.length === 0) {
      const groupList = enabledGroups.map((s) => s.group ?? s.id).join(', ');
      const plural = enabledGroups.length > 1;
      deadSubjects.push({
        subject,
        reason: `${plural ? 'groups' : 'group'} ${groupList} ${plural ? 'are' : 'is'} all ${DAY_LABELS[day]}-only`,
      });
    }
  }

  return { day, blockers, droppedLectures, deadSubjects };
}

export function analyzeAllDaysOff(timetable: Timetable, selection: Selection): Record<Day, DayOffAnalysis> {
  const result = {} as Record<Day, DayOffAnalysis>;
  for (const day of TOGGLEABLE_DAYS) result[day] = analyzeDayOff(timetable, selection, day);
  return result;
}

export interface LunchLectureOverlap {
  subject: Subject;
  lecture: CourseEvent;
  day: Day;
}

export interface LunchAnalysis {
  /** Enabled lectures that fall inside their day's lunch window. Informational only — a
   *  lecture is a given, never dropped or moved to protect lunch. */
  lectureOverlaps: LunchLectureOverlap[];
  /** Subjects left with no usable enabled seminar group once lunch is blocked out. */
  deadSubjects: DeadSubjectWarning[];
}

/** Whether the currently-configured lunch block leaves anything unresolved: fixed lectures
 *  sitting inside it, or a subject whose every enabled group overlaps its day's window. */
export function analyzeLunch(timetable: Timetable, selection: Selection, lunch: LunchPrefs): LunchAnalysis {
  const lectureOverlaps: LunchLectureOverlap[] = [];
  const deadSubjects: DeadSubjectWarning[] = [];
  if (!lunch.enabled) return { lectureOverlaps, deadSubjects };

  for (const subject of timetable.subjects) {
    const subjectSelection = selection[subject.code];
    if (!subjectSelection?.enabled) continue;

    for (const lecture of subject.lectures) {
      if (!subjectSelection.lectures[lecture.id]?.enabled) continue;
      const overlapDay = lecture.slots.find((slot) => slotDuringLunch(slot, lunch))?.day;
      if (overlapDay) lectureOverlaps.push({ subject, lecture, day: overlapDay });
    }

    for (const seminar of subject.seminars) {
      if (!subjectSelection.reclassified[seminar.id] || !subjectSelection.seminars[seminar.id]) continue;
      const overlapDay = seminar.slots.find((slot) => slotDuringLunch(slot, lunch))?.day;
      if (overlapDay) lectureOverlaps.push({ subject, lecture: seminar, day: overlapDay });
    }

    const normalSeminars = subject.seminars.filter((s) => !subjectSelection.reclassified[s.id]);
    if (normalSeminars.length === 0) continue;
    const enabledGroups = normalSeminars.filter((s) => subjectSelection.seminars[s.id]);
    if (enabledGroups.length === 0) continue; // already lecture-only by explicit user choice

    const survivors = enabledGroups.filter((s) => !s.slots.some((slot) => slotDuringLunch(slot, lunch)));
    if (survivors.length === 0) {
      const groupList = enabledGroups.map((s) => s.group ?? s.id).join(', ');
      const plural = enabledGroups.length > 1;
      deadSubjects.push({
        subject,
        reason: `${plural ? 'groups' : 'group'} ${groupList} ${plural ? 'all overlap' : 'overlaps'} your lunch break`,
      });
    }
  }

  return { lectureOverlaps, deadSubjects };
}
