import type { Selection, Timetable } from '../types';

/** Every subject, lecture and seminar group enabled; no lecture required (★ off). */
export function buildFullSelection(timetable: Timetable): Selection {
  const selection: Selection = {};
  for (const subject of timetable.subjects) {
    selection[subject.code] = {
      enabled: true,
      lectures: Object.fromEntries(subject.lectures.map((l) => [l.id, { enabled: true, required: false }])),
      seminars: Object.fromEntries(subject.seminars.map((s) => [s.id, true])),
      reclassified: {},
    };
  }
  return selection;
}
