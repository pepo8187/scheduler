import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS } from '../../domain/presets';
import type { CourseEvent, Day, Selection, Slot, Subject, Timetable } from '../../domain/types';
import { migrateSelection, reducer, type State } from '../schedulerStore';

function slot(day: Day, start: number, end: number): Slot {
  return { day, start, end, rooms: [], teachers: [] };
}

function seminar(id: string, day: Day, group: string): CourseEvent {
  return { id, subjectCode: 'BB', kind: 'seminar', group, slots: [slot(day, 600, 710)], teachers: [] };
}

const subject: Subject = {
  code: 'BB',
  name: 'BB',
  subjectId: 'BB',
  facultyUrl: '',
  periodUrl: '',
  lectures: [],
  seminars: [seminar('BB/01', 'Po', '01'), seminar('BB/02', 'Čt', '02'), seminar('BB/03', 'Pá', '03')],
};

const timetable: Timetable = { minHour: 480, maxHour: 1200, hours: [], subjects: [subject], unscheduled: [] };

function stateWith(over: Partial<Selection[string]> = {}): State {
  const selection: Selection = {
    BB: {
      enabled: true,
      lectures: {},
      seminars: { 'BB/01': true, 'BB/02': true, 'BB/03': true },
      reclassified: {},
      pinned: {},
      ...over,
    },
  };
  return { xml: '<rozvrh/>', fileName: null, timetable, selection, prefs: { ...DEFAULT_PREFS, seed: 'AAAA-2222' } };
}

const pinsOf = (state: State) => state.selection.BB!.pinned;

describe('TOGGLE_SEMINAR_PINNED', () => {
  it('pins a group', () => {
    const next = reducer(stateWith(), { type: 'TOGGLE_SEMINAR_PINNED', subjectCode: 'BB', seminarId: 'BB/02' });
    expect(pinsOf(next)).toEqual({ 'BB/02': true });
  });

  it('un-pins on a second click — that is the whole un-pin affordance', () => {
    const pinned = reducer(stateWith(), { type: 'TOGGLE_SEMINAR_PINNED', subjectCode: 'BB', seminarId: 'BB/02' });
    const cleared = reducer(pinned, { type: 'TOGGLE_SEMINAR_PINNED', subjectCode: 'BB', seminarId: 'BB/02' });
    expect(pinsOf(cleared)).toEqual({});
  });

  it('replaces rather than accumulates: a subject only ever attends one group', () => {
    const first = reducer(stateWith(), { type: 'TOGGLE_SEMINAR_PINNED', subjectCode: 'BB', seminarId: 'BB/02' });
    const second = reducer(first, { type: 'TOGGLE_SEMINAR_PINNED', subjectCode: 'BB', seminarId: 'BB/03' });
    expect(pinsOf(second)).toEqual({ 'BB/03': true });
  });

  it('enables the group it pins, so the pin is never one the solver must ignore', () => {
    const off = stateWith({ seminars: { 'BB/01': true, 'BB/02': false, 'BB/03': true } });
    const next = reducer(off, { type: 'TOGGLE_SEMINAR_PINNED', subjectCode: 'BB', seminarId: 'BB/02' });
    expect(next.selection.BB!.seminars['BB/02']).toBe(true);
    expect(pinsOf(next)).toEqual({ 'BB/02': true });
  });

  it('refuses to pin a group reclassified as a lecture — there is no choice left to make', () => {
    const state = stateWith({ reclassified: { 'BB/02': true } });
    expect(reducer(state, { type: 'TOGGLE_SEMINAR_PINNED', subjectCode: 'BB', seminarId: 'BB/02' })).toBe(state);
  });
});

describe('a pin only survives while its group is a live candidate', () => {
  const pinned = () => reducer(stateWith(), { type: 'TOGGLE_SEMINAR_PINNED', subjectCode: 'BB', seminarId: 'BB/02' });

  it('drops when the group is switched off', () => {
    const next = reducer(pinned(), { type: 'TOGGLE_SEMINAR', subjectCode: 'BB', seminarId: 'BB/02' });
    expect(pinsOf(next)).toEqual({});
  });

  it('drops when the group is reclassified as a lecture', () => {
    const next = reducer(pinned(), { type: 'TOGGLE_SEMINAR_RECLASSIFIED', subjectCode: 'BB', seminarId: 'BB/02' });
    expect(pinsOf(next)).toEqual({});
  });

  it('drops when "Deselect groups" clears the subject', () => {
    const next = reducer(pinned(), { type: 'DISABLE_ALL_SEMINARS', subjectCode: 'BB' });
    expect(pinsOf(next)).toEqual({});
  });

  it('survives switching a different group off', () => {
    const next = reducer(pinned(), { type: 'TOGGLE_SEMINAR', subjectCode: 'BB', seminarId: 'BB/03' });
    expect(pinsOf(next)).toEqual({ 'BB/02': true });
  });

  it('survives a day off — a hard constraint overrules a pin for now, it does not delete it', () => {
    // The solver ignores it while the day is off and `analyzePins` says so; the pin comes back.
    const next = reducer(pinned(), { type: 'TOGGLE_DAY_OFF', day: 'Čt' });
    expect(pinsOf(next)).toEqual({ 'BB/02': true });
  });
});

describe('migrateSelection', () => {
  it('round-trips pins through the persisted shape, alongside seminars and reclassified', () => {
    const selection = stateWith({ pinned: { 'BB/02': true }, reclassified: { 'BB/03': true } }).selection;
    const restored = migrateSelection(JSON.parse(JSON.stringify(selection)) as Selection);
    expect(restored).toEqual(selection);
  });

  it('defaults the maps a returning visitor’s stored state predates', () => {
    // Persisted before either feature existed: neither map is there at all.
    const old = { BB: { enabled: true, lectures: {}, seminars: { 'BB/01': true } } } as unknown as Selection;
    const restored = migrateSelection(old);
    expect(restored.BB!.pinned).toEqual({});
    expect(restored.BB!.reclassified).toEqual({});
  });

  it('copes with nothing stored at all', () => {
    expect(migrateSelection(undefined)).toEqual({});
  });
});
