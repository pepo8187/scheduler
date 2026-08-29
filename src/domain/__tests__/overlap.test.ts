import { describe, expect, it } from 'vitest';
import { classifyOverlap, eventsOverlap, findOverlaps, intervalsOverlap, slotsOverlap } from '../overlap';
import type { CourseEvent, Slot } from '../types';

function slot(day: Slot['day'], start: number, end: number): Slot {
  return { day, start, end, rooms: [], teachers: [] };
}

function event(id: string, subjectCode: string, kind: CourseEvent['kind'], slots: Slot[]): CourseEvent {
  return { id, subjectCode, kind, slots, teachers: [] };
}

describe('intervalsOverlap', () => {
  it('is true when intervals share time, including touching-boundary cases', () => {
    expect(intervalsOverlap(480, 530, 500, 540)).toBe(true);
    expect(intervalsOverlap(480, 530, 530, 580)).toBe(false); // back-to-back, no overlap
    expect(intervalsOverlap(480, 530, 600, 650)).toBe(false);
  });
});

describe('slotsOverlap', () => {
  it('requires the same day', () => {
    const a = slot('Út', 720, 830);
    const b = slot('St', 720, 830);
    expect(slotsOverlap(a, b)).toBe(false);
  });

  it('detects the Út 12:00 lecture collision from the sample export', () => {
    const ia159 = slot('Út', 720, 830); // 12:00-13:50
    const ma010 = slot('Út', 720, 830);
    expect(slotsOverlap(ia159, ma010)).toBe(true);
  });
});

describe('classifyOverlap', () => {
  it('classifies lecture-lecture pairs separately from anything involving a seminar', () => {
    const lectureA = event('IA159', 'IA159', 'lecture', []);
    const lectureB = event('MA010', 'MA010', 'lecture', []);
    const seminar = event('MA012/03', 'MA012', 'seminar', []);

    expect(classifyOverlap(lectureA, lectureB)).toBe('lecture-lecture');
    expect(classifyOverlap(lectureA, seminar)).toBe('seminar');
    expect(classifyOverlap(seminar, seminar)).toBe('seminar');
  });
});

describe('eventsOverlap / findOverlaps', () => {
  it('finds the Út 12:00 IA159/MA010 lecture collision', () => {
    const ia159 = event('IA159', 'IA159', 'lecture', [slot('Út', 720, 830)]);
    const ma010 = event('MA010', 'MA010', 'lecture', [slot('Út', 720, 830)]);
    const iaLecture = event('IA012', 'IA012', 'lecture', [slot('St', 720, 830)]);

    expect(eventsOverlap(ia159, ma010)).toBe(true);
    expect(eventsOverlap(ia159, iaLecture)).toBe(false);

    const overlaps = findOverlaps([ia159, ma010, iaLecture]);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]?.kind).toBe('lecture-lecture');
  });

  it('never reports two groups of the same subject as conflicting with each other', () => {
    const groupA = event('MA010/01', 'MA010', 'seminar', [slot('Pá', 600, 710)]);
    const groupB = event('MA010/02', 'MA010', 'seminar', [slot('Pá', 600, 710)]);
    expect(findOverlaps([groupA, groupB])).toHaveLength(0);
  });
});
