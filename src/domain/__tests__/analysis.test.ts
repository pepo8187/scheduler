import { describe, expect, it } from 'vitest';
import { analyzeDayOff, analyzeLunch, findLectureConflicts } from '../analysis';
import { parseTimetable } from '../parseTimetable';
import type { CourseEvent, LunchPrefs, Slot, Subject, Timetable } from '../types';
import { buildFullSelection } from './selection';
import { readSampleXml } from './sample';

function slot(day: Slot['day'], start: number, end: number): Slot {
  return { day, start, end, rooms: [], teachers: [] };
}

function event(id: string, subjectCode: string, kind: CourseEvent['kind'], slots: Slot[]): CourseEvent {
  return { id, subjectCode, kind, slots, teachers: [] };
}

function subject(code: string, lectures: CourseEvent[], seminars: CourseEvent[]): Subject {
  return { code, name: code, subjectId: code, facultyUrl: '', periodUrl: '', lectures, seminars };
}

function timetableOf(subjects: Subject[]): Timetable {
  return { minHour: 480, maxHour: 1200, hours: [], subjects, unscheduled: [] };
}

describe('findLectureConflicts', () => {
  it('flags an overlapping pair of enabled lectures as a badge-only conflict', () => {
    const lectureA = event('AA', 'AA', 'lecture', [slot('Út', 720, 830)]);
    const lectureB = event('BB', 'BB', 'lecture', [slot('Út', 720, 830)]);
    const timetable = timetableOf([subject('AA', [lectureA], []), subject('BB', [lectureB], [])]);
    const selection = buildFullSelection(timetable);

    const conflicts = findLectureConflicts(timetable, selection);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.day).toBe('Út');
    const codes = [conflicts[0]?.a.subjectCode, conflicts[0]?.b.subjectCode].sort();
    expect(codes).toEqual(['AA', 'BB']);
  });

  it('stops reporting a conflict once one side is disabled', () => {
    const lectureA = event('AA', 'AA', 'lecture', [slot('Út', 720, 830)]);
    const lectureB = event('BB', 'BB', 'lecture', [slot('Út', 720, 830)]);
    const timetable = timetableOf([subject('AA', [lectureA], []), subject('BB', [lectureB], [])]);
    const selection = buildFullSelection(timetable);
    selection.AA!.enabled = false;

    expect(findLectureConflicts(timetable, selection)).toHaveLength(0);
  });

  it('the bundled sample has no lecture-lecture overlaps of its own', () => {
    const timetable = parseTimetable(readSampleXml());
    const selection = buildFullSelection(timetable);
    expect(findLectureConflicts(timetable, selection)).toHaveLength(0);
  });

  it('folds in a reclassified seminar as a lecture, badge and all', () => {
    const lectureA = event('AA', 'AA', 'lecture', [slot('Út', 720, 830)]);
    const demo = event('BB/01', 'BB', 'seminar', [slot('Út', 720, 830)]);
    const timetable = timetableOf([subject('AA', [lectureA], []), subject('BB', [], [demo])]);
    const selection = buildFullSelection(timetable);
    selection.BB!.reclassified['BB/01'] = true;

    const conflicts = findLectureConflicts(timetable, selection);
    expect(conflicts).toHaveLength(1);
    const codes = [conflicts[0]?.a.subjectCode, conflicts[0]?.b.subjectCode].sort();
    expect(codes).toEqual(['AA', 'BB']);
  });
});

describe('analyzeDayOff — the Tuesday / Quantum Programming trade-off', () => {
  it('leaves PV275 with no usable seminar group when Tuesday is turned off', () => {
    const timetable = parseTimetable(readSampleXml());
    const selection = buildFullSelection(timetable);

    const analysis = analyzeDayOff(timetable, selection, 'Út');
    expect(analysis.deadSubjects).toHaveLength(1);
    expect(analysis.deadSubjects[0]?.subject.code).toBe('PV275');
    expect(analysis.deadSubjects[0]?.reason).toMatch(/01/);
  });

  it('is silent about a subject the user already narrowed to lecture-only', () => {
    const timetable = parseTimetable(readSampleXml());
    const selection = buildFullSelection(timetable);
    for (const id of Object.keys(selection.PV275!.seminars)) selection.PV275!.seminars[id] = false;

    const analysis = analyzeDayOff(timetable, selection, 'Út');
    expect(analysis.deadSubjects).toHaveLength(0);
  });

  it('blocks the toggle when a ★ required lecture falls on that day', () => {
    const timetable = parseTimetable(readSampleXml());
    const selection = buildFullSelection(timetable);
    const ib111Lecture = timetable.subjects.find((s) => s.code === 'IB111')!.lectures[0]!;
    selection.IB111!.lectures[ib111Lecture.id]!.required = true;

    const analysis = analyzeDayOff(timetable, selection, 'Út');
    expect(analysis.blockers).toHaveLength(1);
    expect(analysis.blockers[0]?.subject.code).toBe('IB111');
  });

  it('notes non-★ lectures as drops rather than blocks', () => {
    const timetable = parseTimetable(readSampleXml());
    const selection = buildFullSelection(timetable);

    const analysis = analyzeDayOff(timetable, selection, 'St'); // M1110 and VV028 lectures, non-★ by default
    expect(analysis.blockers).toHaveLength(0);
    expect(analysis.droppedLectures.map((d) => d.subject.code).sort()).toEqual(['M1110', 'VV028']);
  });

  it('is clean when no ★ lecture and no dead-ending seminar touches the day', () => {
    const timetable = parseTimetable(readSampleXml());
    const selection = buildFullSelection(timetable);
    const analysis = analyzeDayOff(timetable, selection, 'Čt');
    expect(analysis.blockers).toHaveLength(0);
    expect(analysis.deadSubjects).toHaveLength(0);
  });

  it('previews a reclassified seminar as a drop, never as a dead-subject trade-off', () => {
    const demo = event('BB/01', 'BB', 'seminar', [slot('Pá', 480, 570)]);
    const timetable = timetableOf([subject('BB', [], [demo])]);
    const selection = buildFullSelection(timetable);
    selection.BB!.reclassified['BB/01'] = true;

    const analysis = analyzeDayOff(timetable, selection, 'Pá');
    expect(analysis.blockers).toHaveLength(0);
    expect(analysis.deadSubjects).toHaveLength(0);
    expect(analysis.droppedLectures.map((d) => d.subject.code)).toEqual(['BB']);
  });
});

