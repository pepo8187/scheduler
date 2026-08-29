import { describe, expect, it } from 'vitest';
import { analyzeDayOff, findLectureConflicts } from '../analysis';
import { parseTimetable } from '../parseTimetable';
import { buildFullSelection } from './selection';
import { readSampleXml } from './sample';

describe('findLectureConflicts', () => {
  it('flags the Út 12:00 IA159/MA010 lecture pair as a badge-only conflict', () => {
    const timetable = parseTimetable(readSampleXml());
    const selection = buildFullSelection(timetable);
    const conflicts = findLectureConflicts(timetable, selection);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.day).toBe('Út');
    const codes = [conflicts[0]?.a.subjectCode, conflicts[0]?.b.subjectCode].sort();
    expect(codes).toEqual(['IA159', 'MA010']);
  });

  it('stops reporting a conflict once one side is disabled', () => {
    const timetable = parseTimetable(readSampleXml());
    const selection = buildFullSelection(timetable);
    selection.IA159!.enabled = false;

    expect(findLectureConflicts(timetable, selection)).toHaveLength(0);
  });
});

describe('analyzeDayOff — the Friday / Graph Theory trade-off', () => {
  it('leaves MA010 with no usable seminar group when Friday is turned off', () => {
    const timetable = parseTimetable(readSampleXml());
    const selection = buildFullSelection(timetable);

    const analysis = analyzeDayOff(timetable, selection, 'Pá');
    expect(analysis.blockers).toHaveLength(0); // no lecture meets on Friday at all
    expect(analysis.deadSubjects).toHaveLength(1);
    expect(analysis.deadSubjects[0]?.subject.code).toBe('MA010');
    expect(analysis.deadSubjects[0]?.reason).toMatch(/01, 02/);
  });

  it('is silent about a subject the user already narrowed to lecture-only', () => {
    const timetable = parseTimetable(readSampleXml());
    const selection = buildFullSelection(timetable);
    for (const id of Object.keys(selection.MA010!.seminars)) selection.MA010!.seminars[id] = false;

    const analysis = analyzeDayOff(timetable, selection, 'Pá');
    expect(analysis.deadSubjects).toHaveLength(0);
  });

  it('blocks the toggle when a ★ required lecture falls on that day', () => {
    const timetable = parseTimetable(readSampleXml());
    const selection = buildFullSelection(timetable);
    const iaLecture = timetable.subjects.find((s) => s.code === 'IA012')!.lectures[0]!;
    selection.IA012!.lectures[iaLecture.id]!.required = true;

    const analysis = analyzeDayOff(timetable, selection, 'St');
    expect(analysis.blockers).toHaveLength(1);
    expect(analysis.blockers[0]?.subject.code).toBe('IA012');
  });

  it('notes a non-★ lecture as a drop rather than a block', () => {
    const timetable = parseTimetable(readSampleXml());
    const selection = buildFullSelection(timetable);

    const analysis = analyzeDayOff(timetable, selection, 'St'); // IA012 lecture, non-★ by default
    expect(analysis.blockers).toHaveLength(0);
    expect(analysis.droppedLectures).toHaveLength(1);
    expect(analysis.droppedLectures[0]?.subject.code).toBe('IA012');
  });

  it('is clean when no lecture and no dead-ending seminar touches the day', () => {
    const timetable = parseTimetable(readSampleXml());
    const selection = buildFullSelection(timetable);
    // Thursday: only PV021's lecture, and no seminar groups meet only on Thursday.
    const analysis = analyzeDayOff(timetable, selection, 'Čt');
    expect(analysis.blockers).toHaveLength(0);
    expect(analysis.deadSubjects).toHaveLength(0);
  });
});
