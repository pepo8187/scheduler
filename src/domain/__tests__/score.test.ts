import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS } from '../presets';
import { computeScore, resolveAssignment, WEIGHTS } from '../score';
import type { Assignment, CourseEvent, Prefs, Slot, Subject, Timetable } from '../types';
import { buildFullSelection } from './selection';

function slot(day: Slot['day'], start: number, end: number): Slot {
  return { day, start, end, rooms: [], teachers: [] };
}

function event(id: string, subjectCode: string, kind: CourseEvent['kind'], slots: Slot[], group?: string): CourseEvent {
  return { id, subjectCode, kind, group, slots, teachers: [] };
}

function subject(code: string, lectures: CourseEvent[], seminars: CourseEvent[]): Subject {
  return { code, name: code, subjectId: code, facultyUrl: '', periodUrl: '', lectures, seminars };
}

function timetableOf(subjects: Subject[]): Timetable {
  return { minHour: 480, maxHour: 1200, hours: [], subjects, unscheduled: [] };
}

function emptyAssignment(): Assignment {
  return { seminarChoice: {}, droppedLectures: new Set() };
}

describe('resolveAssignment', () => {
  it('includes enabled lectures and the chosen seminar, drops nothing by default', () => {
    const lecture = event('AA', 'AA', 'lecture', [slot('Po', 480, 570)]);
    const groupA = event('AA/01', 'AA', 'seminar', [slot('Út', 480, 570)], '01');
    const groupB = event('AA/02', 'AA', 'seminar', [slot('St', 480, 570)], '02');
    const timetable = timetableOf([subject('AA', [lecture], [groupA, groupB])]);
    const selection = buildFullSelection(timetable);
    const assignment: Assignment = { seminarChoice: { AA: 'AA/01' }, droppedLectures: new Set() };

    const { events, overlaps } = resolveAssignment(timetable, selection, assignment);
    expect(events.map((e) => e.id).sort()).toEqual(['AA', 'AA/01']);
    expect(overlaps).toHaveLength(0);
  });

  it('excludes a dropped lecture and a subject disabled entirely', () => {
    const lecture = event('AA', 'AA', 'lecture', [slot('Po', 480, 570)]);
    const timetable = timetableOf([subject('AA', [lecture], []), subject('BB', [event('BB', 'BB', 'lecture', [slot('Út', 480, 570)])], [])]);
    const selection = buildFullSelection(timetable);
    selection.BB!.enabled = false;
    const assignment: Assignment = { seminarChoice: {}, droppedLectures: new Set(['AA']) };

    const { events } = resolveAssignment(timetable, selection, assignment);
    expect(events).toHaveLength(0);
  });
});

describe('computeScore — seminar collisions', () => {
  it('penalises an overlap between two different subjects heavily, and never penalises lecture-lecture', () => {
    const lectureA = event('LA', 'LA', 'lecture', [slot('Út', 720, 830)]);
    const lectureB = event('LB', 'LB', 'lecture', [slot('Út', 720, 830)]); // overlaps LA
    const seminarC = event('CC/01', 'CC', 'seminar', [slot('St', 480, 570)], '01');
    const seminarD = event('DD/01', 'DD', 'seminar', [slot('St', 480, 570)], '01'); // overlaps CC/01
    const timetable = timetableOf([
      subject('LA', [lectureA], []),
      subject('LB', [lectureB], []),
      subject('CC', [], [seminarC]),
      subject('DD', [], [seminarD]),
    ]);
    const selection = buildFullSelection(timetable);
    const assignment: Assignment = { seminarChoice: { CC: 'CC/01', DD: 'DD/01' }, droppedLectures: new Set() };

    const score = computeScore(timetable, selection, DEFAULT_PREFS, assignment);
    const collisionTerm = score.terms.find((t) => t.key === 'seminarCollision')!;
    expect(collisionTerm.cost).toBe(WEIGHTS.seminarCollisionPerPair); // only the seminar-seminar pair counts
  });
});

describe('computeScore — dropped lectures', () => {
  it('charges a flat cost per dropped lecture, independent of comfort prefs', () => {
    const lecture = event('AA', 'AA', 'lecture', [slot('Pá', 480, 570)]);
    const timetable = timetableOf([subject('AA', [lecture], [])]);
    const selection = buildFullSelection(timetable);
    const assignment: Assignment = { seminarChoice: {}, droppedLectures: new Set(['AA']) };

    const score = computeScore(timetable, selection, DEFAULT_PREFS, assignment);
    const term = score.terms.find((t) => t.key === 'droppedLecture')!;
    expect(term.cost).toBe(WEIGHTS.droppedLecturePerEvent);
  });
});

