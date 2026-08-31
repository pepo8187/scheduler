import type { Overlap } from './overlap';

/**
 * Core domain model. Pure data — no React, no DOM types beyond what parsing needs.
 */

export type Day = 'Po' | 'Út' | 'St' | 'Čt' | 'Pá' | 'So' | 'Ne';

/**
 * Which half of the fortnight a slot meets in. `undefined` on a Slot means "every week".
 * Derived from the slot's `<poznamka>` text — see `domain/parity.ts`.
 */
export type WeekParity = 'odd' | 'even';

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
  /** Set only for an alternating-week slot; `undefined` means it meets every week. */
  parity?: WeekParity;
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
// Preferences — the user-facing control surface (docs/ARCHITECTURE.md § The objective function)
// ---------------------------------------------------------------------------

export interface DayWindow {
  start: number; // minutes from midnight, inclusive
  end: number; // minutes from midnight, inclusive
}

export interface LunchPrefs {
  enabled: boolean; // off by default: opt in to blocking out lunch at all
  default: DayWindow; // the usual lunch window, applied to every toggleable day unless overridden
  /**
   * Per-day override, keyed by Day. A DayWindow overrides `default` for that day (e.g. a
   * later lunch on a day with a long morning); `null` skips the block entirely for that day
   * (it never had a fixed lunch, so nothing to protect). A day absent from this map uses
   * `default`.
   */
  overrides: Partial<Record<Day, DayWindow | null>>;
}

/**
 * Every constant the objective is built from, exposed so the Advanced panel can hand them to
 * the user. Defaults live in `DEFAULT_TUNING` (`score.ts`) and are what the rest of the docs
 * describe; these exist because the right trade-off between a gap and a wasted morning is
 * genuinely personal, and no default settles it for everybody.
 */
export interface Tuning {
  // --- Dead time ---
  gapFreeMinutes: number; // a gap shorter than this is a changeover, not dead time
  gapScaleMinutes: number; // chargeable minutes at which a gap costs ~63% of the cap
  gapBadnessCap: number; // the most a single gap can ever cost, however long
  gapWeight: number; // points per unit of gap badness, before the Gaps slider

  // --- Barely-used days ---
  sparseDayFullMinutes: number; // class time that makes a day worth the trip
  sparseDayWeight: number; // cost of a day with nothing on it at all

  // --- Compactness ---
  cramPerDayUsed: number; // cram side: points per day used
  spreadPerUnusedWeekday: number; // spread side: points per weekday left unused
  spreadVarianceTiebreak: number; // spread side: nudge toward evenly loaded days (minutes²)

  // --- Other comfort terms ---
  dayWindowPerMinute: number; // points per minute scheduled outside the day window
  maxPerDayPerExcessClass: number; // points per class over the daily cap

  // --- Priorities ---
  // These keep the ordering the solver relies on: one collision must outweigh any comfort
  // trade, and a dropped lecture must outweigh comfort but not a collision. They also feed the
  // search's lower bound, so lowering them changes what the solver is willing to consider.
  seminarCollisionPerPair: number;
  droppedLecturePerEvent: number;

  // --- Variation ---
  /**
   * How many points the Variety slider is allowed to give up, at its maximum, to hand this
   * student a different week from the next one's. Never enough to buy a collision or a dropped
   * lecture: those are orders of magnitude larger, deliberately.
   */
  varietyToleranceMax: number;
}

export interface Prefs {
  daysOff: Day[]; // hard constraint: no seminar group touching these days is considered
  compactness: number; // -1 (spread) .. 0 (neutral) .. +1 (cram)
  gaps: number; // 0 (gaps are fine) .. 1 (no dead time) — how much dead time costs
  gapShape: number; // 0 (one long break) .. 1 (several short breaks) — what shape dead time should take
  dayWindow: DayWindow; // when the user wants to be at school; outside is soft-penalised
  maxClassesPerDay: number | null; // soft cap; null = off
  lunch: LunchPrefs; // hard constraint like daysOff, but for a time window instead of a whole day
  /**
   * This student's variation seed. Every random choice the solver makes is a pure function of
   * it, so the same seed and the same preferences always produce the same week — while a
   * different seed lands somewhere else entirely. Minted once per browser and persisted; two
   * people can paste the same one to land in the same seminar group on purpose.
   */
  seed: string;
  /**
   * 0 (off) .. 1 — how many points to trade away for a week that differs from everyone else's.
   * Off by default: unlike the free variation the solver applies anyway, this one genuinely
   * costs the individual something, so it is theirs to opt into. See `domain/variety.ts`.
   */
  variety: number;
  tuning: Tuning; // the scoring constants themselves, surfaced in the Advanced panel
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
  /**
   * Seminar groups the user has reclassified as lecture-like (e.g. a demo session that's really
   * a lecture in disguise). A reclassified group is fixed rather than searched — it drops out of
   * the subject's mutually-exclusive group choice and is attended whenever `seminars[id]` is
   * true, subject to the same day-off drop as a non-★ lecture. See `domain/reclassify.ts`.
   */
  reclassified: Record<string, boolean>; // CourseEvent.id -> treated as a lecture
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
  | 'sparseDay'
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
