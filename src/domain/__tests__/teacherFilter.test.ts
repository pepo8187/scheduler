import { describe, expect, it } from 'vitest';
import { applyTeacherChipClick, isAllCleared, isUnfiltered, seminarIdsForTeacher } from '../teacherFilter';
import type { CourseEvent, Teacher } from '../types';

const teacher = (id: string): Teacher => ({ id, name: `Dr ${id}` });

function seminar(id: string, teacherIds: string[]): CourseEvent {
  const teachers = teacherIds.map(teacher);
  return { id, subjectCode: 'AA', kind: 'seminar', group: id, slots: [], teachers };
}

/** Three teachers, one group each, plus a fourth group co-taught by X and Y. */
const seminars = [seminar('g1', ['x']), seminar('g2', ['y']), seminar('g3', ['z']), seminar('g4', ['x', 'y'])];

const allOn = () => Object.fromEntries(seminars.map((s) => [s.id, true]));
const on = (state: Record<string, boolean>) =>
  Object.entries(state)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .sort();

describe('seminarIdsForTeacher', () => {
  it('finds every group a teacher teaches, co-taught ones included', () => {
    expect(seminarIdsForTeacher(seminars, 'x').sort()).toEqual(['g1', 'g4']);
    expect(seminarIdsForTeacher(seminars, 'z')).toEqual(['g3']);
    expect(seminarIdsForTeacher(seminars, 'nobody')).toEqual([]);
  });
});

describe('isUnfiltered', () => {
  it('is true only when every group is still enabled', () => {
    expect(isUnfiltered(seminars, allOn())).toBe(true);
    expect(isUnfiltered(seminars, { ...allOn(), g3: false })).toBe(false);
    expect(isUnfiltered([], {})).toBe(false); // no groups at all is not "unfiltered"
  });
});

describe('isAllCleared', () => {
  it('is true only when every group is deselected', () => {
    const allOff = Object.fromEntries(seminars.map((s) => [s.id, false]));
    expect(isAllCleared(seminars, allOff)).toBe(true);
    expect(isAllCleared(seminars, { ...allOff, g3: true })).toBe(false);
    expect(isAllCleared(seminars, allOn())).toBe(false);
    expect(isAllCleared([], {})).toBe(false); // no groups at all is not "cleared"
  });
});

describe('applyTeacherChipClick', () => {
  it('drops everyone else on the first click out of the pristine state', () => {
    const next = applyTeacherChipClick(seminars, allOn(), 'z');
    expect(on(next)).toEqual(['g3']);
  });

  it('adds to the selection on every click after the first', () => {
    const first = applyTeacherChipClick(seminars, allOn(), 'z'); // only z
    const second = applyTeacherChipClick(seminars, first, 'y'); // z + y
    expect(on(second)).toEqual(['g2', 'g3', 'g4']);

    const third = applyTeacherChipClick(seminars, second, 'x'); // z + y + x
    expect(on(third)).toEqual(['g1', 'g2', 'g3', 'g4']);
  });

  it('removes a teacher whose groups are already fully selected', () => {
    const zOnly = applyTeacherChipClick(seminars, allOn(), 'z');
    const zAndY = applyTeacherChipClick(seminars, zOnly, 'y');
    expect(on(applyTeacherChipClick(seminars, zAndY, 'y'))).toEqual(['g3']);
  });

  it('clears the filter rather than leaving a subject with no group at all', () => {
    const zOnly = applyTeacherChipClick(seminars, allOn(), 'z');
    // Clicking the last remaining teacher off would empty the subject, so it goes back to all on.
    expect(on(applyTeacherChipClick(seminars, zOnly, 'z'))).toEqual(['g1', 'g2', 'g3', 'g4']);
  });

  it('treats a partly-enabled teacher as one to add, not one to remove', () => {
    // g1 on, g4 off: teacher x is only partly selected.
    const partial = { g1: true, g2: false, g3: false, g4: false };
    expect(on(applyTeacherChipClick(seminars, partial, 'x'))).toEqual(['g1', 'g4']);
  });

  it('lets a co-taught group survive while any of its teachers is selected', () => {
    const xOnly = applyTeacherChipClick(seminars, allOn(), 'x'); // g1 + g4
    const xAndY = applyTeacherChipClick(seminars, xOnly, 'y'); // + g2 (g4 already on)
    expect(on(xAndY)).toEqual(['g1', 'g2', 'g4']);
    // Dropping x takes the shared g4 with it — it is x's group too.
    expect(on(applyTeacherChipClick(seminars, xAndY, 'x'))).toEqual(['g2']);
  });

  it('is a no-op for a teacher who teaches none of these groups', () => {
    const state = allOn();
    expect(applyTeacherChipClick(seminars, state, 'nobody')).toBe(state);
  });

  it('never mutates the state it is given', () => {
    const state = allOn();
    const snapshot = { ...state };
    applyTeacherChipClick(seminars, state, 'x');
    expect(state).toEqual(snapshot);
  });
});
