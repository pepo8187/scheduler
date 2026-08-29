import { describe, expect, it } from 'vitest';
import { findOverlaps } from '../overlap';
import { parseTimetable } from '../parseTimetable';
import type { CourseEvent, Subject } from '../types';
import { readSampleXml } from './sample';

function bySubject(subjects: Subject[]): Record<string, Subject> {
  return Object.fromEntries(subjects.map((s) => [s.code, s]));
}

function groups(events: CourseEvent[]): (string | undefined)[] {
  return events.map((e) => e.group).sort();
}

describe('parseTimetable', () => {
  const parse = () => parseTimetable(readSampleXml());

  it('exposes the structural grid bounds and a 12-row hour ruler', () => {
    const timetable = parse();
    expect(timetable.minHour).toBe(480);
    expect(timetable.maxHour).toBe(1200);
    expect(timetable.hours).toHaveLength(12);
    expect(timetable.hours[0]).toEqual({ start: 480, end: 530 });
    expect(timetable.hours[11]).toEqual({ start: 1140, end: 1190 });
  });

  it('parses exactly the 7 subjects from the sample, each with the right lecture/seminar split', () => {
    const { subjects } = parse();
    expect(subjects).toHaveLength(7);
    expect(subjects.map((s) => s.code).sort()).toEqual(
      ['IA012', 'IA159', 'LJ601', 'MA010', 'MA012', 'MV008', 'PV021'].sort(),
    );

    const byCode = bySubject(subjects);

    // LJ601: seminar-only, six groups, no bare lecture code.
    expect(byCode.LJ601?.lectures).toHaveLength(0);
    expect(groups(byCode.LJ601?.seminars ?? [])).toEqual(['01', '02', '03', '04', '05', '06']);

    // MV008: a forced choice, exactly one group.
    expect(byCode.MV008?.lectures).toHaveLength(1);
    expect(groups(byCode.MV008?.seminars ?? [])).toEqual(['01']);

    // MA012: lecture plus four seminar groups.
    expect(byCode.MA012?.lectures).toHaveLength(1);
    expect(groups(byCode.MA012?.seminars ?? [])).toEqual(['01', '02', '03', '04']);

    // MA010: lecture plus two Friday-only groups.
    expect(byCode.MA010?.lectures).toHaveLength(1);
    expect(groups(byCode.MA010?.seminars ?? [])).toEqual(['01', '02']);

    // IA159, IA012, PV021: lecture only, no seminar groups.
    for (const code of ['IA159', 'IA012', 'PV021']) {
      expect(byCode[code]?.lectures).toHaveLength(1);
      expect(byCode[code]?.seminars).toHaveLength(0);
    }
  });

  it('de-duplicates the once-per-teaching-week repeated rooms and teachers on a slot', () => {
    const { subjects } = parse();
    const byCode = bySubject(subjects);
    const mv008Lecture = byCode.MV008?.lectures[0];

    expect(mv008Lecture?.slots).toHaveLength(1);
    expect(mv008Lecture?.slots[0]?.rooms).toEqual(['A320']);
    expect(mv008Lecture?.teachers).toEqual([{ id: '2906', name: 'M. Kunc' }]);
  });

  it('reads day, time and content for a known slot (MA012 lecture, Út 10:00-11:50)', () => {
    const { subjects } = parse();
    const lecture = bySubject(subjects).MA012?.lectures[0];

    expect(lecture?.id).toBe('MA012');
    expect(lecture?.slots).toHaveLength(1);
    expect(lecture?.slots[0]).toMatchObject({ day: 'Út', start: 600, end: 710, rooms: ['A217'] });
  });

  it('extracts the nezname courses that must never be placed on the grid', () => {
    const { unscheduled } = parse();
    expect(unscheduled.map((c) => c.code)).toEqual(['SOBHA', 'SZB']);
    expect(unscheduled[0]?.name).toBe('Obhajoba závěrečné práce');
  });

  it('detects the Út 12:00 IA159/MA010 lecture pair as a lecture-lecture conflict, not an error', () => {
    const { subjects } = parse();
    const byCode = bySubject(subjects);
    const allLectures = subjects.flatMap((s) => s.lectures);

    const overlaps = findOverlaps(allLectures);
    const iaMa = overlaps.find(
      (o) => new Set([o.a.subjectCode, o.b.subjectCode]).has('IA159') && new Set([o.a.subjectCode, o.b.subjectCode]).has('MA010'),
    );

    expect(iaMa).toBeDefined();
    expect(iaMa?.kind).toBe('lecture-lecture');
    expect(byCode.IA159?.lectures[0]?.slots[0]).toMatchObject({ day: 'Út', start: 720, end: 830 });
    expect(byCode.MA010?.lectures[0]?.slots[0]).toMatchObject({ day: 'Út', start: 720, end: 830 });
  });

  it('gives every seminar group all-or-nothing slots merged under one CourseEvent id', () => {
    const { subjects } = parse();
    const ma010Group1 = bySubject(subjects).MA010?.seminars.find((s) => s.group === '01');
    expect(ma010Group1?.id).toBe('MA010/01');
    expect(ma010Group1?.slots).toHaveLength(1);
    expect(ma010Group1?.slots[0]).toMatchObject({ day: 'Pá', start: 600, end: 710 });
  });
});