describe('computeScore — compactness', () => {
  const twoDaySchedule = () => {
    const a = event('AA', 'AA', 'lecture', [slot('Po', 480, 570)]);
    const b = event('BB', 'BB', 'lecture', [slot('Út', 480, 570)]);
    const timetable = timetableOf([subject('AA', [a], []), subject('BB', [b], [])]);
    return { timetable, selection: buildFullSelection(timetable), assignment: emptyAssignment() };
  };

  it('is neutral (zero cost) at slider 0', () => {
    const { timetable, selection, assignment } = twoDaySchedule();
    const score = computeScore(timetable, selection, { ...DEFAULT_PREFS, compactness: 0 }, assignment);
    expect(score.terms.find((t) => t.key === 'compactness')?.cost).toBe(0);
  });

  it('charges per day used when pushed toward cram (positive)', () => {
    const { timetable, selection, assignment } = twoDaySchedule();
    const score = computeScore(timetable, selection, { ...DEFAULT_PREFS, compactness: 1 }, assignment);
    expect(score.terms.find((t) => t.key === 'compactness')?.cost).toBe(2 * WEIGHTS.compactnessPerDayUsed);
  });

  it('charges for load variance when pushed toward spread (negative), not for day count', () => {
    const a = event('AA', 'AA', 'lecture', [slot('Po', 480, 570)]); // 90 min
    const b = event('BB', 'BB', 'lecture', [slot('Út', 480, 660)]); // 180 min
    const timetable = timetableOf([subject('AA', [a], []), subject('BB', [b], [])]);
    const selection = buildFullSelection(timetable);
    const score = computeScore(timetable, selection, { ...DEFAULT_PREFS, compactness: -1 }, emptyAssignment());
    // mean=135, variance=(45^2+45^2)/2=2025
    expect(score.terms.find((t) => t.key === 'compactness')?.cost).toBeCloseTo(2025 * WEIGHTS.compactnessPerVarianceUnit);
  });
});

describe('computeScore — gaps', () => {
  it('is zero when gaps preference is at 0 regardless of dead time', () => {
    const a = event('AA', 'AA', 'lecture', [slot('Po', 480, 530)]);
    const b = event('BB', 'BB', 'lecture', [slot('Po', 800, 850)]); // big gap same day
    const timetable = timetableOf([subject('AA', [a], []), subject('BB', [b], [])]);
    const selection = buildFullSelection(timetable);
    const score = computeScore(timetable, selection, { ...DEFAULT_PREFS, gaps: 0 }, emptyAssignment());
    expect(score.terms.find((t) => t.key === 'gaps')?.cost).toBe(0);
  });

  it('penalises idle minutes between classes on the same day, exempting the lunch buffer', () => {
    const a = event('AA', 'AA', 'lecture', [slot('Po', 660, 690)]); // 11:00-11:30
    const b = event('BB', 'BB', 'lecture', [slot('Po', 780, 810)]); // 13:00-13:30, 90 min gap
    const timetable = timetableOf([subject('AA', [a], []), subject('BB', [b], [])]);
    const selection = buildFullSelection(timetable);
    const prefs: Prefs = { ...DEFAULT_PREFS, gaps: 1, lunchBufferMinutes: 60 }; // exempt 690-750
    const score = computeScore(timetable, selection, prefs, emptyAssignment());
    // gap is 690-780 (90 min); lunch window 690-750 (60 min) is exempt; 30 idle minutes remain
    expect(score.terms.find((t) => t.key === 'gaps')?.cost).toBe(30 * WEIGHTS.gapsPerIdleMinute);
  });
});

describe('computeScore — day window', () => {
  it('penalises minutes scheduled outside the requested window, per minute', () => {
    const a = event('AA', 'AA', 'lecture', [slot('Po', 480, 570)]); // 08:00-09:30
    const timetable = timetableOf([subject('AA', [a], [])]);
    const selection = buildFullSelection(timetable);
    const prefs: Prefs = { ...DEFAULT_PREFS, dayWindow: { start: 600, end: 1200 } }; // nothing before 10:00
    const score = computeScore(timetable, selection, prefs, emptyAssignment());
    expect(score.terms.find((t) => t.key === 'dayWindow')?.cost).toBe(120 * WEIGHTS.dayWindowPerMinuteOutside);
  });
});

