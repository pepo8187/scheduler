import { describe, expect, it } from 'vitest';
import { lunchWindowForDay, slotDuringLunch } from '../lunch';
import type { LunchPrefs, Slot } from '../types';

function lunch(patch: Partial<LunchPrefs> = {}): LunchPrefs {
  return { enabled: true, default: { start: 600, end: 660 }, overrides: {}, ...patch };
}

function slot(day: Slot['day'], start: number, end: number): Slot {
  return { day, start, end, rooms: [], teachers: [] };
}

describe('lunchWindowForDay', () => {
  it('returns null when lunch is disabled entirely', () => {
    expect(lunchWindowForDay(lunch({ enabled: false }), 'Po')).toBeNull();
  });

  it('returns the default window for a day with no override', () => {
    expect(lunchWindowForDay(lunch(), 'Po')).toEqual({ start: 600, end: 660 });
  });

  it('returns a custom window for a day with an override', () => {
    const l = lunch({ overrides: { Út: { start: 720, end: 780 } } });
    expect(lunchWindowForDay(l, 'Út')).toEqual({ start: 720, end: 780 });
    expect(lunchWindowForDay(l, 'Po')).toEqual({ start: 600, end: 660 }); // untouched day keeps the default
  });

  it('returns null for a day explicitly blacked out, even though lunch is enabled overall', () => {
    const l = lunch({ overrides: { St: null } });
    expect(lunchWindowForDay(l, 'St')).toBeNull();
    expect(lunchWindowForDay(l, 'Po')).toEqual({ start: 600, end: 660 });
  });
});

describe('slotDuringLunch', () => {
  it('is true for a slot overlapping its day\'s window', () => {
    expect(slotDuringLunch(slot('Po', 630, 700), lunch())).toBe(true); // 10:30-11:40 overlaps 10:00-11:00
  });

  it('is false for a slot outside its day\'s window', () => {
    expect(slotDuringLunch(slot('Po', 480, 570), lunch())).toBe(false); // 08:00-09:30
  });

  it('is false on a day that has been blacked out', () => {
    const l = lunch({ overrides: { Po: null } });
    expect(slotDuringLunch(slot('Po', 630, 700), l)).toBe(false);
  });

  it('respects a per-day override time instead of the default', () => {
    const l = lunch({ overrides: { Út: { start: 720, end: 780 } } }); // 12:00-13:00 on Tuesday
    expect(slotDuringLunch(slot('Út', 630, 700), l)).toBe(false); // would overlap the default, not the override
    expect(slotDuringLunch(slot('Út', 720, 780), l)).toBe(true);
  });
});