function lunch(patch: Partial<LunchPrefs> = {}): LunchPrefs {
  return { enabled: true, default: { start: 600, end: 660 }, overrides: {}, ...patch };
}

describe('analyzeLunch', () => {
  it('reports nothing when lunch is disabled, even if everything would otherwise overlap', () => {
    const during = event('BB/01', 'BB', 'seminar', [slot('Po', 630, 700)]);
    const timetable = timetableOf([subject('BB', [], [during])]);
    const selection = buildFullSelection(timetable);

    const analysis = analyzeLunch(timetable, selection, lunch({ enabled: false }));
    expect(analysis.lectureOverlaps).toHaveLength(0);
    expect(analysis.deadSubjects).toHaveLength(0);
  });

  it('flags a fixed lecture sitting inside the lunch window, informationally', () => {
    const duringLunch = event('AA', 'AA', 'lecture', [slot('Po', 630, 700)]); // 10:30-11:40
    const timetable = timetableOf([subject('AA', [duringLunch], [])]);
    const selection = buildFullSelection(timetable);

    const analysis = analyzeLunch(timetable, selection, lunch());
    expect(analysis.lectureOverlaps).toHaveLength(1);
    expect(analysis.lectureOverlaps[0]?.subject.code).toBe('AA');
    expect(analysis.lectureOverlaps[0]?.day).toBe('Po');
  });

  it('leaves a subject dead when every enabled group overlaps its day\'s lunch window', () => {
    const groupA = event('BB/01', 'BB', 'seminar', [slot('Po', 630, 700)]);
    const groupB = event('BB/02', 'BB', 'seminar', [slot('Út', 620, 650)]); // still inside the default window
    const timetable = timetableOf([subject('BB', [], [groupA, groupB])]);
    const selection = buildFullSelection(timetable);

    const analysis = analyzeLunch(timetable, selection, lunch());
    expect(analysis.deadSubjects).toHaveLength(1);
    expect(analysis.deadSubjects[0]?.subject.code).toBe('BB');
    expect(analysis.deadSubjects[0]?.reason).toMatch(/lunch/);
  });

  it('is not dead when at least one enabled group survives', () => {
    const groupA = event('BB/01', 'BB', 'seminar', [slot('Po', 630, 700)]); // during lunch
    const groupB = event('BB/02', 'BB', 'seminar', [slot('Út', 480, 570)]); // clear
    const timetable = timetableOf([subject('BB', [], [groupA, groupB])]);
    const selection = buildFullSelection(timetable);

    expect(analyzeLunch(timetable, selection, lunch()).deadSubjects).toHaveLength(0);
  });

  it('is silent about a subject the user already narrowed to lecture-only', () => {
    const onlyGroup = event('BB/01', 'BB', 'seminar', [slot('Po', 630, 700)]);
    const timetable = timetableOf([subject('BB', [], [onlyGroup])]);
    const selection = buildFullSelection(timetable);
    selection.BB!.seminars[onlyGroup.id] = false;

    expect(analyzeLunch(timetable, selection, lunch()).deadSubjects).toHaveLength(0);
  });

  it('respects a per-day override and a blackout day', () => {
    const overrideDay = event('BB/01', 'BB', 'seminar', [slot('Út', 720, 780)]); // matches Tuesday's override
    const blackoutDay = event('CC/01', 'CC', 'seminar', [slot('Po', 630, 700)]); // would overlap the default
    const timetable = timetableOf([subject('BB', [], [overrideDay]), subject('CC', [], [blackoutDay])]);
    const selection = buildFullSelection(timetable);
    const prefs = lunch({ overrides: { Út: { start: 720, end: 780 }, Po: null } });

    const analysis = analyzeLunch(timetable, selection, prefs);
    expect(analysis.deadSubjects.map((d) => d.subject.code).sort()).toEqual(['BB']); // CC's day is blacked out
  });

  it('flags a reclassified seminar overlapping lunch informationally, never as a dead subject', () => {
    const demo = event('BB/01', 'BB', 'seminar', [slot('Po', 630, 700)]);
    const timetable = timetableOf([subject('BB', [], [demo])]);
    const selection = buildFullSelection(timetable);
    selection.BB!.reclassified['BB/01'] = true;

    const analysis = analyzeLunch(timetable, selection, lunch());
    expect(analysis.deadSubjects).toHaveLength(0);
    expect(analysis.lectureOverlaps.map((o) => o.subject.code)).toEqual(['BB']);
  });
});