describe('computeScore — max classes per day', () => {
  it('is off by default', () => {
    const a = event('AA', 'AA', 'lecture', [slot('Po', 480, 570)]);
    const b = event('BB', 'BB', 'lecture', [slot('Po', 600, 690)]);
    const timetable = timetableOf([subject('AA', [a], []), subject('BB', [b], [])]);
    const selection = buildFullSelection(timetable);
    const score = computeScore(timetable, selection, DEFAULT_PREFS, emptyAssignment());
    expect(score.terms.find((t) => t.key === 'maxPerDay')?.cost).toBe(0);
  });

  it('charges per class beyond the cap on any single day', () => {
    const a = event('AA', 'AA', 'lecture', [slot('Po', 480, 570)]);
    const b = event('BB', 'BB', 'lecture', [slot('Po', 600, 690)]);
    const c = event('CC', 'CC', 'lecture', [slot('Po', 700, 790)]);
    const timetable = timetableOf([subject('AA', [a], []), subject('BB', [b], []), subject('CC', [c], [])]);
    const selection = buildFullSelection(timetable);
    const prefs: Prefs = { ...DEFAULT_PREFS, maxClassesPerDay: 2 };
    const score = computeScore(timetable, selection, prefs, emptyAssignment());
    expect(score.terms.find((t) => t.key === 'maxPerDay')?.cost).toBe(1 * WEIGHTS.maxPerDayPerExcessClass);
  });
});

describe('computeScore — priority ordering', () => {
  it('a single seminar collision always outranks even a maximally-bad comfort schedule', () => {
    const seminarC = event('CC/01', 'CC', 'seminar', [slot('St', 480, 570)], '01');
    const seminarD = event('DD/01', 'DD', 'seminar', [slot('St', 480, 570)], '01'); // overlaps CC/01
    const timetable = timetableOf([subject('CC', [], [seminarC]), subject('DD', [], [seminarD])]);
    const selection = buildFullSelection(timetable);

    const withCollision = computeScore(timetable, selection, DEFAULT_PREFS, {
      seminarChoice: { CC: 'CC/01', DD: 'DD/01' },
      droppedLectures: new Set(),
    });
    const worstComfortOnly = computeScore(
      timetable,
      selection,
      { ...DEFAULT_PREFS, compactness: 1, gaps: 1, maxClassesPerDay: 0 },
      { seminarChoice: { CC: 'CC/01' }, droppedLectures: new Set() },
    );

    expect(withCollision.total).toBeGreaterThan(worstComfortOnly.total);
  });

  it('a dropped ★-less lecture outranks comfort preferences but not a collision', () => {
    const seminarC = event('CC/01', 'CC', 'seminar', [slot('St', 480, 570)], '01');
    const seminarD = event('DD/01', 'DD', 'seminar', [slot('St', 480, 570)], '01');
    const lecture = event('EE', 'EE', 'lecture', [slot('Pá', 480, 570)]);
    const timetable = timetableOf([subject('CC', [], [seminarC]), subject('DD', [], [seminarD]), subject('EE', [lecture], [])]);
    const selection = buildFullSelection(timetable);
    const busyPrefs: Prefs = { ...DEFAULT_PREFS, compactness: 1, gaps: 1, maxClassesPerDay: 0 };

    const withCollision = computeScore(timetable, selection, DEFAULT_PREFS, {
      seminarChoice: { CC: 'CC/01', DD: 'DD/01' },
      droppedLectures: new Set(),
    });
    const withDroppedLecture = computeScore(timetable, selection, busyPrefs, {
      seminarChoice: { CC: 'CC/01' },
      droppedLectures: new Set(['EE']),
    });
    const comfortOnly = computeScore(timetable, selection, busyPrefs, {
      seminarChoice: { CC: 'CC/01' },
      droppedLectures: new Set(),
    });

    expect(withCollision.total).toBeGreaterThan(withDroppedLecture.total);
    expect(withDroppedLecture.total).toBeGreaterThan(comfortOnly.total);
  });
});
