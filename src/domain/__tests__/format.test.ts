import { describe, expect, it } from 'vitest';
import { DAY_LABELS, DAY_ORDER, describeRooms, describeSlots, describeTeachers, formatMinutes, parseTimeToMinutes } from '../format';
import type { CourseEvent } from '../types';

describe('parseTimeToMinutes', () => {
  it('parses zero-padded HH:MM', () => {
    expect(parseTimeToMinutes('08:00')).toBe(480);
    expect(parseTimeToMinutes('20:00')).toBe(1200);
  });

  it('parses single-digit hours as they appear on breaks in the export', () => {
    expect(parseTimeToMinutes('9:40')).toBe(580);
  });
});

describe('formatMinutes', () => {
  it('formats minutes back into zero-padded HH:MM', () => {
    expect(formatMinutes(480)).toBe('08:00');
    expect(formatMinutes(580)).toBe('09:40');
    expect(formatMinutes(1200)).toBe('20:00');
  });

  it('round-trips through parseTimeToMinutes', () => {
    for (const time of ['08:00', '09:40', '13:50', '19:50']) {
      expect(formatMinutes(parseTimeToMinutes(time))).toBe(time);
    }
  });
});

describe('day labels', () => {
  it('covers every day in DAY_ORDER', () => {
    for (const day of DAY_ORDER) {
      expect(DAY_LABELS[day]).toBeTruthy();
    }
  });

  it('orders the school week Monday first', () => {
    expect(DAY_ORDER.slice(0, 5)).toEqual(['Po', 'Út', 'St', 'Čt', 'Pá']);
  });
});

describe('event descriptions', () => {
  const event: CourseEvent = {
    id: 'MA012/03',
    subjectCode: 'MA012',
    kind: 'seminar',
    group: '03',
    slots: [
      { day: 'Út', start: 720, end: 830, rooms: ['A319', 'A320'], teachers: [{ id: '1', name: 'O. Pokora' }] },
      { day: 'St', start: 480, end: 530, rooms: ['A319'], teachers: [{ id: '1', name: 'O. Pokora' }] },
    ],
    teachers: [{ id: '1', name: 'O. Pokora' }],
  };

  it('describeSlots joins every weekly meeting', () => {
    expect(describeSlots(event)).toBe('Út 12:00-13:50, St 08:00-08:50');
  });

  it('describeTeachers joins the event-level teacher list', () => {
    expect(describeTeachers(event)).toBe('O. Pokora');
  });

  it('describeRooms de-duplicates rooms across slots', () => {
    expect(describeRooms(event)).toBe('A319, A320');
  });
});
