/**
 * Core domain model. Pure data — no React, no DOM types beyond what parsing needs.
 */

export type Day = 'Po' | 'Út' | 'St' | 'Čt' | 'Pá' | 'So' | 'Ne';

export interface Teacher {
  id: string;
  name: string;
}

export interface Slot {
  day: Day;
  start: number; // minutes from midnight
  end: number;
  rooms: string[];
  teachers: Teacher[];
  noteId?: string;
  note?: string;
}

export type EventKind = 'lecture' | 'seminar';

export interface CourseEvent {
  id: string; // "MA012" | "MA012/03"
  subjectCode: string; // "MA012"
  kind: EventKind;
  group?: string; // "03"
  slots: Slot[]; // >1 when a group meets several times a week
  teachers: Teacher[]; // de-duplicated union across slots
}

export interface Subject {
  code: string;
  name: string;
  subjectId: string;
  facultyUrl: string;
  periodUrl: string;
  lectures: CourseEvent[];
  seminars: CourseEvent[];
}

/** A `<nezname>` entry: no scheduled time, listed in a tray, never placed on the grid. */
export interface UnscheduledCourse {
  code: string;
  name: string;
  subjectId: string;
  facultyUrl: string;
  periodUrl: string;
}

export interface HourRulerEntry {
  start: number; // minutes from midnight
  end: number;
}

export interface Timetable {
  minHour: number; // minhod — structural grid bound
  maxHour: number; // maxhod — structural grid bound
  hours: HourRulerEntry[]; // <hodiny> rows, for rendering the hour ruler
  subjects: Subject[];
  unscheduled: UnscheduledCourse[];
}
