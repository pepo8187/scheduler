import type { Overlap } from './overlap';

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

// ---------------------------------------------------------------------------
// Preferences — the user-facing control surface (docs/PLAN.md § Preferences)
// ---------------------------------------------------------------------------

export interface DayWindow {
  start: number; // minutes from midnight, inclusive
  end: number; // minutes from midnight, inclusive
}

export interface Prefs {
  daysOff: Day[]; // hard constraint: no seminar group touching these days is considered
  compactness: number; // -1 (spread) .. 0 (neutral) .. +1 (cram)
  gaps: number; // 0 (gaps are fine) .. 1 (no dead time)
  lunchBufferMinutes: number; // idle time around midday exempt from the gaps penalty
  dayWindow: DayWindow; // when the user wants to be at school; outside is soft-penalised
  maxClassesPerDay: number | null; // soft cap; null = off
}

// ---------------------------------------------------------------------------
// Selection state — what the user has enabled, and which lecture is ★ required
// ---------------------------------------------------------------------------

export interface LectureSelection {
  enabled: boolean;
  required: boolean; // ★ priority: pins the lecture's day, blocks a day-off request
}

export interface SubjectSelection {
  enabled: boolean;
  lectures: Record<string, LectureSelection>; // CourseEvent.id -> selection
  seminars: Record<string, boolean>; // CourseEvent.id -> enabled
}

/** Keyed by Subject.code. */
export type Selection = Record<string, SubjectSelection>;

// ---------------------------------------------------------------------------
// Scoring & solutions
// ---------------------------------------------------------------------------

export type ScoreTermKey =
  | 'seminarCollision'
  | 'droppedLecture'
  | 'compactness'
  | 'gaps'
  | 'dayWindow'
  | 'maxPerDay';

export interface ScoreTerm {
  key: ScoreTermKey;
  label: string;
  cost: number; // weighted penalty contributed by this term (>= 0, lower is better)
  detail: string; // short human-readable explanation
}

export interface Score {
  total: number;
  terms: ScoreTerm[];
}

/** One per enabled subject-with-seminars, plus the derived day-off lecture drops. */
export interface Assignment {
  seminarChoice: Record<string, string | null>; // Subject.code -> chosen seminar CourseEvent id, or null
  droppedLectures: Set<string>; // CourseEvent ids of non-★ lectures dropped to satisfy a day off
}

export interface Solution {
  assignment: Assignment;
  events: CourseEvent[]; // every attended event: kept lectures + chosen seminars
  overlaps: Overlap[]; // overlapping pairs among `events`, both lecture-lecture and seminar kinds
  score: Score;
}
