import { describe, expect, it } from 'vitest';
import { analyzeDayOff, findLectureConflicts } from '../analysis';
import { parseTimetable } from '../parseTimetable';
import type { CourseEvent, Slot, Subject, Timetable } from '../types';
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
});
